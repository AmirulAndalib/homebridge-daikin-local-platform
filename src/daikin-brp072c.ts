import axios from 'axios';
import { Agent } from 'https';
import { createHash, constants as cryptoConstants } from 'crypto';

import DaikinPlatformLogger from './logger';
import { DaikinBRP069Device, RESOURCE_BASIC_INFO } from './daikin-brp069';

// Secure BRP072Cxx adapters (the ones paired with the Daikin Comfort Control
// app) speak the exact same query-string protocol as BRP069, but only over
// HTTPS, and only to clients that registered an X-Daikin-uuid against the
// 13-digit key printed on the adapter. Mirrors pydaikin's DaikinBRP072C.
export const RESOURCE_REGISTER_TERMINAL = 'common/register_terminal';

// RFC 4122 version-3 UUID over the OID namespace, as 32 hex chars (the
// adapter expects the uuid without dashes). Deterministic on purpose: the
// adapter only remembers a handful of registered uuids, so every install
// re-using the same one avoids filling the slots — the same trick as
// pydaikin's uuid3(NAMESPACE_OID, 'pydaikin').
function uuid3Hex(name: string): string {
  const NAMESPACE_OID = Buffer.from('6ba7b8129dad11d180b400c04fd430c8', 'hex');
  const hash = createHash('md5').update(Buffer.concat([NAMESPACE_OID, Buffer.from(name)])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  return hash.toString('hex');
}

const DEFAULT_UUID = uuid3Hex('homebridge-daikin-local-platform');

export class DaikinBRP072CDevice extends DaikinBRP069Device {

  private readonly _uuid: string;
  private _registered = false;

  // The adapter presents a self-signed certificate over an ancient TLS stack;
  // OpenSSL 3 (Node 18+) refuses the handshake without the legacy options.
  private readonly _httpsAgent = new Agent({
    rejectUnauthorized: false,
    secureOptions: cryptoConstants.SSL_OP_LEGACY_SERVER_CONNECT,
    ciphers: 'DEFAULT:@SECLEVEL=0',
    minVersion: 'TLSv1',
  });

  constructor(
    IP: string,
    log: DaikinPlatformLogger,
    private readonly _key: string,
    uuid?: string,
  ) {
    super(IP, log);
    this._uuid = (uuid ?? DEFAULT_UUID).replace(/-/g, '');
  }

  public getProtocolName(): string {
    return 'BRP072C (secure)';
  }

  protected getBaseUrl(): string {
    return `https://${this._IP}`;
  }

  protected getExtraHeaders(): Record<string, string> {
    return { 'X-Daikin-uuid': this._uuid };
  }

  protected getHttpsAgent(): unknown {
    return this._httpsAgent;
  }

  // Registers our uuid against the adapter key, unlocking the aircon
  // endpoints for that uuid (pydaikin does the same in init()). Idempotent,
  // so re-registering after a failure is harmless.
  protected async register(): Promise<boolean> {

    if (this._registered) {
      return true;
    }

    try {

      const response = await this.requestResource(RESOURCE_REGISTER_TERMINAL, { 'key': this._key });

      this._registered = response.status === 200;

      return this._registered;

    }
    catch(e) {

      const status = axios.isAxiosError(e) ? e.response?.status : undefined;

      if (status === 403) {
        this.log.error(`Daikin: ${this._IP}: the adapter rejected the configured key (HTTP 403) - check the 13-digit key printed on the adapter/unit sticker.`);
      }
      else {
        // A key is configured for this IP, so the user expects the secure
        // protocol to work — surface the real reason (connection refused,
        // TLS handshake, unexpected status, ...) instead of hiding it
        // behind debugMode.
        this.log.error(`Daikin: ${this._IP}: could not register with the secure adapter ('https://${this._IP}/${RESOURCE_REGISTER_TERMINAL}' failed: ${this.describeRequestError(e)}).`);

        if (axios.isAxiosError(e) && (e.code === 'ECONNREFUSED' || e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' || e.code === 'EHOSTUNREACH')) {
          this.log.error(`Daikin: ${this._IP}: the secure protocol needs HTTPS (TCP port 443) access to the unit - check that no firewall between the Homebridge host and the unit blocks it.`);
        }
      }
    }

    return false;
  }

  public async probe(): Promise<boolean> {

    if (!(await this.register())) {
      return false;
    }

    return super.probe();
  }

  protected async _doQuery(): Promise<any> {

    if (!(await this.register())) {
      return undefined;
    }

    const result = await super._doQuery();

    // If the adapter rebooted and forgot our uuid the queries start failing;
    // dropping the flag makes the next cycle re-register (harmless otherwise).
    if (result === undefined) {
      this._registered = false;
    }

    return result;
  }

  // Unlike the plain-HTTP probes, this probe only runs when the user
  // configured a key for the IP, so a request failing after a successful
  // registration is worth surfacing at error level.
  protected logProbeFailure(e: unknown): void {
    this.log.error(`Daikin: ${this._IP}: secure request for '/${RESOURCE_BASIC_INFO}' failed after registration (${this.describeRequestError(e)}).`);
  }

  // The plain-HTTP hint from the base class doesn't apply here — we are
  // already on the secure protocol.
  protected logSecureAdapterHint(): void {}
}
