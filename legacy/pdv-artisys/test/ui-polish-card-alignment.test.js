'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('workflow cards reset inherited grid placement and keep comfortable text breathing room',()=>{
  const css=read('desktop/renderer/classic-home-ui.css');
  assert.match(css,/\.flow-hub-grid \.home-tile\s*\{[^}]*grid-column:auto[^}]*min-width:0[^}]*min-height:120px[^}]*padding:18px 20px 17px/s);
  assert.match(css,/\.flow-hub-grid \.home-tile p\s*\{[^}]*line-height:1\.4[^}]*overflow-wrap:anywhere/s);
  assert.match(css,/flow-hub-page\[data-flow-hub="Cadastros"\] \.home-tile\s*\{[^}]*min-height:112px[^}]*padding:16px 18px 15px/s);
});

test('settings cards and switches keep copy away from edges and controls aligned',()=>{
  const css=read('desktop/renderer/settings-hub-ui.css');
  assert.match(css,/\.settings-hub-nav button\s*\{[^}]*min-height:80px[^}]*padding:14px 16px/s);
  assert.match(css,/\.settings-hub-nav span,\.settings-hub-current\s*\{[^}]*line-height:1\.35/s);
  assert.match(css,/\.module-family\s*\{[^}]*padding:16px 18px/s);
  assert.match(css,/\.vertical-toggle\s*\{[^}]*min-height:64px[^}]*padding:12px 2px[^}]*gap:18px[^}]*align-items:center/s);
  assert.match(css,/\.vertical-toggle input\[role="switch"\]\s*\{[^}]*margin:0[^}]*align-self:center/s);
  assert.match(css,/module-family\[data-module-config\]>\.vertical-rule\s*\{[^}]*line-height:1\.4[^}]*white-space:normal[^}]*overflow-wrap:anywhere/s);
});

test('access checkboxes align consistently with labels and descriptions',()=>{
  const css=read('desktop/renderer/access-center-ui.css');
  assert.match(css,/\.access-permission-row\s*\{[^}]*grid-template-columns:\s*20px minmax\(0,1fr\)[^}]*gap:\s*12px[^}]*padding:\s*12px 14px/s);
  assert.match(css,/\.access-permission-row input\s*\{[^}]*width:\s*18px[^}]*height:\s*18px[^}]*margin:\s*1px 0 0/s);
  assert.match(css,/\.access-toggle-row\s*\{[^}]*grid-template-columns:\s*20px minmax\(0,1fr\)[^}]*gap:\s*12px[^}]*align-items:\s*center[^}]*padding:\s*14px/s);
  assert.match(css,/\.access-toggle-row input\s*\{[^}]*width:\s*18px[^}]*height:\s*18px[^}]*margin:\s*0/s);
});
