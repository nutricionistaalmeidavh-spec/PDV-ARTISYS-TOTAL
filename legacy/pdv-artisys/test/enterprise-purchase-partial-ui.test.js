'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../desktop/renderer/enterprise-depth-ui.js'),'utf8');
test('purchase receiving exposes per-item partial quantities before posting receipt',()=>{
  assert.match(source,/receive-po/);
  assert.match(source,/data-purchase-receive-form/);
  assert.match(source,/data-purchase-receive-qty/);
  assert.match(source,/Receber quantidades/);
  assert.match(source,/receivePurchaseOrder\(order\.id,\{items\}\)/);
});
