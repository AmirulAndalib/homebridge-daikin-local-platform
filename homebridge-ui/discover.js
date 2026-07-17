// Daikin UDP discovery: broadcast "DAIKIN_UDP/common/basic_info" to port
// 30050 and collect the basic_info-style replies. This is the same mechanism
// pydaikin's discovery.py and the official Daikin apps use; dsiot, BRP069 and
// AirBase adapters all answer it. Runs on the Homebridge host via the custom
// UI server (homebridge-ui/server.js), never in the plugin runtime.
const dgram = require('dgram');
const os = require('os');

const DISCOVERY_MESSAGE = Buffer.from('DAIKIN_UDP/common/basic_info');
const DISCOVERY_PORT = 30050;
// Some firmwares only answer probes sent from this source port (pydaikin
// binds it too); fall back to an ephemeral port when it is taken.
const SOURCE_PORT = 30000;
const REPLY_WAIT_MS = 4000;
// UDP broadcast is lossy; repeat the probe a few times inside the wait
// window (replies are deduplicated by sender IP).
const PROBE_SENDS = 3;
const PROBE_INTERVAL_MS = 1200;

// Same tolerant parser as the plugin's parseResponse.
function parseBasicInfo(body) {
  const values = {};
  for (const match of body.matchAll(/(\w+)=([^=]*)(?:,|$)/g)) {
    values[match[1]] = match[2];
  }
  return values;
}

function decodeName(raw) {
  try {
    return decodeURIComponent(raw);
  } catch (e) {
    return raw;
  }
}

// The limited broadcast plus every interface's directed subnet broadcast, so
// discovery also works when 255.255.255.255 is filtered.
function broadcastTargets() {
  const targets = new Set(['255.255.255.255']);
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal && address.netmask) {
        const ip = address.address.split('.').map(Number);
        const mask = address.netmask.split('.').map(Number);
        targets.add(ip.map((octet, i) => octet | (~mask[i] & 255)).join('.'));
      }
    }
  }
  return [...targets];
}

function bindSocket(port) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const onError = (error) => {
      socket.removeListener('listening', onListening);
      try {
        socket.close();
      } catch (e) { /* already closed */ }
      reject(error);
    };
    const onListening = () => {
      socket.removeListener('error', onError);
      resolve(socket);
    };
    socket.once('error', onError);
    socket.once('listening', onListening);
    socket.bind(port);
  });
}

async function discover(targets = broadcastTargets(), waitMs = REPLY_WAIT_MS) {

  let socket;
  try {
    socket = await bindSocket(SOURCE_PORT);
  } catch (e) {
    socket = await bindSocket(0);
  }

  return new Promise((resolve, reject) => {

    const found = new Map();
    let finished = false;

    const timers = [];

    const finish = (error) => {
      if (finished) {
        return;
      }
      finished = true;
      for (const timer of timers) {
        clearTimeout(timer);
      }
      try {
        socket.close();
      } catch (e) { /* already closed */ }
      if (error) {
        reject(error);
      } else {
        // Stable ordering for the UI.
        resolve([...found.values()].sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true })));
      }
    };

    timers.push(setTimeout(() => finish(), waitMs));

    socket.on('message', (message, rinfo) => {

      if (found.has(rinfo.address)) {
        return;
      }

      const values = parseBasicInfo(message.toString());

      if (values['ret'] !== 'OK') {
        return;
      }

      found.set(rinfo.address, {
        ip: rinfo.address,
        name: decodeName(values['name'] || ''),
        mac: values['mac'] || '',
        type: values['type'] || '',
        firmware: (values['ver'] || '').replace(/_/g, '.'),
        // en_secure=1 marks a secure BRP072C-style adapter that will need
        // its 13-digit key configured.
        secure: values['en_secure'] === '1',
      });
    });

    socket.on('error', (error) => finish(error));

    socket.setBroadcast(true);

    const sendProbes = () => {
      for (const target of targets) {
        socket.send(DISCOVERY_MESSAGE, DISCOVERY_PORT, target, () => { /* per-target send errors are non-fatal */ });
      }
    };

    sendProbes();
    for (let i = 1; i < PROBE_SENDS; i++) {
      timers.push(setTimeout(sendProbes, i * PROBE_INTERVAL_MS));
    }
  });
}

module.exports = { discover, broadcastTargets };
