'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('optional business areas are canonical routes, not a second navigation system',()=>{
  const app=read('desktop/renderer/app.js');
  const modules=read('desktop/renderer/vertical-modules.js');

  assert.match(app,/FOOD:\s*\{\s*label:\s*'Alimentação'/);
  assert.match(app,/WHOLESALE:\s*\{\s*label:\s*'Atacado'/);
  assert.match(app,/artisys:modules-state-changed/);

  assert.match(modules,/PdvRouteRegistry/);
  assert.match(modules,/register\(['"]FOOD['"][\s\S]*owner:\s*['"]vertical-modules['"]/);
  assert.match(modules,/register\(['"]WHOLESALE['"][\s\S]*owner:\s*['"]vertical-modules['"]/);
  assert.doesNotMatch(modules,/function\s+renderWorkspace\b/);
  assert.doesNotMatch(modules,/\[data-module-nav\]/);
  assert.doesNotMatch(modules,/dataset\.activeRoute\s*=/);
  assert.doesNotMatch(modules,/stopImmediatePropagation\(\)/);
});

test('module state cache publishes state only and never owns launcher DOM or navigation clicks',()=>{
  const gate=read('desktop/renderer/restaurant-module-gate.js');
  assert.match(gate,/artisys:modules-state-changed/);
  assert.match(gate,/PdvModuleGate/);
  assert.doesNotMatch(gate,/applyLauncherState/);
  assert.doesNotMatch(gate,/\[data-module-open|\[data-module-nav/);
  assert.doesNotMatch(gate,/stopImmediatePropagation\(\)/);
});

test('Settings is composed by its canonical owner without role-name visibility gates',()=>{
  const operational=read('desktop/renderer/operational-pages.js');
  const hub=read('desktop/renderer/settings-hub-ui.js');
  const modules=read('desktop/renderer/vertical-modules.js');

  assert.match(operational,/PdvVerticalModules\?\.mountSettingsModules\?\.\(pageRoot\)/);
  assert.match(operational,/PdvSettingsHub\?\.mount\?\.\(pageRoot\)/);
  assert.doesNotMatch(hub,/dataset\.userRole|\['admin','manager'\]/);
  assert.match(hub,/PdvAccessPolicy\?\.hasCapability/);
  assert.doesNotMatch(hub,/route:mounted/);
  assert.doesNotMatch(modules,/lifecycle\?\.on\?\.\(['"]route:/);
});

test('access center asserts canonical ownership instead of silently yielding the route',()=>{
  const source=read('desktop/renderer/access-center-ui.js');
  assert.match(source,/registry\.register\('access',\{owner:'access-center',render\}\)/);
  assert.doesNotMatch(source,/if\(!registry\.has\('access'\)\)/);
});

test('legacy payment copy is fixed at the source instead of globally rewriting DOM text',()=>{
  const app=read('desktop/renderer/app.js');
  const modules=read('desktop/renderer/vertical-modules.js');
  assert.match(app,/CREDIT_CARD:\s*'Cartão crédito'/);
  assert.doesNotMatch(app,/Cartão crédito \/ TEF/);
  assert.doesNotMatch(modules,/sanitizeLegacyPaymentCopy|createTreeWalker|NodeFilter\.SHOW_TEXT/);
});

test('module routes require both an enabled establishment module and the user capability',()=>{
  const policy=require('../desktop/renderer/access-policy');
  const foodUser={permissions:['restaurant.access']};
  const wholesaleUser={permissions:['wholesale.access']};

  assert.equal(policy.canAccessRoute(foodUser,'FOOD'),false);
  assert.equal(policy.canAccessRoute(foodUser,'FOOD',{moduleState:{FOOD:false}}),false);
  assert.equal(policy.canAccessRoute(foodUser,'FOOD',{moduleState:{FOOD:true}}),true);
  assert.equal(policy.canAccessRoute(wholesaleUser,'WHOLESALE',{moduleState:{WHOLESALE:true}}),true);
  assert.equal(policy.canAccessRoute(foodUser,'WHOLESALE',{moduleState:{WHOLESALE:true}}),false);
  assert.deepEqual(
    policy.routesForUser(foodUser,{moduleState:{FOOD:true,WHOLESALE:true}}),
    ['home','FOOD']
  );
});

test('canonical module owner loads before the Settings owner',()=>{
  const html=read('desktop/renderer/index.html');
  const registry=html.indexOf('./route-registry.js');
  const access=html.indexOf('./access-policy.js');
  const modules=html.indexOf('./vertical-modules.js');
  const app=html.indexOf('./app.js');
  const operational=html.indexOf('./operational-pages.js');
  assert.ok(registry>=0&&access>registry&&modules>access);
  assert.ok(app>modules);
  assert.ok(operational>app&&operational>modules);
});
