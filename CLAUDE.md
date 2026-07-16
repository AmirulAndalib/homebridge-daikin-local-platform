# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run build` — clean `dist/` and compile TypeScript (`src/` → `dist/`). The published entry point is `dist/index.js`.
- `npm run build-watch` — incremental compile.
- `npm run lint` — `eslint src/**.ts --max-warnings=0`. Lint must be clean to publish (`prepublishOnly` runs lint + build).
- `npx ts-node src/test.ts` — standalone harness that talks to real devices. Edit the hardcoded IP list at `src/test.ts:26` before running. There is no unit test framework.

To exercise the plugin in Homebridge during development, point a local Homebridge instance at the built `dist/` (e.g. `npm link` into the Homebridge install). The plugin registers under platform name `Daikin Local Platform` (see `src/settings.ts`).

## Architecture

This is a Homebridge **dynamic platform plugin**. Three layers, deliberately separated:

1. **`src/index.ts` → `src/platform.ts` (`DaikinPlatform`)** — Homebridge entry. On `DID_FINISH_LAUNCHING` it reads `climateIPs` from config, calls `DaikinLocalAPI.fetchDevices`, then for each returned device either restores the cached `PlatformAccessory` (matched by UUID derived from MAC address) or registers a new one. Cached accessories whose MAC is no longer present are unregistered. Each accessory is wrapped in a `ClimateAccessory`.

2. **Device protocol layer** (no Homebridge dependency) — an abstract `DaikinDevice` base class (`src/daikin-device.ts`) with one subclass per wire protocol. `DaikinLocalAPI.fetchDevices` (`src/daikin-local.ts`) auto-detects the protocol per IP by calling each subclass's `probe()` — dsiot first, then legacy — mirroring pydaikin's factory order. The base class owns the query throttle/coalescing (`queryDevice`), `fetchDeviceStatus`, the status callback and the shared rate-limited axios client (`maxRequests: 1, perMilliseconds: 500`); subclasses implement `_doQuery`, `probe` and all getters/setters. **Both subclasses exchange values in the shared `CLIMATE_MODE_*` / `CLIMATE_FAN_SPEED_*` hex codes** so the accessory layer is protocol-agnostic — a legacy device translates at its boundary.

   - **`DaikinDsiotDevice` (`src/daikin-local.ts`)** — newer firmware (2.8.0+). POSTs to `http://<ip>/dsiot/multireq` (see `src/const.ts`). The response is a deeply nested `{responses: [{fr, pc: {pch: [...]}}]}` tree; **all reads go through `extractValue` / `extractObject`**, which walk the tree by `fr` (resource path like `/dsiot/edge/adr_0100.dgc_status`) plus a `/`-separated `pn` path (e.g. `e_1002/e_3001/p_01`). All writes go through `sendCommand`, which wraps a `pch` payload under `e_1002` and POSTs with `op: 3`. Protocol details: target temperature / fan speed live under mode-dependent `pn` keys (heating=`p_03`, cooling=`p_02`, auto=`p_1D`, fan=`p_28`, dehumidify=`p_27`) — the mode/key maps `TARGET_TEMP_PN_BY_MODE` / `FAN_SPEED_PN_BY_MODE` are shared by the getters and setters. Temperatures are hex-encoded: read `parseInt(hex, 16) / 2.0`, written `(temp * 2).toString(16)`.
   - **`DaikinBRP069Device` (`src/daikin-brp069.ts`)** — legacy query-string protocol (BRP069-era adapters, the ones Home Assistant's pydaikin supports). Reads `GET /common/basic_info`, `/aircon/get_control_info`, `/aircon/get_sensor_info`, `/aircon/get_model_info` (comma-separated `key=value` bodies parsed by `parseResponse`; `basic_info`/`model_info` are static and fetched once). All writes go through `sendControl`, which **must send the full `pow/mode/stemp/shum(/f_rate/f_dir)` state in one `GET /aircon/set_control_info`**: it re-reads control info, merges overrides (`mergeControlValues`, which fills unspecified values from the unit's per-mode memory keys `dt<mode>`/`dh<mode>`/`dfr<mode>`) and builds the query (`buildControlParams`) — same semantics as pydaikin's `_update_settings()`. Legacy codes are translated to the shared constants at this boundary (mode `3`↔`CLIMATE_MODE_COOLING`, `f_rate` `A`↔`CLIMATE_FAN_SPEED_AUTO`, ...). The wire-code lookup tables live in overridable protected fields (`climateModeByDeviceMode` etc.), and `getResource`/`mergeControlValues`/`buildControlParams` are the designed override points for sibling firmwares.
   - **`DaikinAirBaseDevice` (`src/daikin-airbase.ts`)** — AirBase BRP15B61 (Australian ducted), subclass of `DaikinBRP069Device` exactly like pydaikin's `DaikinAirBase(DaikinBRP069)`. Differences, all expressed via the override points above: every path gets a `skyfi/` prefix; **different mode numbering** (`0`=fan `1`=heat `2`=cool `3`=auto `7`=dry — do not confuse with BRP069's); fans have 3 speeds (`f_rate` 1/3/5) plus a separate `f_auto` flag (auto is *not* an `f_rate` value); `set_control_info` requires the fixed parameter set `f_airside/f_auto/f_dir/f_rate/lpw/mode/pow/shum/stemp` on every call. Units usually lack `hhum`/`shum` and report `otemp=-` when no outdoor sensor exists. Zone control (`get/set_zone_setting`) is not implemented.

   Shared behaviour worth knowing: `queryDevice` self-throttles via `_lastUpdateTimestamp` + `MIN_REQUEST_INTERVAL_MS` (`const.ts`); pass `bForce=true` after a write so the next read sees fresh state (`sendCommand`/`sendControl` already do this). Mode codes and fan-speed codes are 4-char hex strings exported as constants from `src/daikin-device.ts` (re-exported by `daikin-local.ts`) — use them, don't inline literals. An IP entry may carry a port (`"192.168.1.5:8080"`), since URLs are built by string interpolation.

3. **`src/accessories/climate.ts` (`ClimateAccessory`)** — Maps a `DaikinDevice` onto a HomeKit `HeaterCooler` service plus auxiliary services. It registers a `setInterval` of `DEVICE_STATUS_REFRESH_INTERVAL` (30s) that calls `fetchDeviceStatus`, and the device's callback (`setCallback`) pushes new values back into HomeKit characteristics. When adding a new HomeKit characteristic, wire `onGet`/`onSet` here and update the callback handler so the periodic refresh propagates changes.

## Conventions

- Logging goes through `DaikinPlatformLogger` (`src/logger.ts`), which gates `debug` on `platformConfig.debugMode`. Don't log via `console.*`.
- `tsconfig.json` has `strict: true` but `noImplicitAny: false` — the response-tree code in `daikin-local.ts` relies on this for indexed access into untyped JSON.
- Bumping the plugin version: update `package.json` `version`. Releases are tagged commits like `1.2.6` (see `git log`).
