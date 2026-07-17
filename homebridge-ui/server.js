// Backend for the custom settings UI (run on the Homebridge host by
// Config UI X). Exposes the LAN device finder to the browser-side UI.
const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');
const { discover } = require('./discover');

class DaikinPluginUiServer extends HomebridgePluginUiServer {

  constructor() {
    super();

    this.onRequest('/discover', async () => {
      return { devices: await discover() };
    });

    this.ready();
  }
}

(() => new DaikinPluginUiServer())();
