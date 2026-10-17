'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('P3 shell surfaces use semantic lifecycle without DOM observers',()=>{
  const files=[
    'desktop/renderer/classic-home-ui.js',
    'desktop/renderer/route-scroll-ui.js',
    'desktop/renderer/first-access-ui.js',
    'desktop/renderer/sale-observation-ui.js'
  ];
  for(const file of files){
    const source=read(file);
    assert.match(source,/PdvUiLifecycle/,`${file}: lifecycle required`);
    assert.doesNotMatch(source,/new MutationObserver\b/,`${file}: DOM observer retired in P3`);
  }
  assert.match(read('desktop/renderer/classic-home-ui.js'),/user:changed/);
  assert.match(read('desktop/renderer/route-scroll-ui.js'),/route:before/);
  assert.match(read('desktop/renderer/route-scroll-ui.js'),/route:mounted/);
  assert.match(read('desktop/renderer/first-access-ui.js'),/auth:rendered/);
  assert.match(read('desktop/renderer/sale-observation-ui.js'),/surface === 'sale-detail'/);
});

test('P4 Settings admin extension uses route lifecycle and publishes semantic updates',()=>{
  const source=read('desktop/renderer/admin-ops.js');
  assert.match(source,/PdvUiLifecycle/,'admin-ops lifecycle required');
  assert.match(source,/route:mounted/,'admin-ops route mounted hook required');
  assert.match(source,/route:updated/,'admin-ops route updated hook required');
  assert.doesNotMatch(source,/new MutationObserver\b/,'admin-ops DOM observer retired in P4');
  assert.ok(source.includes("extension:'admin-ops'"),'admin-ops semantic settings update required');
});
test('Settings Hub has no compatibility MutationObserver after P4',()=>{
  const source=read('desktop/renderer/settings-hub-ui.js');
  assert.match(source,/PdvUiLifecycle/);
  assert.doesNotMatch(source,/MutationObserver|legacyObserver/);
});

test('app and sales history publish semantic auth user and sale-detail signals',()=>{
  const app=read('desktop/renderer/app.js');
  const operational=read('desktop/renderer/operational-pages.js');
  assert.match(app,/user:changed/);
  assert.match(app,/auth:rendered/);
  assert.match(app,/auth:hidden/);
  assert.match(operational,/routeRegistry\.updated\('sales',\{surface:'sale-detail'\}\)/);
});
