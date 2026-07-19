import { PlatformConfig } from 'homebridge';
import { DaikinDevice } from './daikin-local';


export interface DaikinPlatformConfig extends PlatformConfig {
  climateIPs: Array<string>;
  // Keys for secure BRP072C adapters: one { "<ip>": "<13-digit key>" } map
  // entry per unit, matching the IP exactly as written in climateIPs.
  climateKeys?: Array<Record<string, string>>;
  // climateIPs entries of units to expose as cooling-only in HomeKit
  // (Heating and Auto hidden) — an override for cool-only hardware whose
  // firmware advertises the full heat-pump mode mask.
  climateCoolingOnly?: Array<string>;
  debugMode: boolean;
}

export interface DaikinAccessoryContext {
  device: DaikinDevice;
}


