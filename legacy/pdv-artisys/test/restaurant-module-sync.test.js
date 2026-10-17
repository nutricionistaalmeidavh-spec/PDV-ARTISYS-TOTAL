'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

test('module gate reconciles every optional module changed by another client',()=>{
  const gate=read('desktop/renderer/restaurant-module-gate.js');
  assert.match(gate,/PdvModuleGate/);
  assert.match(gate,/MODULE_SETTING_PATTERN|modules\.\(\[A-Z_\]\+\)\.enabled/);
  assert.match(gate,/new Map\(|moduleStates/);
  assert.doesNotMatch(gate,/\[data-module-open|\[data-module-nav/);
  assert.match(gate,/artisys:modules-state-changed/);
  assert.match(gate,/CustomEvent/);
  assert.match(gate,/addEventListener\(['"]focus['"][\s\S]*refresh\(/);
  assert.match(gate,/visibilitychange[\s\S]*refresh\(/);
  assert.match(gate,/setInterval[\s\S]*refresh\(/);
  assert.match(gate,/let refreshInFlight=null/);
  assert.match(gate,/if\(refreshInFlight\)return refreshInFlight/);
});

test('generic gate publishes the canonical catalog without a restaurant-only alias or fabricated fallback',()=>{
  const gate=read('desktop/renderer/restaurant-module-gate.js');
  assert.doesNotMatch(gate,/PdvRestaurantModuleGate/);
  assert.doesNotMatch(gate,/data-restaurant-route/);
  assert.match(gate,/isEnabled/);
  assert.match(gate,/snapshot/);
  assert.match(gate,/setEnabled/);
  assert.match(gate,/catalog:.*moduleCatalog/);
  assert.match(gate,/moduleCatalog\.map\(module=>\(\{\.\.\.module\}\)\)/);
  assert.doesNotMatch(gate,/stopImmediatePropagation\(\)|applyLauncherState/);
  assert.match(gate,/never fabricates module state/);
});
