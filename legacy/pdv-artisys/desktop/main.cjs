'use strict';

const { app, BrowserWindow, ipcMain, safeStorage, dialog, nativeImage, shell } = require('electron');
const path = require('node:path');
const { networkInterfaces } = require('node:os');
const { publicNetworkState, testPublicNetwork } = require('./public-network.cjs');
const { createLanDiscovery, discoverLanServers } = require('./lan-discovery.cjs');
const { installationState, acknowledgeInstallation, archiveInstallation } = require('./installation-lifecycle.cjs');
const { version: productVersion } = require('../package.json');
const { existsSync } = require('node:fs');
const { mkdir, writeFile } = require('node:fs/promises');
const { randomBytes, createHash } = require('node:crypto');
const { createPdvRuntime } = require('../js/core/pdv-runtime');
const { DEFAULT_PROFILE_IDS } = require('../js/core/auth/default-profiles');
const { applyPendingRestore } = require('../js/core/backup/pending-restore');
const { resolvePrintingPreferences } = require('../js/domains/printing/printing-preferences');
const { createLocalServer } = require('../server/local-server');
const { createLanReachability } = require('../server/lan-reachability.cjs');
const { resolveBootstrapConfig, validateBootstrapConfig, shouldStartEmbeddedServer } = require('./bootstrap-config.cjs');
const { createTerminalCredentialStore } = require('./terminal-credentials.cjs');
const { createTerminalIdentityStore } = require('./terminal-identity.cjs');
const { registerImportIpc } = require('./import-bridge.cjs');
const { createProductPhotoClient, registerProductPhotoIpc } = require('./product-photo-bridge.cjs');
const { createHardwareController, registerHardwareIpc } = require('./hardware-bridge.cjs');
const { createPdvHardwareRuntime } = require('./hardware-runtime.cjs');
const { createHardwareConfigStore } = require('./hardware-config-store.cjs');
const { createReceiptActions, registerReceiptIpc } = require('./receipt-actions.cjs');
const { loadDataServerConfig, saveDataServerConfig, saveDataServerIntent, isHostMode, isExternalMode, publicDataServerConfig } = require('./data-server-config.cjs');
const { migrateLegacyDataServerCredential, saveDataServerSelection, testDataServerTarget, pairDataServerTerminal } = require('./data-server-runtime.cjs');

let mainWindow = null;
let runtime = null;
let localServer = null;
let lanServer = null;
let lanDiscovery = null;
let apiBase = '';
let bootstrapConfig = null;
let terminalCredentialStore = null;
let terminalIdentityStore = null;
let hardwareController = null;
let hardwareConfigStore = null;
let printWorker = null;
let printWorkerBusy = false;
let installationWasExisting = true;
let dataServerConfig = null;
let dataServerConfigPath = '';
let installationTransition = false;
const installToken = randomBytes(32).toString('hex');
const API_TIMEOUT_MS = 12000;

async function fetchWithTimeout(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal:controller.signal }); }
  catch (error) {
    if (error?.name === 'AbortError') throw new Error('O servidor não respondeu dentro do tempo esperado.');
    throw new Error(`Não foi possível acessar o servidor: ${error?.message || error}`);
  } finally { clearTimeout(timer); }
}

function rendererPath(...parts) {
  return path.join(__dirname, 'renderer', ...parts);
}

function currentPrintingPreferences() {
  return resolvePrintingPreferences({ settings:runtime?.settings || null, env:process.env, isExistingInstall:installationWasExisting });
}

function terminalCredentialConfigured() {
  try { return Boolean(terminalCredentialStore?.status?.().configured); }
  catch { return false; }
}

function lanAddresses() {
  const values=[];
  for(const entries of Object.values(networkInterfaces()||{})){
    for(const entry of entries||[]){
      if(entry?.family==='IPv4'&&!entry.internal)values.push(String(entry.address));
    }
  }
  return [...new Set(values)];
}

function publicDataServerState() {
  return {
    ...publicDataServerConfig(dataServerConfig,terminalCredentialConfigured()),
    lanAddresses:lanAddresses(),
    lanPort:Number(dataServerConfig?.port||4174)
  };
}

async function authorizeDeploymentChange(sessionToken) {
  const token=String(sessionToken||'').trim();
  if(!token)throw new Error('Faça login com um administrador autorizado para alterar a implantação.');
  const response=await fetchWithTimeout(`${apiBase}/api/v1/system/deployment/authorization`,{
    headers:{accept:'application/json',authorization:`Bearer ${token}`,...terminalApiHeaders()}
  },5000);
  const text=await response.text();
  let payload={};
  if(text){try{payload=JSON.parse(text);}catch{payload={error:text};}}
  if(!response.ok)throw new Error(payload?.error||'Somente administradores autorizados podem alterar a implantação.');
  return true;
}

async function startEmbeddedServer() {
  const dbPath = path.join(app.getPath('userData'), 'pdv-artisys.sqlite');
  const backupDir = path.join(app.getPath('userData'), 'backups');
  applyPendingRestore({ dbPath, backupDir });
  installationWasExisting = existsSync(dbPath);
  const installationId=createHash('sha256').update(path.resolve(dbPath)).digest('hex').slice(0,32);
  runtime = createPdvRuntime({
    dbPath,
    backupDir,
    diagnosticsDir:path.join(app.getPath('userData'),'diagnostics'),
    productPhotoDir:path.join(app.getPath('userData'),'product-photos'),
    appVersion:productVersion,
    serverVersion:productVersion,
    installationId,
    accountEndpoint:bootstrapConfig?.accountEndpoint || '',
    requireCommercialActivation:bootstrapConfig?.requireCommercialActivation === true,
    receiptOptions: {
      storeName: bootstrapConfig?.storeName || process.env.PDV_STORE_NAME || 'Loja Matriz',
      width: Number(process.env.PDV_RECEIPT_WIDTH || 42)
    }
  });

  runtime.lanReachability=createLanReachability();
  runtime.pilot.setDeploymentContext({mode:dataServerConfig.mode,selected:dataServerConfig.selected});

  if (!app.isPackaged && process.env.ARTISYS_QA === '1' && process.env.ARTISYS_QA_AUTO_ADMIN === '1' && runtime.catalog.countUsers() === 0) {
    runtime.catalog.createUser({
      id:'qa-admin',
      username:'qaadmin',
      name:'QA Administrador',
      profileId:DEFAULT_PROFILE_IDS.ADMINISTRATOR,
      password:'QaLocalOnly-12345!',
      active:true
    },{kind:'system',id:'system'});
  }

  localServer = createLocalServer({ runtime, host: '127.0.0.1', port: 0, token: installToken, requireTerminalAuth:false, isExistingInstall:installationWasExisting });
  const localAddress = await localServer.start();
  apiBase = `http://127.0.0.1:${localAddress.port}`;

  if (isHostMode(dataServerConfig)) {
    const lanHost = dataServerConfig.host;
    const lanPort = dataServerConfig.port;
    if (!Number.isInteger(lanPort) || lanPort < 1 || lanPort > 65535) throw new Error('PDV_LAN_PORT invalida.');
    lanServer = createLocalServer({ runtime, host:lanHost, port:lanPort, token:installToken, requireTerminalAuth:true, isExistingInstall:installationWasExisting });
    try {
      await lanServer.start();
      lanDiscovery?.stop();
      lanDiscovery=createLanDiscovery({identity:terminalIdentityStore.getOrCreate().fingerprint,port:lanPort,displayName:bootstrapConfig?.storeName||'PC principal ArtiSys'});
    } catch (error) {
      console.error('Servidor LAN configurado, mas indisponível.', error);
      try { await lanServer.stop(); } catch {}
      lanServer = null;
      throw new Error(`Não foi possível iniciar o PC principal na porta ${lanPort}. Nenhum fallback foi aplicado.`);
    }
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1536,
    height: 1024,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    frame: false,
    backgroundColor: '#f5f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(rendererPath('index.html'));
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

function buildHardwareController() {
  const storedHardware = hardwareConfigStore?.load() || {};
  const storedScale = storedHardware.scale || null;
  const hardwareEnv = { ...process.env };
  if (storedScale) {
    hardwareEnv.PDV_SCALE_PROFILE = storedScale.profile;
    hardwareEnv.PDV_SCALE_PORT = storedScale.port;
    if (storedScale.requestCommand) hardwareEnv.PDV_SCALE_URANO_REQUEST = storedScale.requestCommand;
  }
  if (storedHardware.drawer) {
    hardwareEnv.PDV_DRAWER_PORT = storedHardware.drawer.port;
    hardwareEnv.PDV_DRAWER_BAUD = storedHardware.drawer.baud;
  }
  const hardwareRuntime = createPdvHardwareRuntime({
    BrowserWindow,
    env:hardwareEnv,
    resolvePrinterPreferences:() => currentPrintingPreferences()
  });
  return createHardwareController(hardwareRuntime, {
    onDrawerConfigured: configuration => hardwareConfigStore?.saveDrawer(configuration),
    onScaleConfigured: configuration => hardwareConfigStore?.saveScale({
      profile:configuration.profile,
      port:configuration.port || '',
      requestCommand:configuration.requestCommand || undefined
    })
  });
}

function terminalApiHeaders() {
  if (bootstrapConfig?.profile !== 'terminal') return {};
  return {
    'x-terminal-id':bootstrapConfig.terminalId,
    'x-terminal-key':bootstrapConfig.terminalKey
  };
}

async function receiptApiRequest(rawPath,{method='GET',sessionToken='',body=undefined}={}) {
  const headers={
    accept:'application/json',
    authorization:`Bearer ${String(sessionToken||'')}`,
    ...terminalApiHeaders()
  };
  let requestBody;
  if(body!==undefined){headers['content-type']='application/json';requestBody=JSON.stringify(body);}
  const response=await fetchWithTimeout(`${apiBase}${rawPath}`,{method,headers,body:requestBody});
  const text=await response.text();
  let payload=null;
  if(text){try{payload=JSON.parse(text);}catch{payload={error:text};}}
  if(!response.ok)throw new Error(payload?.error||`Erro HTTP ${response.status}`);
  return payload;
}

async function fetchSaleReceipt(saleId, sessionToken) {
  return receiptApiRequest(`/api/v1/sales/${encodeURIComponent(saleId)}/receipt`,{sessionToken});
}

async function createSalePrintAttempt(saleId,sessionToken) {
  return receiptApiRequest(`/api/v1/sales/${encodeURIComponent(saleId)}/print-attempts`,{method:'POST',sessionToken});
}

async function finishSalePrintAttempt(saleId,jobId,outcome,sessionToken) {
  return receiptApiRequest(`/api/v1/sales/${encodeURIComponent(saleId)}/print-attempts/${encodeURIComponent(jobId)}/result`,{method:'POST',sessionToken,body:outcome});
}

async function writeReceiptFile(filePath, bytes) {
  const target=path.resolve(String(filePath||''));
  await mkdir(path.dirname(target),{recursive:true});
  await writeFile(target,bytes);
}

function startPrintWorker() {
  if (printWorker || !runtime) return;
  const tick = async () => {
    if (printWorkerBusy || !runtime || !hardwareController) return;
    let preferences;
    try { preferences = currentPrintingPreferences(); }
    catch (error) {
      runtime.logger?.log({ level:'error', subsystem:'printing', message:error?.message || 'Falha ao resolver configuracao de impressao.' });
      return;
    }
    if (!preferences.autoPrint) return;
    const job = runtime.printing.listJobs({ status:'PENDING', type:'SALE_RECEIPT' })[0];
    if (!job) return;
    printWorkerBusy = true;
    try {
      await runtime.printing.processJob(job.id, { print: input => hardwareController.print(input) });
    } catch (error) {
      runtime.logger?.log({ level:'error', subsystem:'printing', message:error?.message || 'Falha ao processar impressao.' });
    } finally {
      printWorkerBusy = false;
    }
  };
  printWorker = setInterval(() => { void tick(); }, 1200);
  void tick();
}

function registerIpc() {
  ipcMain.handle('artisys:config', () => ({
    apiBase,
    deploymentProfile: bootstrapConfig?.profile || 'server-terminal',
    terminalId: bootstrapConfig?.terminalId || 'PDV-01',
    terminalName: bootstrapConfig?.terminalName || 'Terminal PDV-01',
    storeName: bootstrapConfig?.storeName || 'Loja Matriz',
    lanEnabled: Boolean(lanServer),
    version: productVersion,
    installation:installationState({userData:app.getPath('userData'),version:productVersion,existing:installationWasExisting}),
    dataServer: publicDataServerState()
  }));

  ipcMain.handle('artisys:installation:acknowledge', () => {acknowledgeInstallation({userData:app.getPath('userData'),version:productVersion});return {ok:true};});
  ipcMain.handle('artisys:installation:new-store', async (_event,payload={}) => {
    if(installationTransition)throw new Error('Uma nova instalação já está sendo preparada.');
    await authorizeDeploymentChange(payload.sessionToken);
    if(!runtime||isExternalMode(dataServerConfig))throw new Error('Crie a nova loja no PC que guarda os dados, não em um terminal conectado.');
    if(payload.confirmation!=='NOVA LOJA')throw new Error('Digite NOVA LOJA para confirmar.');
    if(runtime.backups.getBackupStatus().pendingRestore)throw new Error('Conclua a restauração pendente antes de iniciar uma nova loja.');
    if(installationTransition)throw new Error('Uma nova instalação já está sendo preparada.');
    installationTransition=true;
    let stopped=false;
    try {
      const backup=runtime.backups.createBackup('pre-new-installation',{prune:false});
      if(!backup.valid)throw new Error('O backup não passou na verificação de integridade.');
      stopped=true;
      if(printWorker){clearInterval(printWorker);printWorker=null;}
      const deadline=Date.now()+12000;
      while(printWorkerBusy){if(Date.now()>deadline)throw new Error('Aguarde a impressão terminar antes de iniciar outra loja.');await new Promise(resolve=>setTimeout(resolve,50));}
      lanDiscovery?.stop();lanDiscovery=null;
      if(lanServer){await lanServer.stop();lanServer=null;}
      if(localServer){await localServer.stop();localServer=null;}
      runtime.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');runtime.close();runtime=null;
      const result=archiveInstallation({userData:app.getPath('userData'),confirmation:payload.confirmation,backup});
      app.relaunch();app.exit(0);return result;
    } catch(error) {
      if(stopped){
        if(!runtime){await startEmbeddedServer();}
        else {
          if(!localServer){localServer=createLocalServer({runtime,host:'127.0.0.1',port:0,token:installToken,requireTerminalAuth:false,isExistingInstall:true});const address=await localServer.start();apiBase=`http://127.0.0.1:${address.port}`;}
          if(isHostMode(dataServerConfig)&&!lanServer){lanServer=createLocalServer({runtime,host:dataServerConfig.host,port:dataServerConfig.port,token:installToken,requireTerminalAuth:true,isExistingInstall:true});await lanServer.start();}
        }
        startPrintWorker();
      }
      throw error;
    } finally {installationTransition=false;}
  });

  ipcMain.handle('artisys:public-network:state', async () => publicNetworkState({config:dataServerConfig,lanEnabled:Boolean(lanServer),stableHost:await lanDiscovery?.state()||''}));
  ipcMain.handle('artisys:public-network:challenge', async (_event,input={}) => {
    const stableHost=await lanDiscovery?.state()||'';
    const state=publicNetworkState({config:dataServerConfig,lanEnabled:Boolean(lanServer),stableHost});
    if(!state.enabled||state.remote||!runtime?.lanReachability)throw new Error('Ative o PC principal para testar pelo celular.');
    const host=String(input.host||'').trim();
    const port=Number(input.port);
    if(!state.addresses.includes(host)&&host!==stableHost)throw new Error('Selecione um endereço da rede deste computador.');
    if(port!==state.port)throw new Error('A porta não corresponde ao servidor local ativo.');
    const {token,expiresAt}=runtime.lanReachability.start();
    const lan=runtime.mobileAccess.getLanAccess({host,port,path:'/lan-check/'+token,protocol:'http:'});
    return{token,expiresAt,url:lan.url,qrSvg:lan.qrSvg};
  });
  ipcMain.handle('artisys:public-network:challenge-status', (_event,token) => {
    return runtime?.lanReachability?.status(token)||{confirmed:false,expired:true};
  });
  ipcMain.handle('artisys:public-network:test', (_event,input={}) => testPublicNetwork({state:publicNetworkState({config:dataServerConfig,lanEnabled:Boolean(lanServer)}),host:input.host,port:input.port}));
  ipcMain.handle('artisys:public-network:firewall-settings', async () => {
    if(process.platform!=='win32')throw new Error('Abra as configurações de firewall do sistema operacional.');
    await shell.openExternal('ms-settings:windowsdefender-firewall');
    return{opened:true,message:'Confira as permissões do ArtiSys na rede privada. Não desative o firewall.'};
  });

  ipcMain.handle('artisys:data-server:discover', () => discoverLanServers());
  ipcMain.handle('artisys:data-server:state', () => publicDataServerState());
  ipcMain.handle('artisys:data-server:new-installation', () => {
    if(dataServerConfig?.selected||Number(runtime?.catalog?.countUsers?.()||0)>0)throw new Error('A configuração inicial deste computador já foi concluída.');
    dataServerConfig=saveDataServerIntent(dataServerConfigPath,'new-installation');
    return { config:publicDataServerState() };
  });
  ipcMain.handle('artisys:data-server:pair', async (_event, input = {}) => {
    if(dataServerConfig?.selected)throw new Error('Este computador já possui uma implantação configurada.');
    const result=await pairDataServerTerminal({
      db:runtime?.db||null,
      filePath:dataServerConfigPath,
      input,
      currentConfig:dataServerConfig,
      credentialStore:terminalCredentialStore,
      identityStore:terminalIdentityStore,
      fetchImpl:(url,options)=>fetchWithTimeout(url,options,5000),
      appVersion:productVersion,
      timeoutMs:5000
    });
    dataServerConfig=loadDataServerConfig(dataServerConfigPath);
    return { ...result, config:publicDataServerState() };
  });
  ipcMain.handle('artisys:data-server:save', async (_event, payload = {}) => {
    await authorizeDeploymentChange(payload.sessionToken);
    const input=payload.input||{};
    dataServerConfig = saveDataServerSelection({
      db:runtime?.db||null,
      filePath:dataServerConfigPath,
      input,
      currentConfig:dataServerConfig,
      credentialStore:terminalCredentialStore
    });
    acknowledgeInstallation({userData:app.getPath('userData'),version:productVersion});
    return { config:publicDataServerState(), restartRequired:true };
  });
  ipcMain.handle('artisys:data-server:test', async (_event, input = {}) => testDataServerTarget({
    input,
    currentConfig:dataServerConfig,
    credentialStore:terminalCredentialStore,
    fetchImpl:(url,options)=>fetchWithTimeout(url,options,5000),
    timeoutMs:5000
  }));
  ipcMain.handle('artisys:data-server:restart', () => { if(process.env.ARTISYS_QA==='1'&&process.env.ARTISYS_QA_NO_RELAUNCH==='1')return {restartRequired:true,suppressed:true}; app.relaunch(); app.exit(0); return {restartRequired:true}; });

  ipcMain.handle('artisys:api', async (_event, request = {}) => {
    const method = String(request.method || 'GET').toUpperCase();
    const rawPath = String(request.path || '/api/v1/health');
    if (!rawPath.startsWith('/api/v1/')) throw new Error('Rota de API invalida.');
    const headers = { accept: 'application/json' };
    if (request.sessionToken) headers.authorization = `Bearer ${request.sessionToken}`;
    if (request.mutationId) headers['x-mutation-id'] = String(request.mutationId);
    if (bootstrapConfig?.profile === 'terminal') {
      headers['x-terminal-id'] = bootstrapConfig.terminalId;
      headers['x-terminal-key'] = bootstrapConfig.terminalKey;
    } else if (rawPath === '/api/v1/auth/login' || rawPath === '/api/v1/setup/admin' || rawPath.startsWith('/api/v1/setup/activation/') || rawPath.startsWith('/api/v1/restaurant/') || rawPath.startsWith('/api/v1/vertical/') || rawPath.startsWith('/api/v1/product-variants')) {
      headers['x-pdv-token'] = installToken;
    }
    let body;
    if (request.body !== undefined && request.body !== null) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(request.body);
    }
    const response = await fetchWithTimeout(`${apiBase}${rawPath}`, { method, headers, body });
    let payload = null;
    const text = await response.text();
    if (text) {
      try { payload = JSON.parse(text); }
      catch { payload = { error: text }; }
    }
    return { ok: response.ok, status: response.status, payload };
  });

  hardwareController = buildHardwareController();
  const trustedSender = event => Boolean(mainWindow && event.sender === mainWindow.webContents);
  registerHardwareIpc({ ipcMain, controller: hardwareController, isTrustedSender: trustedSender });
  const receiptActions=createReceiptActions({
    BrowserWindow,
    dialog,
    writeFile:writeReceiptFile,
    getReceipt:fetchSaleReceipt,
    createPrintAttempt:createSalePrintAttempt,
    finishPrintAttempt:finishSalePrintAttempt,
    printReceipt:receipt=>hardwareController.print({
      id:`sale-${receipt.saleId}`,
      text:receipt.text,
      width:receipt.width,
      paperMm:receipt.paperMm,
      logoDataUrl:receipt.logoDataUrl||null
    }),
    env:process.env,
    getParentWindow:()=>mainWindow
  });
  registerReceiptIpc({ipcMain,actions:receiptActions,isTrustedSender:trustedSender});
  registerImportIpc({ ipcMain, dialog, getParentWindow:()=>mainWindow, isTrustedSender:trustedSender });
  const photoClient=createProductPhotoClient({cacheDir:path.join(app.getPath('userData'),'photo-cache',bootstrapConfig?.terminalId||'PDV-01'),getApiBase:()=>apiBase,getTerminalHeaders:()=>bootstrapConfig?.profile==='terminal'?{'x-terminal-id':bootstrapConfig.terminalId,'x-terminal-key':bootstrapConfig.terminalKey}:{}});
  registerProductPhotoIpc({ipcMain,dialog,nativeImage,client:photoClient,getParentWindow:()=>mainWindow,isTrustedSender:trustedSender});

  ipcMain.on('artisys:window:minimize', () => mainWindow?.minimize());
  ipcMain.on('artisys:window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('artisys:window:close', () => mainWindow?.close());
}

async function shutdown() {
  lanDiscovery?.stop();lanDiscovery=null;
  if (printWorker) clearInterval(printWorker);
  printWorker = null;
  try {
    if (lanServer) await lanServer.stop();
    if (localServer) await localServer.stop();
  } finally {
    lanServer = null;
    localServer = null;
    if (runtime) runtime.close();
    runtime = null;
  }
}

app.whenReady().then(async () => {
  dataServerConfigPath = path.join(app.getPath('userData'), 'data-server.json');
  dataServerConfig = loadDataServerConfig(dataServerConfigPath);
  // QA runs must be deterministic: choose local storage without opening the
  // first-run selector (which intentionally restarts the app after saving).
  // This is restricted to the automated QA process and never affects installs.
  if (process.env.ARTISYS_QA === '1' && process.env.ARTISYS_QA_AUTO_LOCAL === '1' && !dataServerConfig.selected) {
    dataServerConfig = saveDataServerConfig(dataServerConfigPath, { mode:'local', host:'127.0.0.1', port:4174, terminalId:'PDV-01' });
  }
  const deploymentPath = path.join(app.getPath('userData'), 'deployment.json');
  const publicBootstrap = resolveBootstrapConfig({ env:process.env, configPath:deploymentPath });
  terminalCredentialStore = createTerminalCredentialStore({ app, safeStorage });
  terminalIdentityStore = createTerminalIdentityStore({ userDataPath:app.getPath('userData') });
  dataServerConfig = migrateLegacyDataServerCredential({ config:dataServerConfig, filePath:dataServerConfigPath, credentialStore:terminalCredentialStore });
  hardwareConfigStore = createHardwareConfigStore({ filePath:path.join(app.getPath('userData'), 'hardware.json') });
  if (publicBootstrap.profile === 'terminal') {
    const bootstrapSecret = String(process.env.PDV_TERMINAL_KEY || '').trim();
    if (bootstrapSecret) terminalCredentialStore.save(bootstrapSecret);
    const terminalKey = bootstrapSecret || terminalCredentialStore.load();
    bootstrapConfig = { ...publicBootstrap, terminalKey };
  } else {
    bootstrapConfig = publicBootstrap;
  }
  validateBootstrapConfig(bootstrapConfig);
  if (!isExternalMode(dataServerConfig) && shouldStartEmbeddedServer(bootstrapConfig)) {
    await startEmbeddedServer();
  } else {
    apiBase = isExternalMode(dataServerConfig) ? dataServerConfig.serverUrl : bootstrapConfig.apiBase.replace(/\/+$/, '');
    if (isExternalMode(dataServerConfig)) {
      const terminalKey=terminalCredentialStore.load();
      if(!terminalKey)throw new Error('Credencial segura deste terminal não está configurada. Configure novamente o servidor de dados.');
      bootstrapConfig = { ...bootstrapConfig, profile:'terminal', terminalId:dataServerConfig.terminalId, terminalKey, apiBase };
      validateBootstrapConfig(bootstrapConfig);
    }
  }

  registerIpc();
  createMainWindow();
  startPrintWorker();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
}).catch((error) => {
  console.error('Falha fatal ao iniciar o ArtiSys PDV.', error);
  try {
    dialog.showErrorBox(
      'ArtiSys PDV - Falha na inicialização',
      `${error?.message || error}\n\nReinicie o computador e tente novamente. Se o problema continuar, envie esta mensagem ao suporte ArtiSys.`
    );
  } catch {}
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => { void shutdown(); });
