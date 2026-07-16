import {
  CLIMATE_MODE_FAN,
  CLIMATE_MODE_HEATING,
  CLIMATE_MODE_COOLING,
  CLIMATE_MODE_AUTO,
  CLIMATE_MODE_DEHUMIDIFY,
  CLIMATE_FAN_SPEED_AUTO,
  CLIMATE_FAN_SPEED_SLIENT,
  CLIMATE_FAN_SPEED_1,
  CLIMATE_FAN_SPEED_2,
  CLIMATE_FAN_SPEED_3,
  CLIMATE_FAN_SPEED_4,
  CLIMATE_FAN_SPEED_5,
} from './daikin-device';

import {
  DaikinBRP069Device,
  RESOURCE_CONTROL_INFO,
  RESOURCE_MODEL_INFO,
  RESOURCE_SENSOR_INFO,
} from './daikin-brp069';

// AirBase (BRP15B61) adapters, common on Australian ducted systems. Same
// query-string protocol as BRP069 but with every path under a `skyfi/`
// prefix, different mode / fan-rate numbering and a fixed set_control_info
// parameter set. Semantics follow pydaikin's daikin_airbase.py.

// AirBase `mode` codes: 0 = fan, 1 = heat, 2 = cool, 3 = auto, 7 = dry.
const CLIMATE_MODE_BY_AIRBASE_MODE: Record<string, string> = {
  '0': CLIMATE_MODE_FAN,
  '1': CLIMATE_MODE_HEATING,
  '2': CLIMATE_MODE_COOLING,
  '3': CLIMATE_MODE_AUTO,
  '7': CLIMATE_MODE_DEHUMIDIFY,
};

const AIRBASE_MODE_BY_CLIMATE_MODE: Record<string, string> = {
  [CLIMATE_MODE_FAN]: '0',
  [CLIMATE_MODE_HEATING]: '1',
  [CLIMATE_MODE_COOLING]: '2',
  [CLIMATE_MODE_AUTO]: '3',
  [CLIMATE_MODE_DEHUMIDIFY]: '7',
};

// Per-mode target-temperature memory keys (dt<mode>): dt1 = heat, dt2 = cool.
const AIRBASE_TARGET_TEMP_KEY_BY_MODE: Record<string, string> = {
  [CLIMATE_MODE_HEATING]: 'dt1',
  [CLIMATE_MODE_COOLING]: 'dt2',
  [CLIMATE_MODE_AUTO]: 'dt3',
  [CLIMATE_MODE_DEHUMIDIFY]: 'dt7',
};

// AirBase fans have three speeds (1 = low, 3 = mid, 5 = high) plus a separate
// f_auto flag; quantize the plugin's five levels onto them.
const AIRBASE_F_RATE_BY_FAN_SPEED_CODE: Record<string, string> = {
  [CLIMATE_FAN_SPEED_SLIENT]: '1',
  [CLIMATE_FAN_SPEED_1]: '1',
  [CLIMATE_FAN_SPEED_2]: '1',
  [CLIMATE_FAN_SPEED_3]: '3',
  [CLIMATE_FAN_SPEED_4]: '5',
  [CLIMATE_FAN_SPEED_5]: '5',
};

const FAN_SPEED_CODE_BY_AIRBASE_F_RATE: Record<string, string> = {
  '0': CLIMATE_FAN_SPEED_AUTO,
  '1': CLIMATE_FAN_SPEED_1,
  '3': CLIMATE_FAN_SPEED_3,
  '5': CLIMATE_FAN_SPEED_5,
};

export class DaikinAirBaseDevice extends DaikinBRP069Device {

  protected readonly climateModeByDeviceMode: Record<string, string> = CLIMATE_MODE_BY_AIRBASE_MODE;
  protected readonly deviceModeByClimateMode: Record<string, string> = AIRBASE_MODE_BY_CLIMATE_MODE;
  protected readonly targetTempKeyByMode: Record<string, string> = AIRBASE_TARGET_TEMP_KEY_BY_MODE;

  public getProtocolName(): string {
    return 'AirBase (BRP15)';
  }

  // Every AirBase endpoint lives under the skyfi/ prefix.
  protected async getResource(path: string, params?: Record<string, string>): Promise<Record<string, string> | undefined> {
    return super.getResource(`skyfi/${path}`, params);
  }

  public getDeviceType(): string {

    const model = this.getValue(RESOURCE_MODEL_INFO, 'model');

    if (model && model !== 'NOTSUPPORT') {
      return model;
    }

    // AirBase adapters report model=NOTSUPPORT; use the adapter name instead.
    return 'Airbase BRP15B61';
  }

  // AirBase units report otemp='-' when no outdoor thermometer is fitted.
  public supportsOutdoorTemperature(): boolean {
    return Number.isFinite(this.getNumber(RESOURCE_SENSOR_INFO, 'otemp'));
  }

  // Fan-speed auto lives in the separate f_auto flag, not in f_rate.
  public getFanSpeed(): string {

    if (this.getValue(RESOURCE_CONTROL_INFO, 'f_auto') === '1') {
      return CLIMATE_FAN_SPEED_AUTO;
    }

    const rate = this.getValue(RESOURCE_CONTROL_INFO, 'f_rate');

    return (rate !== undefined ? FAN_SPEED_CODE_BY_AIRBASE_F_RATE[rate] : undefined) ?? CLIMATE_FAN_SPEED_AUTO;
  }

  public async setFanSpeed(speed: string): Promise<boolean> {

    if (speed === CLIMATE_FAN_SPEED_AUTO) {
      // Keep the current base rate (dfr<mode> memory fills f_rate) and raise the flag.
      return await this.sendControl({ 'f_auto': '1' });
    }

    const rate = AIRBASE_F_RATE_BY_FAN_SPEED_CODE[speed];

    if (rate === undefined) {
      this.log.debug(`Daikin - setFanSpeed(): Error: unsupported speed: '${speed}'`);
      return false;
    }

    return await this.sendControl({ 'f_rate': rate, 'f_auto': '0' });
  }

  protected mergeControlValues(current: Record<string, string>, overrides: Record<string, string>): Record<string, string> {

    const values = super.mergeControlValues(current, overrides);

    // When the fan speed isn't being changed, follow the unit's per-mode
    // auto-fan memory (auto<mode>), mirroring pydaikin's _update_settings().
    if (current['f_auto'] !== undefined && !('f_auto' in overrides) && !('f_rate' in overrides)) {
      const memorized = current['auto' + values['mode']];
      if (memorized !== undefined) {
        values['f_auto'] = memorized;
      }
    }

    return values;
  }

  // The AirBase firmware expects this exact parameter set (including the
  // empty lpw and f_airside) on every set_control_info call.
  protected buildControlParams(current: Record<string, string>, values: Record<string, string>): Record<string, string> {

    return {
      'f_airside': values['f_airside'] ?? '0',
      'f_auto': values['f_auto'] ?? '0',
      'f_dir': values['f_dir'] ?? '0',
      'f_rate': (values['f_rate'] ?? '1').charAt(0),
      'lpw': '',
      'mode': values['mode'],
      'pow': values['pow'],
      'shum': values['shum'] ?? '--',
      'stemp': values['stemp'],
    };
  }

}
