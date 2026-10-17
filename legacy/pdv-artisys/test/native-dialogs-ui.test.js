'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const rendererRoot=path.join(__dirname,'../desktop/renderer');
const app=fs.readFileSync(path.join(rendererRoot,'app.js'),'utf8');
const reports=fs.readFileSync(path.join(rendererRoot,'reporting-v2.js'),'utf8');

test('desktop renderer input flows do not use native prompt or confirm dialogs',()=>{
  assert.doesNotMatch(app,/\b(?:window\.|root\.)?prompt\s*\(/);
  assert.doesNotMatch(app,/\b(?:window\.|root\.)?confirm\s*\(/);
  assert.doesNotMatch(reports,/\b(?:window\.|root\.)?prompt\s*\(/);
  assert.doesNotMatch(reports,/\b(?:window\.|root\.)?confirm\s*\(/);
});

test('commission payment uses the shared in-app modal with value and note fields',()=>{
  assert.match(app,/window\.PdvModal\s*=\s*Object\.freeze/);
  assert.match(reports,/const modal = root\.PdvModal/);
  assert.match(reports,/id="commission-payment-form"/);
  assert.match(reports,/name="amount"/);
  assert.match(reports,/name="note"/);
});

test('product destructive actions use in-app confirmation modals',()=>{
  assert.match(app,/openModal\('Inativar produto do Estoque'/);
  assert.match(app,/id="confirm-remove-product"/);
  assert.match(app,/openModal\('Remover foto do produto'/);
  assert.match(app,/id="confirm-remove-product-photo"/);
});
