import DaikinPlatformLogger from './logger';
import axios from 'axios';
import rateLimit from 'axios-rate-limit';

import {
  USER_AGENT,
  ENDPOINT,
  MIN_REQUEST_INTERVAL_MS,
  REQUEST_TIMEOUT_MS
} from './const';

export const CLIMATE_MODE_FAN = '0000';
export const CLIMATE_MODE_HEATING = '0100';
export const CLIMATE_MODE_COOLING = '0200';
export const CLIMATE_MODE_AUTO = '0300';
export const CLIMATE_MODE_DEHUMIDIFY = '0500';
export const CLIMATE_MODE_HUMIDIFY = '0800';

export const CLIMATE_FAN_SPEED_AUTO = '0A00';
export const CLIMATE_FAN_SPEED_SLIENT = '0B00';
export const CLIMATE_FAN_SPEED_1 = '0300';
export const CLIMATE_FAN_SPEED_2 = '0400';
export const CLIMATE_FAN_SPEED_3 = '0500';
export const CLIMATE_FAN_SPEED_4 = '0600';
export const CLIMATE_FAN_SPEED_5 = '0700';

const CLIMATE_OPERATE_ON = '00';
const CLIMATE_OPERATE_OFF = '01';
const CLIMATE_OPERATE_SETTING = '02';

const MODE_NAME_BY_CODE: Record<string, string> = {
  [CLIMATE_MODE_FAN]: 'Fan',
  [CLIMATE_MODE_HEATING]: 'Heating',
  [CLIMATE_MODE_COOLING]: 'Cooling',
  [CLIMATE_MODE_AUTO]: 'Auto',
  [CLIMATE_MODE_DEHUMIDIFY]: 'Dehumidify',
  [CLIMATE_MODE_HUMIDIFY]: 'Humidify',
};

// Target temperature lives under a mode-dependent `pn` key inside e_1002/e_3001.
const TARGET_TEMP_PN_BY_MODE: Record<string, string> = {
  [CLIMATE_MODE_HEATING]: 'p_03',
  [CLIMATE_MODE_COOLING]: 'p_02',
  [CLIMATE_MODE_AUTO]: 'p_1D',
};

// Fan speed lives under a mode-dependent `pn` key inside e_1002/e_3001.
// Modes not listed here fall back to the cooling key (p_09).
const FAN_SPEED_PN_BY_MODE: Record<string, string> = {
  [CLIMATE_MODE_FAN]: 'p_28',
  [CLIMATE_MODE_DEHUMIDIFY]: 'p_27',
  [CLIMATE_MODE_AUTO]: 'p_26',
  [CLIMATE_MODE_HEATING]: 'p_0A',
  [CLIMATE_MODE_COOLING]: 'p_09',
};
const FAN_SPEED_PN_DEFAULT = 'p_09';

// Bidirectional mapping between Daikin fan-speed codes, the HomeKit rotation-speed
// step (0 = auto ... 6 = level 5) and the human-readable name.
export const FAN_SPEED_TABLE: { code: string; number: number; name: string }[] = [
  { code: CLIMATE_FAN_SPEED_AUTO, number: 0, name: 'Auto' },
  { code: CLIMATE_FAN_SPEED_SLIENT, number: 1, name: 'Silent' },
  { code: CLIMATE_FAN_SPEED_1, number: 2, name: '1' },
  { code: CLIMATE_FAN_SPEED_2, number: 3, name: '2' },
  { code: CLIMATE_FAN_SPEED_3, number: 4, name: '3' },
  { code: CLIMATE_FAN_SPEED_4, number: 5, name: '4' },
  { code: CLIMATE_FAN_SPEED_5, number: 6, name: '5' },
];

const COMMAND_QUERY = '{"requests":[{"op":2,"to":"/dsiot/edge.adp_i?filter=pv"},{"op":2,"to":"/dsiot/edge.adp_d?filter=pv"},{"op":2,"to":"/dsiot/edge.adp_f?filter=pv"},{"op":2,"to":"/dsiot/edge.dev_i?filter=pv"},{"op":2,"to":"/dsiot/edge/adr_0100.dgc_status?filter=pv"}]}';
const COMMAND_QUERY_WITH_MD = '{"requests":[{"op":2,"to":"/dsiot/edge.adp_i?filter=pv"},{"op":2,"to":"/dsiot/edge.adp_d?filter=pv"},{"op":2,"to":"/dsiot/edge.adp_f?filter=pv"},{"op":2,"to":"/dsiot/edge.dev_i?filter=pv"},{"op":2,"to":"/dsiot/edge/adr_0100.dgc_status"},{"op":2,"to":"/dsiot/edge/adr_0200.dgc_status"}]}';

const http = rateLimit(axios.create(), { maxRequests: 1, perMilliseconds: 500 });

export class DaikinDevice {

  protected _IP: string;
  protected _Response: object;
  protected _log: DaikinPlatformLogger;
  protected _lastUpdateTimestamp: number = 0;
  protected _callback: ((device: DaikinDevice) => void) | null = null;
  // Shared promise for an in-flight query so concurrent reads don't each hit the unit.
  protected _inflightQuery: Promise<any> | null = null;

  constructor(
    public readonly IP: string,
    private readonly log: DaikinPlatformLogger,
  ) {
    this._IP = IP;
    this._Response = {};
    this._log = log;
  }

  public setCallback(callback: (device: DaikinDevice) => void) {
    this._callback = callback;
  }

  protected async post(data: string): Promise<any> {
    return http.request({
      method: 'post',
      url: `http://${this._IP}${ENDPOINT}`,
      headers: {
        'Accept': 'application/json; charset=UTF-8',
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      data,
      timeout: REQUEST_TIMEOUT_MS,
    });
  }

  public async queryDevice(bForce:boolean = false): Promise<any> {

    if(!bForce) {
      if((Date.now() - this._lastUpdateTimestamp) < MIN_REQUEST_INTERVAL_MS) {
        this.log.debug(`Daikin - queryDevice('${this._IP}'): Skipping query as last update was less than ${MIN_REQUEST_INTERVAL_MS} ms ago`);
        return this._Response;
      }

      // Coalesce concurrent (non-forced) reads onto a single request.
      if(this._inflightQuery) {
        return this._inflightQuery;
      }
    }

    const request = this._doQuery();

    if(!bForce) {
      this._inflightQuery = request;
    }

    try {
      return await request;
    }
    finally {
      if(this._inflightQuery === request) {
        this._inflightQuery = null;
      }
    }
  }

  protected async _doQuery(): Promise<any> {

    try{

      const response = await this.post(COMMAND_QUERY_WITH_MD);

      this._lastUpdateTimestamp = Date.now();

      if(response.status === 200) {
        //this.log.debug(`Daikin - queryDevice('${this._IP}'): Response: '${JSON.stringify(response.data)}'`);
        this._Response = response.data;
        return response.data;
      }

      this.log.debug(`Daikin - queryDevice('${this._IP}'): Error: Invalid response status code: '${response.status}'`);

    }
    catch(e) {
      this.log.debug(`Daikin - queryDevice('${this._IP}'): Error: '${e}'`);
    }

    return undefined;
  }

  public async fetchDeviceStatus(bForce:boolean = false): Promise<boolean> {

    const response = await this.queryDevice(bForce);

    if(response === undefined) {
      this.log.error(`Daikin - fetchDeviceStatus(${bForce}): Error: No response from device`);
      return false;
    }


    if(!this.getMacAddress()){
      this.log.error(`Daikin - fetchDeviceStatus(${bForce}): Error: ${this._IP} no MAC address found`);
      this.log.debug(`Daikin - fetchDeviceStatus(${bForce}): Response: '${this._Response}'`);
      return false;
    }

    
    this.log.debug(`Daikin - fetchDeviceStatus(${bForce}): Name: ${this.getDeviceName()} MAC:${this.getMacAddress()} Power:${this.getPowerStatus()} Temp:${this.getIndoorTemperature()} Humidity:${this.getIndoorHumidity()} Target Temp:${this.getTargetTemperature()}'  Mode:${this.getOperationModeName()} FanSpeed:${this.getFanSpeedName()} `);

    if(this._callback) {
      this._callback(this);
    }
    
    return true;  
  }

  public async setShowSSID(bShow: boolean): Promise<boolean> {
     

    this.log.debug(`Daikin - setShowSSID(${bShow}): Name: ${this.getDeviceName()}`);
    const command = {"requests":[{"op":3,"to":"/dsiot/edge.adp_d","pc":{"pn":"adp_d","pch":[{"pn":"disp_ssid","pv": bShow ? 0 :1 }]}}]};

    try{

      const response = await this.post(JSON.stringify(command));

      return response.status === 200;

    }catch(e) {
      this.log.debug(`Daikin - setShowSSID('${this._IP}'): Error: '${e}'`);
    }

    return false;

  }

  public getMacAddress(): string {
    return this.extractValue(this._Response, '/dsiot/edge.adp_i', 'mac');
  }

  public getSSID(): string {
    return this.extractValue(this._Response, '/dsiot/edge.adp_i', 'ssid');
  }

  public getDeviceName(): string {
    return this.extractValue(this._Response, '/dsiot/edge.adp_d', 'name');
  }

  public getDeviceReg(): string {
    return this.extractValue(this._Response, '/dsiot/edge.adp_i', 'reg');
  }

  public getDeviceType(): string {
    return this.extractValue(this._Response, '/dsiot/edge.dev_i', 'type') + this.extractValue(this._Response, '/dsiot/edge.adp_i', 'enlv');
  }

  public getFirmwareVersion(): string {
    return this.extractValue(this._Response, '/dsiot/edge.adp_i', 'ver');
  }
  

  public getDeviceIP(): string {
    return this._IP;  
  }

  public getPowerStatus(): boolean {
    return this.extractValue(this._Response, '/dsiot/edge/adr_0100.dgc_status', 'e_1002/e_A002/p_01') === '01'; 
  }

  public getIndoorTemperature(): number {
    return parseInt(this.extractValue(this._Response, '/dsiot/edge/adr_0100.dgc_status', 'e_1002/e_A00B/p_01'), 16);
  }

  public getIndoorHumidity(): number {
    return parseInt(this.extractValue(this._Response, '/dsiot/edge/adr_0100.dgc_status', 'e_1002/e_A00B/p_02'), 16);
  }

  // Outdoor temperature lives on the outdoor unit at adr_0200, encoded as
  // little-endian signed int16 of (temperature * 2). Returns NaN if absent.
  public getOutdoorTemperature(): number {
    const raw = this.extractValue(this._Response, '/dsiot/edge/adr_0200.dgc_status', 'e_1003/e_A00D/p_01');
    if (typeof raw !== 'string' || raw.length !== 4) {
      return NaN;
    }
    const lo = parseInt(raw.substring(0, 2), 16);
    const hi = parseInt(raw.substring(2, 4), 16);
    let val = (hi << 8) | lo;
    if (val & 0x8000) {
      val -= 0x10000;
    }
    return val / 2;
  }

  //0000:fan 0100:heating 0200:cooling 0300:auto 0500:dehumidify
  public getOperationMode(): string {

    return this.extractValue(this._Response, '/dsiot/edge/adr_0100.dgc_status', 'e_1002/e_3001/p_01');

  }

  public getOperationModeName(): string {

    return MODE_NAME_BY_CODE[this.getOperationMode()] ?? 'Unknown';

  }

  // The mode property's metadata `mx` is a little-endian bitmask of the mode
  // codes the unit accepts: bit n set = mode code n supported. Example: a
  // heat-pump unit reports '2F00' (0x002F -> bits 0,1,2,3,5) = fan, heating,
  // cooling, auto and dehumidify; a cool-only unit reports the heating bit
  // cleared. Devices without the metadata are treated as supporting every
  // mode, which matches the behaviour before capability detection existed.
  public supportsOperationMode(mode: string): boolean {

    const element = this.extractObject(this._Response, '/dsiot/edge/adr_0100.dgc_status', 'e_1002/e_3001/p_01');
    const md = element ? element['md'] : undefined;
    const mx = md ? md['mx'] : undefined;

    if(typeof mx !== 'string' || mx.length !== 4) {
      return true;
    }

    const mask = parseInt(mx.substring(2, 4) + mx.substring(0, 2), 16);
    const bit = parseInt(mode.substring(2, 4) + mode.substring(0, 2), 16);

    if(Number.isNaN(mask) || Number.isNaN(bit)) {
      return true;
    }

    return (mask & (1 << bit)) !== 0;
  }

  public getSupportedOperationModeNames(): string[] {

    return Object.keys(MODE_NAME_BY_CODE)
      .filter(mode => this.supportsOperationMode(mode))
      .map(mode => MODE_NAME_BY_CODE[mode]);
  }

  public getTargetTemperatureWithMode(mode:string): number {

    const pn = TARGET_TEMP_PN_BY_MODE[mode];

    if(!pn) {
      this.log.debug(`Daikin - getTargetTemperature(): Error: Invalid mode: '${mode}'`);
      return 0;
    }

    return parseInt(this.extractValue(this._Response, '/dsiot/edge/adr_0100.dgc_status', 'e_1002/e_3001/' + pn), 16) / 2.0;
  }

  public getTargetTemperature(): number {

    const mode = this.getOperationMode();

    return this.getTargetTemperatureWithMode(mode);

  }

  public getTargetTemperatureRange(): number[] {
  
    const mode = this.getOperationMode();
    const pn = TARGET_TEMP_PN_BY_MODE[mode];

    if(!pn) {
      this.log.debug(`Daikin - getTargetTemperatureRange(): Error: Invalid mode: '${mode}'`);
      return [0, 0];
    }

    const md = this.extractObject(this._Response, '/dsiot/edge/adr_0100.dgc_status', 'e_1002/e_3001/' + pn);

    const min = md ? parseInt(md['md']['mi'], 16) / 2.0 : 0;
    const max = md ? parseInt(md['md']['mx'], 16) / 2.0 : 0;

    return [min, max];

  
  }

  public getCoolingThresholdTemperatureRange(): number[] {
  
    const md = this.extractObject(this._Response, '/dsiot/edge/adr_0100.dgc_status', 'e_1002/e_3001/p_02');

    const min = md ? parseInt(md['md']['mi'], 16) / 2.0 : 0;
    const max = md ? parseInt(md['md']['mx'], 16) / 2.0 : 0;

    return [min, max];
  
  }

  public getHeatingThresholdTemperatureRange(): number[] {
  
    const md = this.extractObject(this._Response, '/dsiot/edge/adr_0100.dgc_status', 'e_1002/e_3001/p_03');

    const min = md ? parseInt(md['md']['mi'], 16) / 2.0 : 0;
    const max = md ? parseInt(md['md']['mx'], 16) / 2.0 : 0;

    return [min, max];
  
  }


  public getFanSpeed(): string {

    const mode = this.getOperationMode();
    const pn = FAN_SPEED_PN_BY_MODE[mode] ?? FAN_SPEED_PN_DEFAULT;

    return this.extractValue(this._Response, '/dsiot/edge/adr_0100.dgc_status', 'e_1002/e_3001/' + pn);

  }

  public getFanSpeedName(): string {

    const speed = this.getFanSpeed();

    return FAN_SPEED_TABLE.find(entry => entry.code === speed)?.name ?? 'Unknown';
  }

  public getFanSpeedNumber(): number {

    const speed = this.getFanSpeed();

    return FAN_SPEED_TABLE.find(entry => entry.code === speed)?.number ?? 0;
  }

  public getMotionDetection(): boolean {
    return this.extractValue(this._Response, '/dsiot/edge/adr_0100.dgc_status', 'e_1002/e_3003/p_27') === '01'; 
  }

  public async setMotionDetection(bEnable: boolean): Promise<boolean> {
      
      const command = [{"pn": "e_3003", "pch": [{"pn": "p_27", "pv": bEnable ? '01':'00'}]}];
      return await this.sendCommand(command);
  
  }

  public async setPowerStatus(power: boolean): Promise<boolean> {

    // p_2D is the operation-type flag. Sending SETTING ('02') makes the unit treat the
    // stop as a mere config change, so it skips the post-stop 内部クリーン (mould-proof) dry
    // cycle. Sending the genuine OFF ('01') makes it a normal user stop, which triggers the
    // dry cycle when the unit's auto-internal-clean setting is enabled — matching the remote.
    const operate = power ? CLIMATE_OPERATE_ON : CLIMATE_OPERATE_OFF;
    const command = [{"pn": "e_3003", "pch": [{"pn": "p_2D", "pv": operate }]}, {"pn": "e_A002","pch": [{"pn": "p_01", "pv": power ? '01':'00'}]}];
    return await this.sendCommand(command);

  }

  public async setOperationMode(mode: string): Promise<boolean> {

    const command = [{"pn": "e_3003", "pch": [{"pn": "p_2D", "pv": CLIMATE_OPERATE_SETTING}]}, {"pn": "e_3001","pch": [{"pn": "p_01", "pv": mode}]}];
    return await this.sendCommand(command);

  }

  public async setTargetTemperature(temperature: number): Promise<boolean> {

    const mode = this.getOperationMode();

    const pn = TARGET_TEMP_PN_BY_MODE[mode];

    if(!pn) {
      return false;
    }

    const pv = (temperature * 2).toString(16);

    const command = [{"pn": "e_3003", "pch": [{"pn": "p_2D", "pv": CLIMATE_OPERATE_SETTING}]}, {"pn": "e_3001","pch": [{"pn": pn, "pv": pv}]}];

    if(mode === CLIMATE_MODE_COOLING) {
      this.pushObject(command, 'e_3001', {"pn": "p_0B", "pv": '0A'});
      this.pushObject(command, 'e_3001', {"pn": "p_0C", "pv": '01'});    
    
    }
    
    return await this.sendCommand(command);

  }

  public async setFanSpeed(speed: string): Promise<boolean> {

    const mode = this.getOperationMode();

    const pn = FAN_SPEED_PN_BY_MODE[mode] ?? FAN_SPEED_PN_DEFAULT;

    const command = [{"pn": "e_3003", "pch": [{"pn": "p_2D", "pv": CLIMATE_OPERATE_SETTING}]}, {"pn": "e_3001","pch": [{"pn": pn, "pv": speed}]}];
    return await this.sendCommand(command);
  }

  public extractValue(responsesData: object, fr: string, path: string): any | undefined {

    const element = this.extractObject(responsesData, fr, path);

    return element ? element['pv'] : undefined;
  }

  public extractObject(responsesData: object, fr: string, path: string): object | undefined {

    try {
  
      if(responsesData === undefined || responsesData.hasOwnProperty('responses') === false) {
        this.log.debug('Daikin - extractObject(): Error: No responses object found');
        return undefined;
      }
  
  
  
      let currentObject = responsesData['responses'];
  
      for(const response of currentObject) {
        if (response['fr'] === fr) {
          currentObject = response['pc']['pch'];
        }
      }
  
      const pathKeys = path.split('/');
  
      for (const key of pathKeys) {
        try{
          
          for(const currentObjectElement of currentObject) {
            if (currentObjectElement['pn'] === key && currentObjectElement.hasOwnProperty('pch')) {
              currentObject = currentObjectElement['pch'];
              break;
            }
            else if (currentObjectElement['pn'] === key && currentObjectElement.hasOwnProperty('pv')) {
              return currentObjectElement;
            }
  
          }
  
  
        } catch (e) {
          this.log.debug('Daikin - extractValue(): Error:' + e);
        }
  
  
  
      }
    }
    catch (e) {
      this.log.debug('Daikin - extractValue(): Error:' + e);
    }
  
  
    this.log.debug('Daikin - extractValue(): Error: No value found for path:' + path);
  
    return undefined;
  }

  // const command = [{"pn": "e_3003", "pch": [{"pn": "p_2D", "pv": CLIMATE_OPERATE_SETTING}]}, {"pn": "e_3001","pch": [{"pn": pn, "pv": speed}]}];

  public pushObject(jsonData: Object, pn: string, obj: object): object | undefined {
  
    try{
 
      for(const i in jsonData) {
        const currentObject = jsonData[i];
        if (currentObject['pn'] === pn && currentObject.hasOwnProperty('pch')) {
          currentObject['pch'].push(obj);
          return jsonData;
        }
      }
      

    }catch (e) {
      this.log.debug('Daikin - pushObject(): Error:' + e);
    }

    return undefined;


  
  }

  protected async sendCommand(command: object): Promise<boolean> {

    const param = {"requests": [{"op": 3,"to": "/dsiot/edge/adr_0100.dgc_status","pc": {"pn": "dgc_status","pch": [{"pn": "e_1002","pch": command}]}}]};

    try{

      const response = await this.post(JSON.stringify(param));


      if(response.status === 200) {
        this.log.debug(`Daikin - sendCommand('${this._IP}'):  '${JSON.stringify(param)} ' : Response: '${JSON.stringify(response.data)}'`);
      }
      else{
        this.log.debug(`Daikin - sendCommand('${this._IP}'): '${JSON.stringify(param)} ' : Error: Invalid response status code: '${response.status}'`);
      }
  
      await this.fetchDeviceStatus(true);
  
      return response.status === 200;
      
    }
    catch(e) {
      this.log.debug(`Daikin - sendCommand('${this._IP}'): Error: '${e}'`);
    }

    return false;


  }

}



const FETCH_ATTEMPTS = 3;
const FETCH_RETRY_DELAY_MS = 2000;

export class DaikinLocalAPI {

  private _devices: DaikinDevice[];

  constructor(
    private readonly log: DaikinPlatformLogger,
  ) {

    this._devices = [];

  }

  public async fetchDevices(climateIPs:string[], bForce:boolean = false): Promise<DaikinDevice[]> {

    this.log.debug('Daikin: fetchDevices()');
    this._devices = [];

    for(const ip of climateIPs) {
      const daikinDevice = new DaikinDevice(ip, this.log);

      if(await this.fetchWithRetry(daikinDevice, bForce)) {
        this._devices.push(daikinDevice);
      }
      else {
        this.log.error(`Daikin: device at ${ip} did not respond after ${FETCH_ATTEMPTS} attempts - skipping.`);
      }

    }

    return this._devices;
  }

  // A device that is briefly unreachable at startup (e.g. still booting) would
  // otherwise be dropped until Homebridge restarts; retry a few times first.
  private async fetchWithRetry(device: DaikinDevice, bForce: boolean): Promise<boolean> {

    for(let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {

      if(await device.fetchDeviceStatus(bForce || attempt > 1)) {
        return true;
      }

      if(attempt < FETCH_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, FETCH_RETRY_DELAY_MS));
      }
    }

    return false;
  }

}

