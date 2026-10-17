'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('renderer production code contains zero DOM mutation observers',()=>{
  const rendererDir=path.join(root,'desktop/renderer');
  const offenders=[];
  for(const file of fs.readdirSync(rendererDir).filter(name=>name.endsWith('.js'))){
    const source=fs.readFileSync(path.join(rendererDir,file),'utf8');
    const count=(source.match(/new\s+MutationObserver\b/g)||[]).length;
    if(count)offenders.push(file+':'+count);
  }
  assert.deepEqual(offenders,[]);
});

test('Home is rendered canonically by app without a hidden native Home bridge',()=>{
  const app=read('desktop/renderer/app.js');
  const shell=read('desktop/renderer/classic-home-ui.js');
  assert.match(app,/function renderHome\(\)[\s\S]*id="classic-home-grid"/);
  assert.match(app,/homeForUser/);
  assert.doesNotMatch(shell,/baseHome\s*=|nativeHome|\.home-grid:not\(#classic-home-grid\)|nativeLauncher/);
  assert.match(shell,/PdvAppNavigation/);
});

test('retired parity and reporting bridges are absent from source and entrypoint',()=>{
  const retired=[
    'desktop/renderer/backend-parity-ui.js',
    'desktop/renderer/ui-parity-p0-p2.js',
    'desktop/renderer/reporting-v2-legacy-export.js'
  ];
  for(const relative of retired)assert.equal(fs.existsSync(path.join(root,relative)),false,relative);
  const index=read('desktop/renderer/index.html');
  for(const relative of retired)assert.equal(index.includes(path.basename(relative)),false,relative);
  assert.match(index,/operational-route-extensions\.js/);
  assert.match(index,/operational-detail-extensions\.js/);
});

test('migrated operational components are composed by canonical owners',()=>{
  const route=read('desktop/renderer/operational-route-extensions.js');
  const detail=read('desktop/renderer/operational-detail-extensions.js');
  const operational=read('desktop/renderer/operational-pages.js');
  const returnsUi=read('desktop/renderer/returns-ui.js');
  assert.doesNotMatch(route,/MutationObserver|lifecycle\?*\.on\(['"]route:/);
  assert.doesNotMatch(detail,/MutationObserver|lifecycle\?*\.on\(['"]route:/);
  assert.match(operational,/PdvOperationalRouteExtensions\?\.mountRoute/);
  assert.match(operational,/PdvOperationalDetailExtensions\?\.mountSettings/);
  assert.match(returnsUi,/PdvOperationalRouteExtensions\?\.mountReturns/);
  assert.match(returnsUi,/PdvOperationalDetailExtensions\?\.mountReturns/);
});

test('report export and toast behavior no longer require legacy bridges',()=>{
  const reporting=read('desktop/renderer/reporting-v2.js');
  const toast=read('desktop/renderer/toast-ui.js');
  assert.match(reporting,/exportSalesCsv/);
  assert.match(reporting,/downloadCsvText/);
  assert.doesNotMatch(toast,/installLegacyAppendBridge|appendChild\s*=\s*function\s+appendManagedToast/);
  assert.match(toast,/window\.PdvToast|PdvToast/);
});
