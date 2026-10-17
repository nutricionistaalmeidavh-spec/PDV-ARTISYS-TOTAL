'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

test('workspace sync consumes module route identity instead of localized heading maps',()=>{
  const source=read('desktop/renderer/module-state-sync.js');
  assert.match(source,/artisys:modules-state-changed/);
  assert.match(source,/data-module-workspace/);
  assert.match(source,/PdvUiLifecycle/);
  assert.match(source,/surface:mounted/);
  assert.doesNotMatch(source,/MutationObserver/);
  assert.match(source,/activeModuleWorkspace/);
  assert.doesNotMatch(source,/routeRegistry\.render\('settings'\)|reloadSettingsModules/);
  assert.doesNotMatch(source,/MODULE_HEADINGS|HEADING_TO_ID|data-module-toggle=/);
  assert.doesNotMatch(source,/data-module-open="\$\{id\}"/);
});

test('module state sync loads after vertical renderers',()=>{
  const html=read('desktop/renderer/index.html');
  const sync=html.indexOf('./module-state-sync.js');
  assert.ok(sync>html.indexOf('./vertical-modules.js'));
  assert.ok(sync>html.indexOf('./e48-e54-ui.js'));
});
