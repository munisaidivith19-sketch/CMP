'use strict';
// J.N.N Gate Scanner — Electron main process.
// Owns the window, all network access (apiClient.cjs), the encrypted saved
// session (credentialStore.cjs), settings and diagnostics. The page talks to
// it only through the fixed operations in preload.cjs.
const path = require('node:path');
const os = require('node:os');
const dns = require('node:dns').promises;
const { app, BrowserWindow, ipcMain, Menu, safeStorage, session, shell } = require('electron');
const { createSettingsStore, deviceName, resolveApiBaseUrl, safeLabel } = require('./config.cjs');
const { createCredentialStore } = require('./credentialStore.cjs');
const { createApiClient } = require('./apiClient.cjs');
const { createDiagnosticsLog } = require('./diagnosticsLog.cjs');
const { historyQuery } = require('./queries.cjs');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const VERSION = app.getVersion();
let win = null;
let api = null;
let settings = null;
let diag = null;
let api_base = null;
let credentials = null;
let pendingSerialChoice = null;

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

function identityHeaders() {
  const s = settings.get();
  return {
    'user-agent': `JNNGateScanner/${VERSION} (Windows NT ${os.release()})`,
    'x-app-version': VERSION,
    'x-device-name': deviceName(),
    ...(s.gateName ? { 'x-gate-name': safeLabel(s.gateName) } : {}),
  };
}

function createWindow() {
  const s = settings.get();
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: 'J.N.N Gate Scanner',
    backgroundColor: '#eef0fb',
    alwaysOnTop: s.alwaysOnTop,
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // The window shows the bundled page only: no navigation, no new windows.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('focus', () => send('window:focus', true));
  win.on('blur', () => send('window:focus', false));
}

function configureSession() {
  const ses = session.defaultSession;
  const isOurPage = (origin) => typeof origin === 'string' && origin.startsWith('file://');
  // Only Web Serial is ever allowed (USB virtual-COM scanners); everything else is refused.
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler((wc, permission, origin) => permission === 'serial' && wc === win?.webContents && isOurPage(origin));
  ses.setDevicePermissionHandler((details) => details.deviceType === 'serial' && isOurPage(details.origin));
  // A serial port request from the page: let the guard pick from the real port list.
  ses.on('select-serial-port', (event, portList, _wc, callback) => {
    event.preventDefault();
    if (pendingSerialChoice) pendingSerialChoice('');
    pendingSerialChoice = callback;
    send('serial:choose', portList.map((p) => ({ portId: p.portId, portName: p.portName, displayName: p.displayName || p.portName, vendorId: p.vendorId, productId: p.productId })));
  });
  ses.on('serial-port-added', () => send('serial:changed', 'added'));
  ses.on('serial-port-removed', () => send('serial:changed', 'removed'));
}

// ── IPC: the only operations the page can ask for ───────────────────
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

function registerIpc() {
  const handle = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
    if (event.senderFrame?.url && !event.senderFrame.url.startsWith('file://')) throw new Error('Refused');
    return fn(...args);
  });

  handle('app:info', () => ({
    version: VERSION,
    apiBaseUrl: api_base.url,
    apiSource: api_base.source,
    deviceName: deviceName(),
    packaged: app.isPackaged,
    secureStorage: credentials.available(),
    platform: `${os.type()} ${os.release()}`,
    logFile: diag.file,
  }));

  handle('auth:restore', async () => {
    const r = await api.restore();
    diag.record({ event: 'session_restore', status: r.status, kind: r.kind });
    return r;
  });
  handle('auth:login', async (email, password) => {
    const r = await api.login(str(email, 120).trim().toLowerCase(), str(password, 200));
    diag.record({ event: 'login', ok: r.ok, kind: r.kind, status: r.status, code: r.code });
    return r;
  });
  handle('auth:logout', (reason) => api.logout(['manual', 'switch_guard'].includes(reason) ? reason : 'manual'));
  handle('auth:guard', () => api.guard);

  handle('api:session', () => api.request('GET', '/gate-scanner/session'));
  handle('api:dashboard', () => api.request('GET', '/gate-scanner/dashboard'));
  handle('api:history', (params) => api.request('GET', `/gate-scanner/history?${historyQuery(params)}`));
  handle('api:attempts', (params) => api.request('GET', `/gate-scanner/attempts?${historyQuery(params, { outcome: true })}`));
  handle('api:scan', ({ scanId, payload, source, kind } = {}) => {
    if (!/^[A-Za-z0-9-]{8,64}$/.test(str(scanId, 64))) return { ok: false, kind: 'validation', message: 'Invalid scan id' };
    const body = { scanId, payload: str(payload, 200), source: ['hid', 'serial', 'manual'].includes(source) ? source : 'hid' };
    if (kind === 'in' || kind === 'out') body.kind = kind;
    // Safe to retry: the server answers a repeated scanId with the original result.
    return api.request('POST', '/gate-scanner/scans', { body, retries: 2, timeout: 12000 });
  });
  handle('api:scanStatus', (scanId) => (/^[A-Za-z0-9-]{8,64}$/.test(str(scanId, 64)) ? api.request('GET', `/gate-scanner/scans/${scanId}`, { retries: 1 }) : { ok: false, kind: 'validation' }));
  handle('api:legalStatus', () => api.request('GET', '/legal/status'));
  handle('api:terms', () => api.publicGet('/legal/policies/terms'));
  handle('api:acceptTerms', (version) => api.request('POST', '/legal/accept', { body: { policyId: 'terms', version: Number(version), agreed: true } }));

  handle('diag:health', () => api.health());
  handle('diag:dns', async () => {
    const host = new URL(api_base.url).hostname;
    const lookup = (h) => dns.lookup(h).then(() => true, () => false);
    const [server, internet] = await Promise.all([lookup(host), lookup('dns.google')]);
    return { server, internet };
  });
  handle('diag:log', () => diag.recent(150));
  handle('diag:record', (entry) => diag.record({ ...(entry && typeof entry === 'object' ? entry : {}), from: 'ui' }));
  handle('diag:openLogFolder', () => shell.showItemInFolder(diag.file));

  handle('settings:get', () => settings.get());
  handle('settings:set', (patch) => {
    const next = settings.set(patch && typeof patch === 'object' ? patch : {});
    if (win) win.setAlwaysOnTop(next.alwaysOnTop);
    diag.record({ event: 'settings_changed', scannerMode: next.scannerMode, terminator: next.terminator });
    return next;
  });

  handle('serial:choose', (portId) => {
    const cb = pendingSerialChoice;
    pendingSerialChoice = null;
    if (cb) cb(str(portId, 200));
    return true;
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const dir = app.getPath('userData');
  settings = createSettingsStore(dir);
  diag = createDiagnosticsLog(dir);
  credentials = createCredentialStore(dir, safeStorage);
  try {
    api_base = resolveApiBaseUrl({ packaged: app.isPackaged });
  } catch (err) {
    diag.record({ event: 'config_error', message: err.message });
    api_base = { url: 'https://invalid.invalid', source: 'invalid' };
  }
  api = createApiClient({
    baseUrl: api_base.url,
    store: credentials,
    identityHeaders,
    onSignedOut: (e) => send('auth:signedOut', e),
    log: (e) => diag.record(e),
  });
  diag.record({ event: 'app_start', version: VERSION, apiSource: api_base.source, secureStorage: credentials.available() });
  configureSession();
  registerIpc();
  createWindow();
});

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});
app.on('window-all-closed', () => app.quit());
