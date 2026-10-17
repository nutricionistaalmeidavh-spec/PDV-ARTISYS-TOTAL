'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('waiter direction A keeps the canonical mobile route and restaurant APIs',()=>{
  const index=read('server/mobile/index.html');
  const app=read('server/mobile/app.js');
  const router=read('server/restaurant-router.js');

  assert.match(index,/\/mobile\/app\.js/);
  assert.match(app,/request\('\/api\/v1\/mobile\/context'\)/);
  assert.match(app,/\/api\/v1\/mobile\/tables\/\$\{encodeURIComponent\(selected\.id\)\}\/open/);
  assert.match(app,/endpoint='\/api\/v1\/mobile\/orders'/);
  assert.match(app,/\/api\/v1\/mobile\/requests\/\$\{encodeURIComponent\(button\.dataset\.request\)\}/);

  assert.match(router,/pathname==='\/api\/v1\/mobile\/context'/);
  assert.match(router,/pathname==='\/api\/v1\/mobile\/orders'/);
  assert.doesNotMatch(app,/\/api\/v2\/waiter/);
  assert.doesNotMatch(router,/\/api\/v2\/waiter/);
});

test('waiter direction A reuses the canonical order composer and production states',()=>{
  const app=read('server/mobile/app.js');
  assert.match(app,/window\.PdvOrderComposer/);
  assert.match(app,/cart\.toOrderItems\(\)/);
  assert.match(app,/productionStatus==='READY'/);
  assert.match(app,/productionStatus==='PREPARING'/);
  assert.match(app,/data-waiter-direction="a"/);
  assert.match(app,/data-waiter-table/);
  assert.match(app,/id="waiter-cart-toggle"/);
  assert.match(app,/class="waiter-cart-sheet/);
});

test('waiter direction A QA proves floor, order sheet, canonical order and KDS return',()=>{
  const flow=JSON.parse(read('qa/flows/all-pages-audit.json'));
  const names=new Set(flow.steps.map(step=>step.name));
  for(const name of [
    'garcom-direcao-a',
    'garcom-salao-visual',
    'garcom-abrir-mesa-ocupada',
    'garcom-pedido-resumo-fixo',
    'garcom-enviar-pedido-disponivel',
    'garcom-registrar-pedido-misto',
    'kds-ticket-em-preparo',
    'kds-ticket-pronto',
    'garcom-mesa-pronta-no-salao',
    'garcom-ve-pedido-pronto'
  ]) assert.equal(names.has(name),true,name);
});
