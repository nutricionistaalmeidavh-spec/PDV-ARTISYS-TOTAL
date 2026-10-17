'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('checkout document locator exposes quick filter chips',()=>{
  const app=read('desktop/renderer/app.js');

  assert.match(app,/data-checkout-document-filter=""[^>]*>Todos</);
  assert.match(app,/data-checkout-document-filter="comanda"[^>]*>Comandas</);
  assert.match(app,/data-checkout-document-filter="atacado"[^>]*>Atacado</);
  assert.match(app,/aria-pressed="true"/);
  assert.match(app,/query=\[activeFilter,input\.value\]/);
  assert.match(app,/data-checkout-document-filter/);
});

test('checkout document quick filters use compact chip styling',()=>{
  const css=read('desktop/renderer/styles.css');

  assert.match(css,/\.checkout-document-filters\s*\{/);
  assert.match(css,/\.checkout-document-filter\s*\{/);
  assert.match(css,/\.checkout-document-filter\[aria-pressed="true"\]/);
});
