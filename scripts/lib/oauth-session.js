'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const DEFAULT_PROXY_PORT = 1455;
const AUTH_FILE = path.join(os.homedir(), '.codex', 'auth.json');
const AUTH_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

const trackedProxies = new Map();
let lastPortBusy = false;

function spawnProxyProcess(port) {
  const child = spawn(
    process.execPath,
    ['-e', `require('http').createServer().listen(${Number(port)})`],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
  return child;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => tester.close(() => resolve(true)));
    tester.listen(port, '127.0.0.1');
  });
}

function statAuthFile() {
  try {
    return fs.statSync(AUTH_FILE);
  } catch {
    return null;
  }
}

async function startProxy(port = DEFAULT_PROXY_PORT) {
  const free = await isPortFree(port);
  if (!free) {
    lastPortBusy = true;
    const err = new Error('port_busy');
    err.code = 'PORT_BUSY';
    throw err;
  }
  lastPortBusy = false;
  const child = spawnProxyProcess(port);
  const pid = child.pid;
  if (typeof pid === 'number') {
    trackedProxies.set(pid, port);
  }
  return pid;
}

function stopProxy(pid) {
  if (!trackedProxies.has(pid)) return false;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // process already gone
  }
  trackedProxies.delete(pid);
  return true;
}

function stopAll() {
  const pids = Array.from(trackedProxies.keys());
  for (const pid of pids) stopProxy(pid);
  return pids.length;
}

function getAuthStatus() {
  if (lastPortBusy && trackedProxies.size === 0) {
    return { status: 'port_busy' };
  }
  const stat = statAuthFile();
  if (!stat) return { status: 'missing_auth' };
  if (Date.now() - stat.mtimeMs > AUTH_MAX_AGE_MS) {
    return { status: 'expired_auth' };
  }
  return { status: 'ok' };
}

module.exports = {
  startProxy,
  stopProxy,
  stopAll,
  getAuthStatus,
};
