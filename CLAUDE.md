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

2. **`src/daikin-local.ts`** — Device protocol layer, no Homebridge dependency. `DaikinDevice` POSTs to `http://<ip>/dsiot/multireq` (see `src/const.ts`) using a shared rate-limited axios client (`maxRequests: 1, perMilliseconds: 500`). The Daikin response is a deeply nested `{responses: [{fr, pc: {pch: [...]}}]}` tree; **all reads go through `extractValue` / `extractObject`**, which walk the tree by `fr` (resource path like `/dsiot/edge/adr_0100.dgc_status`) plus a `/`-separated `pn` path (e.g. `e_1002/e_3001/p_01`). All writes go through `sendCommand`, which wraps a `pch` payload under `e_1002` and POSTs with `op: 3`.

   Two protocol details worth knowing before editing:
   - **Mode-dependent property names.** Target temperature, fan speed, etc. live under different `pn` keys depending on current operation mode (heating=`p_03`, cooling=`p_02`, auto=`p_1D`, fan=`p_28`, dehumidify=`p_27`). The mode/key mapping is duplicated across `getTargetTemperature`, `setTargetTemperature`, `getFanSpeed`, `setFanSpeed`, `getTargetTemperatureRange` — keep them in sync.
   - **Hex-encoded values.** Temperatures are stored as `parseInt(hex, 16) / 2.0` and written as `(temp * 2).toString(16)`. Mode codes (`CLIMATE_MODE_*`) and fan-speed codes (`CLIMATE_FAN_SPEED_*`) are 4-char hex strings exported as constants — use them, don't inline literals.
   - `queryDevice` self-throttles via `_lastUpdateTimestamp` + `SECONDS_BETWEEN_REQUEST` (`const.ts`); pass `bForce=true` after a write so the next read sees fresh state (`sendCommand` already does this).

3. **`src/accessories/climate.ts` (`ClimateAccessory`)** — Maps a `DaikinDevice` onto a HomeKit `HeaterCooler` service plus auxiliary services. It registers a `setInterval` of `DEVICE_STATUS_REFRESH_INTERVAL` (30s) that calls `fetchDeviceStatus`, and the device's callback (`setCallback`) pushes new values back into HomeKit characteristics. When adding a new HomeKit characteristic, wire `onGet`/`onSet` here and update the callback handler so the periodic refresh propagates changes.

## Conventions

- Logging goes through `DaikinPlatformLogger` (`src/logger.ts`), which gates `debug` on `platformConfig.debugMode`. Don't log via `console.*`.
- `tsconfig.json` has `strict: true` but `noImplicitAny: false` — the response-tree code in `daikin-local.ts` relies on this for indexed access into untyped JSON.
- Bumping the plugin version: update `package.json` `version`. Releases are tagged commits like `1.2.6` (see `git log`).
