'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('P5 presents Core and optional areas directly without a second module manager step',()=>{
  const modules=read('desktop/renderer/vertical-modules.js');
  const settings=read('desktop/renderer/settings-hub-ui.js');
  assert.match(settings,/Alimentação e Atacado/);
  assert.match(modules,/Núcleo ArtiSys/);
  assert.match(modules,/Uma operação · um caixa · áreas opcionais/);
  assert.match(modules,/void loadAndRenderSettingsModules\(card\)/);
  assert.match(modules,/data-module-config/);
  assert.match(modules,/O menu lateral se atualiza imediatamente/);
  assert.doesNotMatch(modules,/ops-load-establishment-modules|Gerenciar áreas|Gerenciar módulos/);
});

test('P6 keeps sidebar and Home focused on capability-derived top-level workflows',()=>{
  const policy=require('../desktop/renderer/access-policy');
  const user=permissions=>({permissions});
  assert.deepEqual(policy.routesForUser(user(['sales.create','sales.view','returns.view','cash.view','customers.view'])),['home','checkout','cash','post-sale','catalog']);
  assert.deepEqual(policy.routesForUser(user(['sales.create','sales.view','returns.view','cash.view','customers.view','finance.view'])),['home','checkout','cash','post-sale','catalog','financial-management']);
  assert.deepEqual(policy.routesForUser(user(['users.view','settings.view'])),['home','access','settings']);
});

test('P6 Cadastros hub exposes child tasks according to route permission',()=>{
  const app=read('desktop/renderer/app.js');
  assert.match(app,/catalog: \{ label: 'Cadastros'/);
  assert.match(app,/renderFlowHub\('Cadastros'/);
  for(const route of ['customers','products','inventory','sellers'])assert.match(app,new RegExp(`route:'${route}'`));
  assert.match(app,/visibleCards=.*canAccessRoute/);
  assert.match(app,/delete document\.body\.dataset\.activeModuleWorkspace/);
});

test('settings access card is gated only by canonical capabilities',()=>{
  const settings=read('desktop/renderer/settings-hub-ui.js');
  const app=read('desktop/renderer/app.js');
  assert.match(settings,/\['users\.view','profiles\.view'\]\.some\(capability=>window\.PdvAccessPolicy\?\.hasCapability\(window\.PdvCurrentAccess,capability\)\)/);
  assert.match(settings,/data-settings-route="access"/);
  assert.doesNotMatch(settings,/dataset\.userRole|\['admin','manager'\]/);
  assert.doesNotMatch(app,/dataset\.userRole|dataset\.userPermissions/);
  const restaurant=read('desktop/renderer/restaurant-ui.js');
  assert.doesNotMatch(restaurant,/dataset\.userRole|\['admin','manager'\]/);
  const management=read('desktop/renderer/erp-finance-ui.js');
  assert.match(management,/PdvAccessPolicy\?\.hasCapability\(access,'management\.view'\)/);
  assert.doesNotMatch(management,/dataset\.userRole|\['admin','manager'\]|\.user\?\.role/);
});

test('QA audit covers optional areas and universal checkout documents',()=>{
  const flow=JSON.parse(read('qa/flows/all-pages-audit.json'));
  const names=new Set(flow.steps.map(step=>step.name));
  for(const name of [
    'configuracoes-areas','alimentacao','alimentacao-mesas-comandas','atacado',
    'balcao-comandas-pedidos','balcao-pedido-atacado-carregado'
  ])assert.equal(names.has(name),true,name);
  assert.equal(names.has('servicos'),false);
  const registry=read('js/core/modules/module-registry.js');
  assert.doesNotMatch(registry,/id:'SERVICES'/);
});
