'use strict';

const { app, ipcMain, BrowserWindow } = require('electron');
const { autoUpdater } = require('electron-updater');
const { createUpdaterService } = require('./updater-service.cjs');
const { createTelemetryConsentController } = require('./telemetry-consent-controller.cjs');
const { onRuntimeTelemetryAttached } = require('../js/core/telemetry/telemetry-runtime');
require('./main.cjs');
require('./telemetry-bootstrap.cjs');

const electronMajor = Number(String(process.versions.electron || '').split('.')[0] || 0);
const legacyRuntime = electronMajor > 0 && electronMajor <= 22;

const service = createUpdaterService({
  app,
  autoUpdater,
  updateUrl: process.env.ARTISYS_UPDATE_URL || '',
  enabled: !legacyRuntime,
  onState: (state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('updater:state', state);
    }
  }
});

let telemetryConsentController = null;
onRuntimeTelemetryAttached((telemetry, runtime) => {
  if (!runtime?.settings || telemetryConsentController) return;
  telemetryConsentController = createTelemetryConsentController({
    settings: {
      get: (key, options) => runtime.settings.get(key, options),
      set: (key, value) => runtime.settings.set(key, value, {
        scope: 'global',
        actor: { kind:'system', id:'system' }
      })
    },
    updater: service,
    onDecline: () => telemetry?.queue?.clear?.()
  });
});

ipcMain.handle('updater:state', async () => service.state());
ipcMain.handle('updater:check', async () => service.check());
ipcMain.handle('updater:download', async () => service.download());
ipcMain.handle('updater:install', async () => service.install());
ipcMain.handle('updater:telemetry-consent-state', async () => telemetryConsentController?.state() || { version:0, requiredVersion:1, needsPrompt:false, available:false });
ipcMain.handle('updater:telemetry-consent-save', async (_event, input = {}) => {
  if (!telemetryConsentController) throw new Error('Consentimento de telemetria indisponivel nesta instalacao.');
  return input.accepted ? telemetryConsentController.accept() : telemetryConsentController.decline();
});
ipcMain.handle('updater:telemetry-consent-install', async (_event, input = {}) => {
  if (!telemetryConsentController) throw new Error('Consentimento de telemetria indisponivel nesta instalacao.');
  return input.accepted ? telemetryConsentController.acceptAndInstall() : telemetryConsentController.declineAndInstall();
});

void app.whenReady().then(() => service.start());
