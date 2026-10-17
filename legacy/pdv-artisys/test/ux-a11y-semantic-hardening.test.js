'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const flow=()=>JSON.parse(read('qa/flows/all-pages-audit.json'));

test('P1 accessibility gate proves keyboard, focus restoration, accessible names, contrast and 200% zoom',()=>{
  const steps=flow().steps;
  const names=new Set(steps.map(step=>step.name));
  for(const name of [
    'a11y-relatorios-gestao-foco',
    'a11y-relatorios-gestao-foco-confirmado',
    'a11y-relatorios-gestao-nome-acessivel',
    'a11y-relatorios-gestao-teclado',
    'a11y-relatorios-voltar-teclado',
    'a11y-relatorios-modal-foco-restaurado',
    'a11y-relatorios-contraste',
    'a11y-relatorios-zoom-200-sem-overflow'
  ]) assert.equal(names.has(name),true,name);

  const zoom=steps.find(step=>step.name==='a11y-relatorios-zoom-200');
  const reset=steps.find(step=>step.name==='a11y-relatorios-zoom-reset');
  assert.equal(zoom?.action,'setZoomFactor');
  assert.equal(zoom?.factor,2);
  assert.equal(reset?.action,'setZoomFactor');
  assert.equal(reset?.factor,1);
});

test('QA runtime has first-class accessibility assertions and native Electron zoom',()=>{
  const runtime=read('qa/runtime/src/steps.js');
  const runner=read('qa/runtime/src/runner.js');
  for(const action of ['focus','expectFocused','expectAccessibleName','expectMinimumContrast','setZoomFactor']) {
    assert.match(runtime,new RegExp(`case ['"]${action}['"]`),action);
  }
  assert.match(runtime,/electronApp/);
  assert.match(runtime,/setZoomFactor/);
  assert.match(runner,/electronApp/);
  assert.match(runner,/executeStep\([\s\S]*electronApp/);
});

test('Reports returns to management through semantic application navigation only',()=>{
  const source=read('desktop/renderer/reporting-v2.js');
  const start=source.indexOf('function navigateManagement');
  const end=source.indexOf('\n  function ',start+1);
  const body=source.slice(start,end>start?end:source.length);
  assert.match(body,/PdvAppNavigation\?\.navigate\?\.\('management'\)/);
  assert.doesNotMatch(body,/\.click\s*\(/);
  assert.doesNotMatch(body,/setTimeout\s*\(/);
});

test('Finance never exposes reconciliation enum values in customer-facing batch details',()=>{
  const source=read('desktop/renderer/erp-finance-operations-ui.js');
  assert.match(source,/function statementStatusLabel|const statementStatusLabel/);
  assert.match(source,/UNMATCHED\s*:\s*['"]Pendente['"]/);
  assert.match(source,/statementStatusLabel\(tx\.matchStatus\)/);
  assert.doesNotMatch(source,/esc\(tx\.matchStatus\s*\|\|\s*['"]UNMATCHED['"]\)/);
});

test('Async loaders expose one consistent polite status contract',()=>{
  for(const file of ['desktop/renderer/vertical-modules.js','desktop/renderer/post-sale-receipt-ui.js']){
    const source=read(file);
    const loaders=[...source.matchAll(/<div class=["']ops-loader["'][^>]*>/g)].map(match=>match[0]);
    assert.ok(loaders.length>0,`${file} must render at least one loader`);
    for(const markup of loaders){
      assert.match(markup,/role=["']status["']/,`${file}: ${markup}`);
      assert.match(markup,/aria-live=["']polite["']/,`${file}: ${markup}`);
      assert.match(markup,/aria-busy=["']true["']/,`${file}: ${markup}`);
    }
  }
});
