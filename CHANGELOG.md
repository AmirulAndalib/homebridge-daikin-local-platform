# Changelog

## 1.4.4 (2026-07-18)

- Moved secure adapter (BRP072C) keys into the device list: editing a device now shows its 13-digit key field whenever the unit needs one (with a *Secure adapter* checkbox for units the scan cannot reach), and adding a discovered secure unit opens the form with the key field focused. The separate keys section — and its error-prone requirement to repeat the IP exactly — is gone; the key follows the device, including when its IP is edited.
- Existing `climateKeys` entries are matched to their device automatically (bare-IP entries written for an `ip:port` device are repaired to the exact form the plugin looks up); entries matching no device stay visible as *unused key* rows to re-adopt or delete, instead of being dropped silently. `climateKeys` is now also declared in `config.schema.json`.
- Fixed muted text in the settings UI (device details, help text) being unreadable when Homebridge uses a dark theme.
- Log the reason when the secure (BRP072C) probe fails, so misconfigured keys are easier to diagnose.

## 1.4.3 (2026-07-17)

- Fixed spacing and styling in the settings UI that was broken by the Bootstrap version loaded in the Config UI X iframe.
- Right-aligned the per-row action buttons in the settings UI device list.

## 1.4.2 (2026-07-17)

- Merged the network finder into a unified device list in the settings UI: configured and discovered units now appear in one list with per-row add/edit/remove actions and `found` / `needs key` / `no reply` badges. The list auto-scans on page open and can be rescanned on demand.

## 1.4.1 (2026-07-17)

- Restructured the settings UI into a task-ordered layout: the device list first, with the secure adapter keys (BRP072C) and advanced options in collapsed sections below.

## 1.4.0 (2026-07-17)

- Added support for secure BRP072C-style adapters (units paired with the Daikin Comfort Control app, e.g. US ATMOSPHERA built-in WiFi). These use HTTPS with legacy TLS and require the 13-digit key printed on the unit, configured via the new `climateKeys` setting.
- Added a LAN device finder to the settings UI that discovers Daikin adapters via UDP broadcast.
- Improved discovery diagnostics: probe failures now log which protocol was ruled out for each IP.

## 1.3.0 (2026-07-16)

- Added support for legacy BRP069-era adapters and AirBase BRP15B61 (Australian ducted) units. The protocol for each configured IP is now auto-detected, alongside the existing support for newer (dsiot) firmware.

## 1.2.9 (2026-07-16)

- HomeKit now only offers the operation modes the device actually supports, instead of always showing auto/heat/cool.

## 1.2.8 (2026-07-01)

- Maintenance release, no functional changes.

## 1.2.7 (2026-07-01)

- Added outdoor temperature support (exposed as a separate temperature sensor).
- Device commands are now awaited and redundant HomeKit characteristic writes are skipped, making state updates after a change more reliable.
- Hardened device requests and fixed misleading log messages.
- Internal refactoring: consolidated duplicated protocol and accessory logic.

## 1.2.6 (2025-04-13)

- Fixed an error when fetching device data.

## 1.2.5 (2025-04-13)

- Added debug logging around error handling.

## 1.2.4 (2025-04-12)

- Added error handling to avoid a crash.

## 1.2.3 (2025-04-10)

- Added error handling around device communication.

## 1.2.1 (2025-03-02)

- Fixed a bug where the HomeKit app could reduce the maximum fan level to 5 instead of 6.
- Dependency updates.

## 1.2.0 (2025-02-20)

- Added a standalone Fan service for better HomeKit compatibility (the RotationSpeed characteristic inside the HeaterCooler service does not work properly with HomeKit).
- Added request rate limiting, since rapid fan-speed adjustments could make the Daikin adapter reject requests with HTTP 429.
- Moved noisy info-level messages to debug level.
- Fixed the return value type of `getFanStatus()` and minor code cleanups.

## 1.1.1 (2024-09-04)

- Updated for Homebridge v2 compatibility.

## 1.1.0 (2024-02-13)

- Removed the unused `cheerio` dependency and updated the remaining dependencies.

## 1.0.10 (2024-01-23)

- Fixed the fan speed mapping so that level 0 selects automatic fan speed and all device fan levels are reachable ([#2](https://github.com/tasict/homebridge-daikin-local-platform/issues/2)).
- Improved error logging.
- Dependency updates.

## 1.0.9 (2024-01-07)

- Maintenance release, no functional changes.

## 1.0.8 (2024-01-06)

- Fixed a build error (duplicate identifier) introduced by a bad merge.

## 1.0.7 (2024-01-06)

- Improved compatibility with units that report humidifier mode.
- Dependency upgrades.

## 1.0.6 (2023-12-29)

- Handle the humidify operation mode in the HeaterCooler state mapping, so units in that mode no longer confuse HomeKit.

## 1.0.5 (2023-12-11)

- Fixed a crash issue.
- Code cleanup.

## 1.0.4 (2023-12-10)

- Maintenance release, no functional changes.

## 1.0.3 (2023-12-10)

- Removed the motion detection button.

## 1.0.2 (2023-12-09)

- The current heating/cooling state shown in HomeKit now follows the active operation mode (auto/heat/cool/dry/fan) instead of only comparing temperatures.
- Named the motion sensor service.

## 1.0.1 (2023-12-09)

- Initial release: Homebridge platform plugin exposing Daikin air conditioners to HomeKit over the local network, with power, mode, target temperature, fan speed and swing control.
