'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('generic catalog calls products Produtos instead of Cardápio',()=>{
  const app=read('desktop/renderer/app.js');
  const products=read('desktop/renderer/products-dense-view.js');
  assert.match(app,/products:\s*\{\s*label:\s*'Produtos'/);
  assert.match(app,/route:'products',label:'Produtos'/);
  assert.match(products,/ariaLabel:'Produtos'/);
  assert.match(products,/<h1>Produtos<\/h1>/);
  assert.doesNotMatch(products,/<h1>Cardápio<\/h1>/);
});

test('desktop exposes the commercial package version instead of the Electron runtime version',()=>{
  const main=read('desktop/main.cjs');
  assert.match(main,/require\(['"]\.\.\/package\.json['"]\)/);
  assert.match(main,/appVersion:\s*productVersion/);
  assert.match(main,/serverVersion:\s*productVersion/);
  assert.match(main,/version:\s*productVersion/);
});

test('QA desktop API assertions can verify durable response state',()=>{
  const steps=read('qa/runtime/src/steps.js');
  assert.match(steps,/expectedPayloadIncludes/);
  assert.match(steps,/JSON\.stringify\(result\?\.payload/);
});

test('all-pages QA confirms a checkout-origin order reaches durable fulfilled state',()=>{
  const flow=JSON.parse(read('qa/flows/all-pages-audit.json'));
  const names=new Set(flow.steps.map(step=>step.name));
  for(const name of [
    'pedido-finalizar-venda',
    'pedido-abrir-caixa-se-necessario',
    'pedido-confirmar-pagamento',
    'pedido-venda-finalizada',
    'pedido-status-fulfill-persistido'
  ]) assert.equal(names.has(name),true,name);
  const durable=flow.steps.find(step=>step.name==='pedido-status-fulfill-persistido');
  assert.equal(durable?.action,'desktopApiRequest');
  assert.equal(durable?.path,'/api/v1/wholesale/orders/qa-order-1');
  assert.match(String(durable?.expectedPayloadIncludes||''),/FULFILLED/);
});

test('all-pages QA traverses DRE, all Financeiro subareas and Relatórios',()=>{
  const flow=JSON.parse(read('qa/flows/all-pages-audit.json'));
  const names=new Set(flow.steps.map(step=>step.name));
  for(const name of [
    'gestao-abrir-dre',
    'gestao-dre-visivel',
    'gestao-abrir-financeiro',
    'financeiro-lancamentos-visivel',
    'financeiro-bancos',
    'financeiro-recorrencias',
    'financeiro-alertas',
    'gestao-abrir-relatorios',
    'relatorios-visivel'
  ]) assert.equal(names.has(name),true,name);
});


test('all-pages QA completes a real return and confirms it durably',()=>{
  const flow=JSON.parse(read('qa/flows/all-pages-audit.json'));
  const names=new Set(flow.steps.map(step=>step.name));
  for(const name of [
    'devolucao-venda-concluida-selecionada',
    'devolucao-item-selecionado',
    'devolucao-motivo-preenchido',
    'devolucao-confirmada',
    'devolucao-status-concluido',
    'devolucao-persistida'
  ]) assert.equal(names.has(name),true,name);
  const durable=flow.steps.find(step=>step.name==='devolucao-persistida');
  assert.equal(durable?.action,'desktopApiRequest');
  assert.equal(durable?.path,'/api/v1/returns');
  assert.match(String(durable?.expectedPayloadIncludes||''),/Devolução QA/);
});


test('all-pages QA verifies destructive sale cancellation before confirming durable state',()=>{
  const flow=JSON.parse(read('qa/flows/all-pages-audit.json'));
  const names=new Set(flow.steps.map(step=>step.name));
  for(const name of [
    'cancelamento-venda-iniciada',
    'cancelamento-confirmacao-visivel',
    'cancelamento-confirmado',
    'cancelamento-feedback',
    'cancelamento-persistido'
  ]) assert.equal(names.has(name),true,name);
  const durable=flow.steps.find(step=>step.name==='cancelamento-persistido');
  assert.equal(durable?.path,'/api/v1/sales?status=CANCELLED');
  assert.match(String(durable?.expectedPayloadIncludes||''),/CANCELLED/);
});
