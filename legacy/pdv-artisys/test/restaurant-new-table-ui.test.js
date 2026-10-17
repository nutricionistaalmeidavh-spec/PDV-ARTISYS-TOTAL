'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'desktop/renderer/restaurant-ui.js'),'utf8');

test('nova mesa usa modal interno em vez de prompt incompatível com Electron',()=>{
  assert.doesNotMatch(source,/root\.prompt\s*\(/);
  assert.match(source,/function openNewTableModal\(\)/);
  assert.match(source,/id="restaurant-new-table-form"/);
  assert.match(source,/name="label"/);
  assert.match(source,/name="seats"/);
  assert.match(source,/\/api\/v1\/restaurant\/tables/);
});

test('restaurante entra somente pelo catálogo de módulos, sem launcher oculto na Home',()=>{
  const gatePath=path.join(root,'desktop/renderer/restaurant-module-gate.js');
  assert.equal(fs.existsSync(gatePath),true,'restaurant-module-gate.js deve existir');
  const gate=fs.readFileSync(gatePath,'utf8');
  const html=fs.readFileSync(path.join(root,'desktop/renderer/index.html'),'utf8');
  assert.match(gate,/api\.modules\(\)/);
  assert.match(gate,/PdvModuleGate/);
  assert.doesNotMatch(gate,/data-restaurant-route/);
  assert.doesNotMatch(source,/data-restaurant-route|ensureLauncher/);
  assert.match(gate,/ApiClient\.prototype\.saveSetting/);
  assert.doesNotMatch(gate,/PdvRestaurantModuleGate/);
  assert.ok(html.indexOf('./restaurant-module-gate.js')<html.indexOf('./restaurant-ui.js'),'gate deve carregar antes de restaurant-ui.js');
});

test('modulo desligado sai pela navegacao canonica sem interceptar clicks',()=>{
  const gate=fs.readFileSync(path.join(root,'desktop/renderer/restaurant-module-gate.js'),'utf8');
  const app=fs.readFileSync(path.join(root,'desktop/renderer/app.js'),'utf8');
  assert.doesNotMatch(gate,/stopImmediatePropagation\(\)|data-module-open|data-module-nav/);
  assert.match(gate,/isEnabled/);
  assert.match(app,/artisys:modules-state-changed/);
  assert.match(app,/state\.route==='FOOD'\|\|state\.route==='WHOLESALE'/);
  assert.match(app,/void navigate\('home'\)/);
  assert.doesNotMatch(gate,/showRoute\?\.\('settings'\)/);
});
