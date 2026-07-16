import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback, CharacteristicEventTypes } from 'homebridge';
import DaikinPlatform from '../platform';
import { DEVICE_STATUS_REFRESH_INTERVAL } from '../const';
import { DaikinAccessoryContext} from '../types';
import {
  CLIMATE_MODE_AUTO,
  CLIMATE_MODE_COOLING,
  CLIMATE_MODE_DEHUMIDIFY,
  CLIMATE_MODE_HUMIDIFY,
  CLIMATE_MODE_FAN,
  CLIMATE_MODE_HEATING,
  FAN_SPEED_TABLE
} from '../daikin-local';
import {DaikinLocalAPI, DaikinDevice} from '../daikin-local';


/**
 * An instance of this class is created for each accessory the platform registers.
 * Each accessory may expose multiple services of different service types.
 */
export default class ClimateAccessory {
  private services: Record<string, Service> = {};
  private _refreshInterval: NodeJS.Timer | undefined;
  private _lastFanSpeed = 1; // slient
  // Capabilities detected from the device's mode metadata (see
  // DaikinDevice.supportsOperationMode); decide which HeaterCooler states
  // and threshold characteristics this accessory exposes.
  private _supportsAuto = true;
  private _supportsHeat = true;
  private _supportsCool = true;

  constructor(
    private readonly platform: DaikinPlatform,
    private readonly accessory: PlatformAccessory<DaikinAccessoryContext>,
  ) {


    accessory.context.device.setCallback(this.updateDeviceStatus.bind(this));

    // Accessory Information
    // https://developers.homebridge.io/#/service/AccessoryInformation
    this.accessory.getService(this.platform.Service.AccessoryInformation)
      ?.setCharacteristic(
        this.platform.Characteristic.Manufacturer,
        'Daikin ' + accessory.context.device?.getDeviceReg(),
      )
      .setCharacteristic(
        this.platform.Characteristic.Model,
        accessory.context.device?.getDeviceType() || 'Unknown',
      )
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        accessory.context.device?.getMacAddress() || 'Unknown',
      )
      .setCharacteristic(
        this.platform.Characteristic.FirmwareRevision,
        accessory.context.device?.getFirmwareVersion() || 'Unknown',
      );

    this.services['Climate'] = this.accessory.getService(this.platform.Service.HeaterCooler)
      || this.accessory.addService(this.platform.Service.HeaterCooler);

    
    // This is what is displayed as the default name on the Home app
    this.services['Climate'].setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.context.device?.getDeviceName() || '空調',
    );

    this.services['Climate']
      .getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setClimateActive.bind(this))
      .onGet(this.getClimateActive.bind(this));

    this.services['Climate']
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .setProps({
        minValue: -100,
        maxValue: 100,
        minStep: 0.01,
      });  

    this.services['Climate']
      .getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
      .onGet(this.getCurrentHeaterCoolerState.bind(this));

    this._supportsAuto = accessory.context.device?.supportsOperationMode(CLIMATE_MODE_AUTO) ?? true;
    this._supportsHeat = accessory.context.device?.supportsOperationMode(CLIMATE_MODE_HEATING) ?? true;
    this._supportsCool = accessory.context.device?.supportsOperationMode(CLIMATE_MODE_COOLING) ?? true;

    const validTargetStates: number[] = [];
    if (this._supportsAuto) {
      validTargetStates.push(this.platform.Characteristic.TargetHeaterCoolerState.AUTO);
    }
    if (this._supportsHeat) {
      validTargetStates.push(this.platform.Characteristic.TargetHeaterCoolerState.HEAT);
    }
    if (this._supportsCool) {
      validTargetStates.push(this.platform.Characteristic.TargetHeaterCoolerState.COOL);
    }

    // A unit reporting none of the three states would leave HomeKit with an
    // empty mode menu; fall back to exposing everything.
    if (validTargetStates.length === 0) {
      this._supportsAuto = this._supportsHeat = this._supportsCool = true;
      validTargetStates.push(
        this.platform.Characteristic.TargetHeaterCoolerState.AUTO,
        this.platform.Characteristic.TargetHeaterCoolerState.HEAT,
        this.platform.Characteristic.TargetHeaterCoolerState.COOL,
      );
    }

    this.platform.log.info(`Accessory: '${this.accessory.displayName}' supported modes: `
      + `${accessory.context.device?.getSupportedOperationModeNames().join(', ')}`);

    this.services['Climate']
      .getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .setProps({
        validValues: validTargetStates,
      })
      .onSet(this.setTargetHeaterCoolerState.bind(this));

    // Cooling Threshold Temperature (optional)
    if (this._supportsCool) {
      this.services['Climate']
        .getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
        .setProps({
          minValue: accessory.context.device?.getCoolingThresholdTemperatureRange()[0] || 10,
          maxValue: accessory.context.device?.getCoolingThresholdTemperatureRange()[1] || 30,
          minStep: 0.5,
        })
        .onSet(this.setCoolingThresholdTemperature.bind(this))
        .onGet(this.getCoolingThresholdTemperature.bind(this));
    } else if (this.services['Climate'].testCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)) {
      // Drop the characteristic left on an accessory cached before capability detection.
      this.services['Climate'].removeCharacteristic(
        this.services['Climate'].getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature));
    }

    // Heating Threshold Temperature (optional)
    if (this._supportsHeat) {
      this.services['Climate']
        .getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
        .setProps({
          minValue: accessory.context.device?.getHeatingThresholdTemperatureRange()[0] || 10,
          maxValue: accessory.context.device?.getHeatingThresholdTemperatureRange()[1] || 30,
          minStep: 0.5,
        })
        .onSet(this.setHeatingThresholdTemperature.bind(this))
        .onGet(this.getHeatingThresholdTemperature.bind(this));
    } else if (this.services['Climate'].testCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)) {
      // Drop the characteristic left on an accessory cached before capability detection.
      this.services['Climate'].removeCharacteristic(
        this.services['Climate'].getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature));
    }

    // Fan control service
    this.services['Fan'] = this.accessory.getService(this.platform.Service.Fan)
      || this.accessory.addService(this.platform.Service.Fan);

    this.services['Fan'].getCharacteristic(this.platform.Characteristic.On)
    .onGet(this.getFanStatus.bind(this))
    .onSet(this.setFanStatus.bind(this));

    this.services['Fan'].getCharacteristic(this.platform.Characteristic.RotationSpeed)
    .setProps({
      unit: null,
      format: this.platform.Characteristic.Formats.UINT8,
      minValue: 0,
      maxValue: 6,
      validValues: [0, 1, 2, 3, 4, 5, 6]
    })
    .onGet(this.getRotationSpeed.bind(this))
    .onSet(this.setRotationSpeed.bind(this));

    /*
    //
    // Motion sensor switch
    //
    const buttonName = 'Motion Sensor';
    this.services[buttonName] = this.accessory.getServiceById(this.platform.Service.Switch, buttonName) || this.accessory.addService(this.platform.Service.Switch,  'buttonBuzzerName', buttonName);

     this.services[buttonName].setCharacteristic(this.platform.Characteristic.Name, buttonName);
     this.services[buttonName].getCharacteristic(this.platform.Characteristic.On)
     .onGet(this.getMotionDetection.bind(this))
     .onSet(this.setMotionDetection.bind(this));

     this.services[buttonName].addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
     this.services[buttonName].setCharacteristic(this.platform.Characteristic.ConfiguredName, buttonName);
    */

    ////
    this.services['HumiditySensor'] = this.accessory.getService(this.platform.Service.HumiditySensor)
    || this.accessory.addService(this.platform.Service.HumiditySensor);

    this.services['HumiditySensor'].getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .onGet(this.getCurrentRelativeHumidity.bind(this));

    // Separate service so it doesn't collide with HeaterCooler's
    // CurrentTemperature, which reports the indoor value.
    this.services['OutdoorTemperatureSensor'] =
      this.accessory.getServiceById(this.platform.Service.TemperatureSensor, 'outdoor')
      || this.accessory.addService(this.platform.Service.TemperatureSensor, 'Outdoor Temperature', 'outdoor');

    this.services['OutdoorTemperatureSensor']
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .setProps({
        minValue: -100,
        maxValue: 100,
        minStep: 0.5,
      })
      .onGet(this.getOutdoorTemperature.bind(this));

    //////////
    // Update characteristic values asynchronously instead of using onGet handlers
    this.refreshDeviceStatus();
  }


  async refreshDeviceStatus() {
    
    this.platform.log.debug(`Accessory: Refresh status for device '${this.accessory.displayName}'`);

    await this.accessory.context.device.fetchDeviceStatus();

   ///
   // Schedule continuous device updates on the first run
    if (!this._refreshInterval) {
      this._refreshInterval = setInterval(
        this.refreshDeviceStatus.bind(this),
        DEVICE_STATUS_REFRESH_INTERVAL,
      );
    }
  }


  // TargetHeaterCoolerState shown while the unit runs an auxiliary mode
  // (fan/dry/humidify) that HeaterCooler cannot represent; must be one of
  // the states this accessory actually exposes in validValues.
  private auxModeTargetState(): CharacteristicValue {
    if (this._supportsAuto) {
      return this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
    }
    if (this._supportsCool) {
      return this.platform.Characteristic.TargetHeaterCoolerState.COOL;
    }
    return this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
  }

  // Turn a device command result into a HomeKit-visible outcome: a failed command
  // must reject the onSet so the Home app doesn't show a stale "success" state.
  private assertCommand(ok: boolean) {
    if (!ok) {
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async setClimateActive(value: CharacteristicValue) {
    this.platform.log.debug(`Accessory: setClimateActive() for device '${this.accessory.displayName}'`);
    this.assertCommand(
      await this.accessory.context.device.setPowerStatus(value === this.platform.Characteristic.Active.ACTIVE));
  }

  async getClimateActive():Promise<CharacteristicValue> { 
    this.platform.log.debug(`Accessory: getClimateActive() for device '${this.accessory.displayName}'`);

    const active = this.accessory.context.device.getPowerStatus() ?
      this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE;
    return active;
  }

  async getFanStatus():Promise<CharacteristicValue> {
    this.platform.log.debug(`Accessory: getFanStatus() for device '${this.accessory.displayName}'`);

    const value = this.accessory.context.device.getFanSpeedNumber() !== 0;
    return value;
  }

  async setFanStatus(value: CharacteristicValue) {
    this.platform.log.debug(`Accessory: setFanStatus() for device '${this.accessory.displayName}'`);

    let speed = this._lastFanSpeed; // restore to previous non-zero speed
    if (value === false) {
      // turn off fan means turn on auto-speed mode
      speed = 0;
    }
    await this.setRotationSpeed(speed);
  }

  async getRotationSpeed():Promise<CharacteristicValue> {
      
    this.platform.log.debug(`Accessory: getRotationSpeed() for device '${this.accessory.displayName}'`);

    let value = this.accessory.context.device.getFanSpeedNumber();
    if (value === 0) {
      value = this._lastFanSpeed;
    }
    return value;
  }

  async setRotationSpeed(value: CharacteristicValue) {

    this.platform.log.debug(`Accessory: setRotationSpeed() for device '${this.accessory.displayName}'`);

    const entry = FAN_SPEED_TABLE.find(e => e.number === value);

    if (!entry) {
      this.platform.log.error(`Unknown RotationSpeed: ${value}` );
      return;
    }

    // Speed 0 = auto; remember the last explicit speed so turning the fan back on restores it.
    if (value === 0) {
      const lastFanSpeed = this.accessory.context.device.getFanSpeedNumber();
      if (lastFanSpeed !== 0) {
        this._lastFanSpeed = lastFanSpeed;
      }
    }

    this.assertCommand(await this.accessory.context.device.setFanSpeed(entry.code));
  }
  
  async getCurrentRelativeHumidity():Promise<CharacteristicValue> {

    try{
      this.platform.log.debug(`Accessory: getCurrentRelativeHumidity() for device '${this.accessory.displayName}'`);
    }catch(e){
        this.platform.log.error(e);
    }

    return this.accessory.context.device.getIndoorHumidity();


  }

  async getOutdoorTemperature():Promise<CharacteristicValue> {
    this.platform.log.debug(`Accessory: getOutdoorTemperature() for device '${this.accessory.displayName}'`);

    const value = this.accessory.context.device.getOutdoorTemperature();
    if (Number.isFinite(value)) {
      return value;
    }
    // Outdoor unit hasn't reported yet (e.g. AC just powered on); keep
    // whatever HomeKit already has cached rather than spike to 0.
    const cached = this.services['OutdoorTemperatureSensor']
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature).value;
    return typeof cached === 'number' ? cached : 0;
  }


  async getCurrentHeaterCoolerState():Promise<CharacteristicValue> {

    if(this.accessory.context.device.getPowerStatus()){

      const currentTemperature = await this.accessory.context.device.getIndoorTemperature() || 0;
      const targetTemperature = await this.accessory.context.device.getTargetTemperature() || 0;
      const currentMode = await this.accessory.context.device.getOperationMode() || CLIMATE_MODE_AUTO;

      switch (currentMode) 
      {
            // Auto
            case CLIMATE_MODE_AUTO:
              // Set target state and current state (based on current temperature)
              this.services['Climate'].updateCharacteristic(
                this.platform.Characteristic.TargetHeaterCoolerState,
                this.platform.Characteristic.TargetHeaterCoolerState.AUTO,
              );

              if (currentTemperature < targetTemperature) {
                this.services['Climate'].getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
                  .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.HEATING);
              } else if (currentTemperature > targetTemperature) {
                this.services['Climate'].getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
                  .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.COOLING);
              } else {
                this.services['Climate'].getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
                  .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.IDLE);
              }
              break;

            // Heat
            case CLIMATE_MODE_HEATING:
              this.services['Climate'].updateCharacteristic(
                this.platform.Characteristic.TargetHeaterCoolerState,
                this.platform.Characteristic.TargetHeaterCoolerState.HEAT,
              );

              if (currentTemperature < targetTemperature) {
                this.services['Climate'].getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
                  .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.HEATING);
              } else {
                this.services['Climate'].getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
                  .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.IDLE);
              }
              break;

            // Cool
            case CLIMATE_MODE_COOLING:
              this.services['Climate'].updateCharacteristic(
                this.platform.Characteristic.TargetHeaterCoolerState,
                this.platform.Characteristic.TargetHeaterCoolerState.COOL,
              );

              if (currentTemperature > targetTemperature) {
                this.services['Climate'].getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
                  .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.COOLING);
              } else {
                this.services['Climate'].getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
                  .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.IDLE);
              }
              break;

            // Dry (Dehumidifier)
            case CLIMATE_MODE_DEHUMIDIFY:
              this.services['Climate'].getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
                .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.IDLE);
                this.services['Climate'].updateCharacteristic(
                this.platform.Characteristic.TargetHeaterCoolerState,

                this.auxModeTargetState(),
              );
              break;

            // Humidifier
            case CLIMATE_MODE_HUMIDIFY:
              this.services['Climate'].getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
                .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.IDLE);
                this.services['Climate'].updateCharacteristic(
                this.platform.Characteristic.TargetHeaterCoolerState,

                this.auxModeTargetState(),
              );
              break;

            // Fan
            case CLIMATE_MODE_FAN:
              this.services['Climate'].getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
                .updateValue(this.platform.Characteristic.CurrentHeaterCoolerState.IDLE);
                this.services['Climate'].updateCharacteristic(
                this.platform.Characteristic.TargetHeaterCoolerState,

                this.auxModeTargetState(),
              );
              break;

            default:
              this.platform.log.error(
                `Unknown TargetHeaterCoolerState state: '${this.accessory.displayName}' '${currentMode}'`);
              break;
          }
          return this.services['Climate'].getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState).value
            ?? this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;

    }

    return this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;
  
  }

  async getCoolingThresholdTemperature():Promise<CharacteristicValue> {
      
      this.platform.log.debug(`Accessory: getCoolingThresholdTemperature() for device '${this.accessory.displayName}'`);
  
      const value = this.accessory.context.device.getTargetTemperatureWithMode(CLIMATE_MODE_COOLING);
      return value;
  }

  async getHeatingThresholdTemperature():Promise<CharacteristicValue> {
      
      this.platform.log.debug(`Accessory: getHeatingThresholdTemperature() for device '${this.accessory.displayName}'`);
  
      const value = this.accessory.context.device.getTargetTemperatureWithMode(CLIMATE_MODE_HEATING);
      return value;
  }

  async setCoolingThresholdTemperature(value: CharacteristicValue) {

    this.platform.log.debug(`Accessory: setCoolingThresholdTemperature() for device '${this.accessory.displayName}'`);

    const threshold:number = +value;

    this.assertCommand(await this.accessory.context.device.setOperationMode(CLIMATE_MODE_COOLING));
    this.assertCommand(await this.accessory.context.device.setTargetTemperature(threshold));
  }

  async setHeatingThresholdTemperature(value: CharacteristicValue) {

    this.platform.log.debug(`Accessory: setHeatingThresholdTemperature() for device '${this.accessory.displayName}'`);

    const threshold:number = +value;

    this.assertCommand(await this.accessory.context.device.setOperationMode(CLIMATE_MODE_HEATING));
    this.assertCommand(await this.accessory.context.device.setTargetTemperature(threshold));
  }

  async setTargetHeaterCoolerState(value: CharacteristicValue) {

    this.platform.log.debug(`Accessory: setTargetHeaterCoolerState() for device '${this.accessory.displayName}'`);

    let mode = CLIMATE_MODE_AUTO

    switch (value) {
      case this.platform.Characteristic.TargetHeaterCoolerState.AUTO:
        mode = CLIMATE_MODE_AUTO;
        break;

      case this.platform.Characteristic.TargetHeaterCoolerState.COOL:
        mode = CLIMATE_MODE_COOLING;
        break;

      case this.platform.Characteristic.TargetHeaterCoolerState.HEAT:
        mode = CLIMATE_MODE_HEATING;
        break;

      default:
        this.platform.log.error(`Unknown TargetHeaterCoolerState ${value}`);
        return;
    }


    this.assertCommand(await this.accessory.context.device.setOperationMode(mode));
  }

  async updateDeviceStatus(device: DaikinDevice) {

    try{

      this.platform.log.debug(`Accessory: updateDeviceStatus() for device '${this.accessory.displayName}'`);

      const active = this.accessory.context.device.getPowerStatus() ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;
    
      this.services['Climate'].updateCharacteristic(this.platform.Characteristic.Active, active);
      this.services['Climate'].updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.accessory.context.device.getIndoorTemperature());
  
      this.getCurrentHeaterCoolerState();

  
      // updateCharacteristic would re-add a removed optional characteristic,
      // so only push values for modes this accessory exposes.
      if (this._supportsHeat) {
        this.services['Climate'].updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, this.accessory.context.device.getTargetTemperatureWithMode(CLIMATE_MODE_HEATING));
      }
      if (this._supportsCool) {
        this.services['Climate'].updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, this.accessory.context.device.getTargetTemperatureWithMode(CLIMATE_MODE_COOLING));
      }
  
      this.services['HumiditySensor'].updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, this.accessory.context.device.getIndoorHumidity());

      const outdoorTemp = this.accessory.context.device.getOutdoorTemperature();
      if (Number.isFinite(outdoorTemp)) {
        this.services['OutdoorTemperatureSensor']
          .updateCharacteristic(this.platform.Characteristic.CurrentTemperature, outdoorTemp);
      }

      //this.services['MotionSensor'].updateCharacteristic(this.platform.Characteristic.On, this.accessory.context.device.getMotionDetection());

    }catch(e){
        this.platform.log.error(e);
    }




  }



}
