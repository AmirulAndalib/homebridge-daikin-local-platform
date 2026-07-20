<p align="center">
  <img src="https://raw.githubusercontent.com/tasict/homebridge-daikin-local-platform/master/branding/icon-128.png" width="96" height="96" alt="">
</p>

# Homebridge Daikin Local Platform

[![GitHub version](https://img.shields.io/github/package-json/v/tasict/homebridge-daikin-local-platform?label=GitHub)](https://github.com/tasict/homebridge-daikin-local-platform)
[![npm version](https://img.shields.io/npm/v/homebridge-daikin-local-platform?color=%23cb3837&label=npm)](https://www.npmjs.com/package/homebridge-daikin-local-platform)

`homebridge-daikin-local-platform` is a dynamic platform plugin for [Homebridge](https://homebridge.io) that provides HomeKit support for Daikin climate devices to be controlled.

## How it works
The plugin communicates with your AC units through the local api from devices. This means your units must be set up there and connect to lan before you can use this plugin.

## Supported devices
The plugin auto-detects, per IP address, which of the two local protocols the unit speaks — no configuration needed:

* **Newer adapters (firmware 2.8.0+)** using the JSON `/dsiot/multireq` API (e.g. BRP069C4x and recent built-in WiFi modules).
* **Legacy adapters** using the query-string API (`/common/basic_info`, `/aircon/get_control_info`, ...) — the same devices supported by the [Home Assistant Daikin integration](https://www.home-assistant.io/integrations/daikin/) via BRP069-style adapters (BRP069A/Bxx and older built-in WiFi units, e.g. US FTXM-W "ATMOSPHERA" series). Set semantics follow [pydaikin](https://github.com/fredrike/pydaikin).
* **AirBase (BRP15B61) adapters**, common on Australian ducted systems — same query-string API under a `skyfi/` path prefix, with the AirBase mode and 3-speed fan numbering. Zone control is not exposed yet.
* **Secure BRP072C-style adapters** (the ones paired with the *Daikin Comfort Control* app, e.g. US FTXM-W "ATMOSPHERA" built-in WiFi) — same query-string API, but served only over HTTPS after registering the 13-digit key printed on the adapter/unit sticker. Add the key via `climateKeys` (see below); everything else is auto-detected.

You can verify which protocol your unit speaks: `http://<ip>/common/basic_info` answers `ret=OK,...` on a legacy unit, `http://<ip>/skyfi/common/basic_info` on an AirBase unit; newer units answer on `/dsiot/multireq`. A unit that answers `/common/basic_info` but returns *page not found* for `/aircon/get_control_info` is a secure BRP072C-style adapter and needs its key configured. SkyFi (password-based) adapters are not supported yet.
## Homebridge setup
Configure the plugin through the settings UI or directly in the JSON editor.

In the settings UI, the device list scans your local network automatically (UDP broadcast) and shows the Daikin units it finds — one click adds a unit, and for secure BRP072C units (marked 🔒) the edit form opens right away so you can enter the 13-digit key. Note that the scan cannot cross subnets or leave a Docker *bridge* network (use host networking, or enter the IP manually — tick *Secure adapter* in the edit form if such a unit needs a key).

```json
{
  "platforms": [
    {
        "platform": "Daikin Local Platform",
        "name": "Daikin Local Platform",
        "climateIPs": ["ipv4-here"],
        "climateKeys": [
            {"ipv4-here": "13-digit-key-here"}
        ],
        "climateCoolingOnly": ["ipv4-here"],
        "debugMode": false,
    }
  ]
}
```

Required:

* `platform` (string):
Tells Homebridge which platform this config belongs to. Leave as is.

* `name` (string):
Will be displayed in the Homebridge log.

* `climateIPs` (array):
The IP addresses of the Daikin climate devices to be controlled.

Optional:

* `climateKeys` (array):
Only needed for secure BRP072C-style adapters (see *Supported devices*). One object per unit mapping its IP address (exactly as written in `climateIPs`) to the 13-digit key printed on the adapter/unit sticker. Units without a key entry are auto-detected as before. In the Homebridge UI the key is entered by editing the device in the plugin settings; the settings UI keeps this mapping in sync with the device list automatically.

* `climateCoolingOnly` (array):
Units to expose as cooling-only in HomeKit, by IP address exactly as written in `climateIPs`. Heating and Auto are hidden in the Home app — for cool-only models (common in South-East Asia) whose WLAN firmware still reports heating, which the plugin's mode auto-detection cannot see through. In the Homebridge UI this is the *Cooling only* switch in the device's edit form. The option only hides modes, it never adds one.

* `debugMode` (boolean):
If `true`, the plugin will print debugging information to the Homebridge log.

## Troubleshooting

- If you have any issues with this plugin, enable the debug mode in the settings (and restart the plugin). This will print additional information to the log. If this doesn't help you resolve the issue, feel free to create a [GitHub issue](https://github.com/tasict/homebridge-daikin-local-platform/issues) and attach the available debugging information.

- If the plugin affects the general responsiveness and reliability of your Homebridge setup, you can run it as an isolated [child bridge](https://github.com/homebridge/homebridge/wiki/Child-Bridges).

## Contributing

You can contribute to this project in the following ways:

* Test/use the plugin and [report issues and share feedback](https://github.com/tasict/homebridge-daikin-local-platform/issues).

* Review source code changes [before](https://github.com/tasict/homebridge-daikin-local-platform/pulls) and [after](https://github.com/tasict/homebridge-daikin-local-platform/commits/master) they are published.

* Contribute with your own bug fixes, code clean-ups, or additional features (pull requests are accepted).

## Acknowledgements
* Thanks to [やまでん](https://ydn.jp/archives/12367) for protocol detail.
* Thanks to the team behind Homebridge. Your efforts do not go unnoticed.

## Disclaimer
All product and company names are trademarks™ or registered® trademarks of their respective holders. Use of them does not imply any affiliation with or endorsement by them.
