'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {EventEmitter}=require('node:events');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('terminal discovery finds only ArtiSys principal services and returns pairable URLs',async()=>{
  const {discoverLanServers}=require('../desktop/lan-discovery.cjs');
  const browser=new EventEmitter();
  let stopped=false,destroyed=false;
  browser.stop=()=>{stopped=true;};
  const bonjour={
    find(options,onService){
      assert.deepEqual(options,{type:'http'});
      queueMicrotask(()=>{
        onService({name:'artisys-principal',host:'artisys-abcd.local.',port:4174,addresses:['192.168.1.20'],txt:{product:'ArtiSys',role:'principal'}});
        onService({name:'other-http',host:'printer.local',port:80,addresses:['192.168.1.50'],txt:{product:'Printer'}});
        browser.emit('up',{name:'artisys-principal',host:'artisys-abcd.local.',port:4174,addresses:['192.168.1.20'],txt:{product:'ArtiSys',role:'principal'}});
      });
      return browser;
    },
    destroy(){destroyed=true;}
  };
  const result=await discoverLanServers({timeoutMs:10,bonjourFactory:()=>bonjour});
  assert.deepEqual(result,[{
    id:'artisys-abcd.local:4174',
    name:'PC principal ArtiSys',
    host:'artisys-abcd.local',
    port:4174,
    url:'http://artisys-abcd.local:4174',
    addresses:['192.168.1.20']
  }]);
  assert.equal(stopped,true);
  assert.equal(destroyed,true);
});

test('terminal onboarding discovers the principal and keeps manual address under advanced settings',()=>{
  const app=read('desktop/renderer/app.js');
  const preload=read('desktop/preload.cjs');
  const main=read('desktop/main.cjs');
  assert.match(preload,/dataServer:\s*\{[\s\S]*discover:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('artisys:data-server:discover'\)/);
  assert.match(main,/artisys:data-server:discover/);
  assert.match(app,/data-discovered-servers/);
  assert.match(app,/Procurar novamente/);
  assert.match(app,/Configuração avançada/);
  assert.match(app,/dataServer\.discover\(\)/);
  assert.match(app,/Selecione um PC principal encontrado ou informe o endereço/);
});

test('legacy mobile QR generator is removed in favor of the canonical publicNetwork surface',()=>{
  const legacy=read('desktop/renderer/e48-e54-ui.js');
  const canonical=read('desktop/renderer/restaurant-public-ordering-ui.js');
  assert.doesNotMatch(legacy,/Acesso mobile \/ QR/);
  assert.doesNotMatch(legacy,/IP\/host do servidor/);
  assert.doesNotMatch(legacy,/127\.0\.0\.1/);
  assert.match(canonical,/artisysDesktop\.publicNetwork\.state\(\)/);
  assert.match(canonical,/Servidor detectado automaticamente/);
});

test('drawer configuration is visible, persistent and testable from the peripherals screen',()=>{
  const ui=read('desktop/renderer/hardware-scale-ui.js');
  const preload=read('desktop/preload.cjs');
  assert.match(preload,/configureDrawer/);
  assert.match(ui,/drawer-config-card/);
  assert.match(ui,/id="drawer-port"/);
  assert.match(ui,/id="drawer-baud"/);
  assert.match(ui,/configureDrawer/);
  assert.match(ui,/Salvar e testar/);
  assert.match(ui,/testDrawer\(\)/);
  assert.match(ui,/configurada \(não detectada agora\)/);
});

test('Pedidos reads canonical and legacy history through one compatibility API',()=>{
  const ui=read('desktop/renderer/vertical-modules.js');
  const client=read('desktop/renderer/vertical-api-client.js');
  const router=read('server/vertical-router.js');
  assert.match(client,/foodOrders\(\)\{return this\.request\('\/api\/v1\/vertical\/food\/orders'\)/);
  assert.match(router,/pathname==='\/api\/v1\/vertical\/food\/orders'/);
  assert.match(ui,/api\.foodOrders\(\)/);
  assert.doesNotMatch(ui,/api\.fastFood\(\)/);
});

test('active release metadata no longer presents Fast-food as a product capability',()=>{
  const capabilities=read('release/capabilities.json');
  const customer=JSON.parse(read('release/customer-capabilities.json'));
  const declared=(customer.capabilities||[]).flatMap(item=>item.declaredCapabilities||[]).join(' ');
  assert.doesNotMatch(capabilities,/fast-food/i);
  assert.doesNotMatch(declared,/fast-food/i);
  assert.match(capabilities,/food-unified-orders/i);
});

test('README keeps the source version while documenting the dynamic release artifact',()=>{
  const readme=read('README.md');
  assert.match(readme,/ArtiSys PDV 2\.0\.1/);
  assert.doesNotMatch(readme,/linha 1\.4/);
  assert.doesNotMatch(readme,/versão comercial 1\.4\.23/i);
  assert.doesNotMatch(readme,/alvo de empacotamento comercial 2\.0\.0/i);
  assert.doesNotMatch(readme,/ArtiSys-PDV-1\.4\.23-x64-Setup\.exe/);
  assert.match(readme,/ArtiSys-PDV-\*-x64-Setup\.exe/);
});

test('reports use the store business date instead of the process timezone',()=>{
  const source=read('desktop/renderer/reporting-v2.js');
  assert.match(source,/storeTimeZone = 'America\/Sao_Paulo'/);
  assert.match(source,/PdvBusinessDate\.localBusinessDate\(reference,storeTimeZone\)/);
  assert.match(source,/const today = businessToday\(\)/);
});

test('Settings keeps one canonical company surface and no custom selection channel or DOM observers',()=>{
  const hub=read('desktop/renderer/settings-hub-ui.js');
  const admin=read('desktop/renderer/admin-ops.js');
  const index=read('desktop/renderer/index.html');
  assert.doesNotMatch(hub,/settings:select|MutationObserver/);
  assert.doesNotMatch(admin,/MutationObserver/);
  assert.match(admin,/id="settings-company-store"/);
  assert.match(admin,/data-settings-category="company"/);
  assert.match(admin,/store\.address/);
  assert.match(admin,/store\.phone/);
  assert.match(admin,/store\.logoDataUrl/);
  assert.doesNotMatch(index,/store-branding-ui\.js/);
  assert.match(admin,/route:mounted/);
  assert.match(admin,/route:updated/);
  assert.match(admin,/routeRegistry\.updated\('settings',\{surface:'settings-extension',extension:'admin-ops'\}\)/);
});

test('backup restore dialog traps keyboard focus, closes on Escape and restores the opener focus',()=>{
  const source=read('desktop/renderer/admin-ops.js');
  assert.match(source,/aria-describedby="ops-restore-description"/);
  assert.match(source,/event\.key==='Escape'/);
  assert.match(source,/event\.key!=='Tab'/);
  assert.match(source,/restoreFocus/);
  assert.match(source,/previouslyFocused/);
});
