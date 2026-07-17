import { PlatformConfig } from 'homebridge';
import { DaikinDevice } from './daikin-local';


export interface DaikinPlatformConfig extends PlatformConfig {
  climateIPs: Array<string>;
  // Keys for secure BRP072C adapters: one { "<ip>": "<13-digit key>" } map
  // entry per unit, matching the IP exactly as written in climateIPs.
  climateKeys?: Array<Record<string, string>>;
  debugMode: boolean;
}

export interface DaikinAccessoryContext {
  device: DaikinDevice;
}


