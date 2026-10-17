'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function dataServerTestInput(input = {}) {
  const enriched={...input};
  try {
    const form=document?.getElementById?.('data-server-form');
    if(form){
      enriched.mode=form.elements?.mode?.value||enriched.mode;
      enriched.serverUrl=form.elements?.serverUrl?.value||enriched.serverUrl;
      enriched.terminalId=form.elements?.terminalId?.value||enriched.terminalId;
    }
  } catch { /* renderer DOM is optional for non-UI callers */ }
  return enriched;
}

contextBridge.exposeInMainWorld('artisysDesktop', {
  getConfig: () => ipcRenderer.invoke('artisys:config'),
  apiRequest: (request) => ipcRenderer.invoke('artisys:api', request),
  dataServer: {
    state: () => ipcRenderer.invoke('artisys:data-server:state'),
    discover: () => ipcRenderer.invoke('artisys:data-server:discover'),
    beginNewInstallation: () => ipcRenderer.invoke('artisys:data-server:new-installation'),
    pair: (input) => ipcRenderer.invoke('artisys:data-server:pair', input),
    save: (input, sessionToken = '') => ipcRenderer.invoke('artisys:data-server:save', { input, sessionToken }),
    test: (input) => ipcRenderer.invoke('artisys:data-server:test', dataServerTestInput(input)),
    restart: () => ipcRenderer.invoke('artisys:data-server:restart')
  },
  installation: {
    acknowledge: () => ipcRenderer.invoke('artisys:installation:acknowledge'),
    newStore: (confirmation,sessionToken='') => ipcRenderer.invoke('artisys:installation:new-store',{confirmation,sessionToken})
  },
  publicNetwork: {
    state: () => ipcRenderer.invoke('artisys:public-network:state'),
    test: (input) => ipcRenderer.invoke('artisys:public-network:test',input),
    challenge: (input) => ipcRenderer.invoke('artisys:public-network:challenge',input),
    challengeStatus: (token) => ipcRenderer.invoke('artisys:public-network:challenge-status',token),
    firewallSettings: () => ipcRenderer.invoke('artisys:public-network:firewall-settings')
  },
  imports: {
    pickFile: () => ipcRenderer.invoke('artisys:imports:pick')
  },
  photos: {
    sync: (input) => ipcRenderer.invoke('artisys:photos:sync', input),
    status: () => ipcRenderer.invoke('artisys:photos:status'),
    dataUrl: (input) => ipcRenderer.invoke('artisys:photos:data-url', input),
    pickAndUpload: (input) => ipcRenderer.invoke('artisys:photos:pick-upload', input),
    remove: (input) => ipcRenderer.invoke('artisys:photos:remove')
  },
  hardware: {
    status: () => ipcRenderer.invoke('artisys:hardware:status'),
    listSerialPorts: () => ipcRenderer.invoke('artisys:hardware:ports'),
    listPrinters: () => ipcRenderer.invoke('artisys:hardware:printers'),
    diagnostics: () => ipcRenderer.invoke('artisys:hardware:diagnostics'),
    configureDrawer: (input) => ipcRenderer.invoke('artisys:hardware:drawer-configure', input),
    configureScale: (input) => ipcRenderer.invoke('artisys:hardware:scale-configure', input),
    readWeight: () => ipcRenderer.invoke('artisys:hardware:scale-read'),
    tare: () => ipcRenderer.invoke('artisys:hardware:scale-tare'),
    openDrawer: () => ipcRenderer.invoke('artisys:hardware:drawer-open'),
    print: (job) => ipcRenderer.invoke('artisys:hardware:print', job),
    testPrinter: (text) => ipcRenderer.invoke('artisys:hardware:test-printer', { text }),
    testDrawer: () => ipcRenderer.invoke('artisys:hardware:test-drawer'),
    testScale: () => ipcRenderer.invoke('artisys:hardware:test-scale')
  },
  receipts: {
    printSale: (input) => ipcRenderer.invoke('artisys:receipts:print-sale', input),
    saveSalePdf: (input) => ipcRenderer.invoke('artisys:receipts:save-pdf', input)
  },
  external: {
    openWhatsapp: (input) => ipcRenderer.invoke('artisys:external:whatsapp', input)
  },
  updater: {
    state: () => ipcRenderer.invoke('updater:state'),
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    telemetryConsentState: () => ipcRenderer.invoke('updater:telemetry-consent-state'),
    saveTelemetryConsent: (accepted) => ipcRenderer.invoke('updater:telemetry-consent-save', { accepted: Boolean(accepted) }),
    acceptTelemetryAndInstall: () => ipcRenderer.invoke('updater:telemetry-consent-install', { accepted: true }),
    declineTelemetryAndInstall: () => ipcRenderer.invoke('updater:telemetry-consent-install', { accepted: false }),
    onState: (handler) => {
      const listener = (_event, state) => handler(state);
      ipcRenderer.on('updater:state', listener);
      return () => ipcRenderer.removeListener('updater:state', listener);
    }
  },
  window: {
    minimize: () => ipcRenderer.send('artisys:window:minimize'),
    maximize: () => ipcRenderer.send('artisys:window:maximize'),
    close: () => ipcRenderer.send('artisys:window:close')
  }
});
