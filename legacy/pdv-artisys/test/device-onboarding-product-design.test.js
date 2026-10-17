'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

test('first-run device onboarding separates a new installation from joining an existing one',()=>{
  const app=read('desktop/renderer/app.js');
  assert.match(app,/Iniciar uma nova instalação/);
  assert.match(app,/Conectar a uma instalação existente/);
  assert.match(app,/Código de pareamento/);
  assert.match(app,/Nome deste computador/);
  assert.doesNotMatch(app,/Chave de pareamento/);
  assert.match(app,/dataServer\.pair/);
});

test('terminal pairing is completed by Electron and the permanent credential stays out of renderer UI',()=>{
  const preload=read('desktop/preload.cjs');
  const main=read('desktop/main.cjs');
  const runtime=read('desktop/data-server-runtime.cjs');
  assert.match(preload,/pair:\s*\(input\)/);
  assert.match(main,/artisys:data-server:pair/);
  assert.match(main,/terminalIdentity/);
  assert.match(runtime,/pairDataServerTerminal/);
  assert.doesNotMatch(preload,/terminalKey.*pair|pair.*terminalKey/);
});

test('new primary installation is activated and administered before choosing local-only or LAN host mode',()=>{
  const config=read('desktop/data-server-config.cjs');
  const app=read('desktop/renderer/app.js');
  const firstAccess=read('desktop/renderer/first-access-ui.js');
  assert.match(config,/setupIntent/);
  assert.match(app,/setupIntent/);
  assert.match(firstAccess,/setup\.activation\?\.required/);
  assert.match(app,/Usar somente neste computador/);
  assert.match(app,/Tornar este o PC principal/);
  assert.match(app,/deployment\.manage/);
});

test('deployment role changes have a dedicated capability that is not granted to the default manager',()=>{
  const permissions=require('../js/core/auth/permission-registry');
  const profiles=require('../js/core/auth/default-profiles');
  assert.equal(permissions.isKnownPermission('deployment.manage'),true);
  assert.equal(profiles.DEFAULT_PROFILE_PERMISSIONS.ADMINISTRATOR.includes('deployment.manage'),true);
  assert.equal(profiles.DEFAULT_PROFILE_PERMISSIONS.MANAGER.includes('deployment.manage'),false);
});

test('settings never expose a permanent pairing secret and show a read-only state without deployment authority',()=>{
  const settings=read('desktop/renderer/settings-hub-ui.js');
  assert.doesNotMatch(settings,/Chave de pareamento/);
  assert.doesNotMatch(settings,/name="terminalKey"/);
  assert.match(settings,/deployment\.manage/);
  assert.match(settings,/Somente administradores autorizados podem alterar/);
});

test('PC principal panel consolidates LAN state, pairing and terminal lifecycle',()=>{
  const ui=read('desktop/renderer/operational-detail-extensions.js');
  assert.match(ui,/PC principal: ATIVO/);
  assert.match(ui,/Adicionar terminal/);
  assert.match(ui,/Desativar acesso pela rede/);
  assert.match(ui,/lanAddresses/);
  assert.match(ui,/Bloquear/);
  assert.match(ui,/Reativar/);
});

test('multi-device QA declares the real onboarding, blocking and reactivation Electron flow',()=>{
  const runner=read('qa/multi-device/run.mjs');
  const contract=read('test/qa-multi-device-workflow.test.js');
  assert.match(runner,/terminal-onboarding-pairing/);
  assert.match(runner,/data-pairing-code/);
  assert.match(runner,/data-connect-existing/);
  assert.match(runner,/BLOCKED/);
  assert.match(runner,/ACTIVE/);
  assert.match(contract,/terminal-onboarding-pairing/);
});


test('terminal identity is generated once per installation without reading hardware identifiers',()=>{
  const fs=require('node:fs');
  const os=require('node:os');
  const path=require('node:path');
  const {createTerminalIdentityStore}=require('../desktop/terminal-identity.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-terminal-identity-'));
  const store=createTerminalIdentityStore({userDataPath:dir,randomUUID:()=> '123e4567-e89b-12d3-a456-426614174000'});
  const first=store.getOrCreate();
  const second=store.getOrCreate();
  assert.deepEqual(second,first);
  assert.match(first.terminalId,/^PDV-[A-Z0-9]+$/);
  assert.match(first.fingerprint,/^install-/);
  assert.doesNotMatch(read('desktop/terminal-identity.cjs'),/networkInterfaces|mac|serial|wmic|motherboard/i);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('pairing by temporary code stores only the permanent credential in safe storage',async()=>{
  const fs=require('node:fs');
  const os=require('node:os');
  const path=require('node:path');
  const {pairDataServerTerminal}=require('../desktop/data-server-runtime.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-pair-by-code-'));
  const file=path.join(dir,'data-server.json');
  let secret='';
  const credentialStore={
    status:()=>({configured:Boolean(secret),encryptionAvailable:true}),
    save:value=>{secret=String(value);return{configured:true};},
    load:()=>secret||null
  };
  const identityStore={getOrCreate:()=>({terminalId:'PDV-ABC123',fingerprint:'install-123',createdAt:'2026-10-03T12:00:00.000Z'})};
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    calls.push({url:String(url),options});
    if(String(url).includes('/api/v1/lan/handshake'))return{ok:true,status:200,json:async()=>({compatible:true,minimumTerminalVersion:'1.4.0'})};
    return{ok:true,status:201,json:async()=>({terminalId:'PDV-ABC123',name:'Caixa 02',status:'ACTIVE',credential:'permanent-secret'})};
  };
  const result=await pairDataServerTerminal({
    db:null,
    filePath:file,
    input:{serverUrl:'http://192.168.0.10:4174',code:'583291',name:'Caixa 02'},
    currentConfig:{mode:'local',selected:false},
    credentialStore,
    identityStore,
    fetchImpl,
    appVersion:'1.4.23'
  });
  assert.equal(result.config.mode,'lan-client');
  assert.equal(result.config.terminalId,'PDV-ABC123');
  assert.equal(secret,'permanent-secret');
  assert.equal(calls.length,2);
  assert.match(calls[1].url,/\/api\/v1\/lan\/pair$/);
  assert.deepEqual(JSON.parse(calls[1].options.body),{
    code:'583291',terminalId:'PDV-ABC123',name:'Caixa 02',fingerprint:'install-123',appVersion:'1.4.23'
  });
  assert.doesNotMatch(fs.readFileSync(file,'utf8'),/permanent-secret|terminalKey/);
  fs.rmSync(dir,{recursive:true,force:true});
});


test('deployment migration grants the new capability to existing administrators only',()=>{
  const {createPdvRuntime}=require('../js/core/pdv-runtime');
  const {runDeploymentCapabilityMigrations,DEPLOYMENT_CAPABILITY_SCHEMA_VERSION}=require('../js/core/database/deployment-capability-migrations');
  const {DEFAULT_PROFILE_IDS}=require('../js/core/auth/default-profiles');
  const runtime=createPdvRuntime();
  try{
    runtime.db.prepare('DELETE FROM schema_migrations WHERE version=?').run(DEPLOYMENT_CAPABILITY_SCHEMA_VERSION);
    runtime.db.prepare('DELETE FROM profile_permissions WHERE profile_id=? AND permission_id=?')
      .run(DEFAULT_PROFILE_IDS.ADMINISTRATOR,'deployment.manage');
    runtime.db.prepare('DELETE FROM profile_permissions WHERE profile_id=? AND permission_id=?')
      .run(DEFAULT_PROFILE_IDS.MANAGER,'deployment.manage');

    runDeploymentCapabilityMigrations(runtime.db,()=> '2026-10-03T12:00:00.000Z');
    assert.equal(runtime.db.prepare('SELECT COUNT(*) AS n FROM profile_permissions WHERE profile_id=? AND permission_id=?')
      .get(DEFAULT_PROFILE_IDS.ADMINISTRATOR,'deployment.manage').n,1);
    assert.equal(runtime.db.prepare('SELECT COUNT(*) AS n FROM profile_permissions WHERE profile_id=? AND permission_id=?')
      .get(DEFAULT_PROFILE_IDS.MANAGER,'deployment.manage').n,0);
    assert.equal(runDeploymentCapabilityMigrations(runtime.db),DEPLOYMENT_CAPABILITY_SCHEMA_VERSION);
  }finally{runtime.close();}
});


test('paired terminals cannot silently retarget the permanent credential to another server',()=>{
  const settings=read('desktop/renderer/settings-hub-ui.js');
  assert.match(settings,/value="lan-client" disabled/);
  assert.match(settings,/value="own-server" disabled/);
  assert.match(settings,/credencial atual nunca é reaproveitada em outro servidor/);
  assert.match(settings,/const external=\['lan-client','own-server'\]\.includes\(value\.mode\)/);
});


test('generic deployment save requires a fresh pairing flow before selecting a remote server',()=>{
  const fs=require('node:fs');
  const os=require('node:os');
  const path=require('node:path');
  const {saveDataServerSelection}=require('../desktop/data-server-runtime.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-remote-enrollment-'));
  const file=path.join(dir,'data-server.json');
  const store={load:()=> 'paired-value',save:()=>({configured:true}),status:()=>({configured:true,encryptionAvailable:true})};
  assert.throws(()=>saveDataServerSelection({
    db:null,
    filePath:file,
    input:{mode:'lan-client',serverUrl:'http://192.168.0.11:4174',terminalId:'PDV-ABC123'},
    currentConfig:{selected:true,mode:'lan-client',serverUrl:'http://192.168.0.10:4174',terminalId:'PDV-ABC123'},
    credentialStore:store
  }),/novo pareamento/i);
  fs.rmSync(dir,{recursive:true,force:true});
});
