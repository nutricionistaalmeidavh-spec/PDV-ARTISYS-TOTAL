'use strict';

function createUpdaterService({ app, autoUpdater, platform = process.platform, updateUrl = '', enabled = true, onState = null, logger = console }) {
  if (!app) throw new Error('app is required');
  if (!autoUpdater) throw new Error('autoUpdater is required');

  let stateValue = {
    status: 'idle',
    currentVersion: app.getVersion(),
    availableVersion: null,
    progress: null,
    error: null,
    supported: Boolean(enabled && app.isPackaged && platform === 'win32')
  };

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  if (String(updateUrl || '').trim() && typeof autoUpdater.setFeedURL === 'function') {
    autoUpdater.setFeedURL({ provider: 'generic', url: String(updateUrl).replace(/\/+$/, '') });
  }

  const snapshot = () => ({ ...stateValue });
  const patch = (next) => {
    stateValue = { ...stateValue, ...next };
    if (typeof onState === 'function') onState(snapshot());
    return snapshot();
  };

  autoUpdater.on('checking-for-update', () => patch({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => patch({ status: 'available', availableVersion: info?.version || null, progress: null, error: null }));
  autoUpdater.on('update-not-available', () => patch({ status: 'current', availableVersion: null, progress: null, error: null }));
  autoUpdater.on('download-progress', (progress) => patch({ status: 'downloading', progress: Math.max(0, Math.min(100, Math.round(progress?.percent || 0))), error: null }));
  autoUpdater.on('update-downloaded', (info) => patch({ status: 'downloaded', availableVersion: info?.version || stateValue.availableVersion, progress: 100, error: null }));
  autoUpdater.on('error', (error) => {
    logger.error?.('Desktop updater error', error);
    patch({ status: 'error', error: error?.message || 'Não foi possível verificar a atualização.' });
  });

  return {
    state: snapshot,
    async check() {
      if (!stateValue.supported) return patch({ status: 'unsupported', error: null });
      await autoUpdater.checkForUpdates();
      return snapshot();
    },
    async download() {
      if (!stateValue.supported) return patch({ status: 'unsupported', error: null });
      if (!['available', 'downloading'].includes(stateValue.status)) throw new Error('Nenhuma atualização disponível para download.');
      patch({ status: 'downloading', progress: stateValue.progress || 0, error: null });
      await autoUpdater.downloadUpdate();
      return snapshot();
    },
    install() {
      if (stateValue.status !== 'downloaded') throw new Error('A atualização ainda não terminou de baixar.');
      autoUpdater.quitAndInstall(false, true);
      return true;
    },
    start(delayMs = 8000) {
      if (!stateValue.supported) return patch({ status: 'unsupported' });
      const timer = setTimeout(() => {
        void this.check().catch((error) => logger.error?.('Automatic update check failed', error));
      }, delayMs);
      if (typeof timer.unref === 'function') timer.unref();
      return snapshot();
    }
  };
}

module.exports = { createUpdaterService };
