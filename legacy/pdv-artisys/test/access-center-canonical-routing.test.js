'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

test('Access Center stays on canonical route and lifecycle contracts without DOM observers',()=>{
  const ui=fs.readFileSync(path.join(root,'desktop/renderer/access-center-ui.js'),'utf8');
  assert.doesNotMatch(ui,/MutationObserver/);
  assert.match(ui,/PdvRouteRegistry/);
  assert.match(ui,/registry\.register\(['"]access['"]/);
  assert.match(ui,/registry\.updated\(['"]access['"]/);
  assert.match(ui,/data-access-tab/);
  assert.match(ui,/data-user-id/);
  assert.match(ui,/data-profile-id/);
});
