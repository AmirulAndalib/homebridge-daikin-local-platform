export const ENDPOINT = '/dsiot/multireq';
export const USER_AGENT = 'DaikinMobileController/1.0.0 CFNetwork/1410.0.3 Darwin/22.6.0';

// Minimum time between two device queries; a read inside this window returns the
// cached response instead of hitting the unit again.
export const MIN_REQUEST_INTERVAL_MS = 2000;

// Abort a device request that hasn't responded within this window so a hung
// connection can't stall the shared rate-limited queue.
export const REQUEST_TIMEOUT_MS = 20 * 1000;

export const DEVICE_STATUS_REFRESH_INTERVAL = 30 * 1000;
