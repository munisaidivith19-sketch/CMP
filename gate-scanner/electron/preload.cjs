'use strict';
// The page's only door to the main process: a fixed list of operations.
// No tokens, file system or Node APIs are exposed.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel) => (callback) => {
  const listener = (_e, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('gate', {
  app: { info: invoke('app:info') },
  auth: {
    restore: invoke('auth:restore'),
    login: invoke('auth:login'),
    logout: invoke('auth:logout'),
    guard: invoke('auth:guard'),
    onSignedOut: on('auth:signedOut'),
  },
  api: {
    session: invoke('api:session'),
    dashboard: invoke('api:dashboard'),
    history: invoke('api:history'),
    attempts: invoke('api:attempts'),
    scan: invoke('api:scan'),
    scanStatus: invoke('api:scanStatus'),
    legalStatus: invoke('api:legalStatus'),
    terms: invoke('api:terms'),
    acceptTerms: invoke('api:acceptTerms'),
  },
  diag: {
    health: invoke('diag:health'),
    dns: invoke('diag:dns'),
    log: invoke('diag:log'),
    record: invoke('diag:record'),
    openLogFolder: invoke('diag:openLogFolder'),
  },
  settings: { get: invoke('settings:get'), set: invoke('settings:set') },
  serial: { choose: invoke('serial:choose'), onChoose: on('serial:choose'), onChanged: on('serial:changed') },
  window: { onFocus: on('window:focus') },
});
