'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPdvRuntime } = require('../js/core/pdv-runtime');

function seed(runtime) {
  runtime.catalog.createUser({id:'mgr',username:'gerente',name:'Gerente',profileId:'profile-manager',password:'senha-gerente-123'},{kind:'system',id:'system'});
  runtime.catalog.upsertCategory({ id:'cat1', name:'Geral' });
  runtime.catalog.upsertProduct({ id:'p1', sku:'SKU-1', name:'Produto A', salePriceCents:1000, costCents:500, trackStock:true, minimumStock:1 });
  runtime.inventory.move({ productId:'p1', type:'opening', quantityDelta:5, reason:'saldo inicial' });
}

function cashActor() { return { userId:'mgr', profileId:'profile-manager', terminalId:'PDV-01' }; }
function cashierActor() { return { userId:'cashier1', profileId:'profile-cashier', terminalId:'PDV-01' }; }

async function completeSale(runtime) {
  runtime.cash.openSession({ terminalId:'PDV-01', operatorId:'mgr', initialCashCents:0, actor:cashActor() });
  const sale = runtime.sales.openSale({ id:'sale1', saleNumber:'S-001', terminalId:'PDV-01', operatorId:'mgr' }, cashActor());
  runtime.sales.addItem(sale.id, { productId:'p1', quantity:2 });
  runtime.sales.completeSale(sale.id, { payments:[{ method:'CASH', amountCents:2000 }], actor:cashActor() });
  const dispatch = await runtime.dispatchPending();
  assert.equal(dispatch.failed, 0);
  return runtime.sales.getSale(sale.id);
}

test('sales history filters completed sales and exposes immutable detailed original', async () => {
  let seq = 0;
  const runtime = createPdvRuntime({ now:()=>`2026-09-09T12:00:${String(seq++).padStart(2,'0')}Z`, idFactory:p=>`${p}-${seq++}` });
  seed(runtime);
  await completeSale(runtime);

  const history = runtime.sales.listHistory({ status:'COMPLETED', query:'S-001' });
  assert.equal(history.length, 1);
  assert.equal(history[0].saleNumber, 'S-001');
  assert.equal(history[0].totalCents, 2000);
  const details = runtime.sales.getSaleDetails('sale1');
  assert.equal(details.items.length, 1);
  assert.equal(details.payments[0].amountCents, 2000);
  assert.equal(details.status, 'COMPLETED');
  runtime.close();
});

test('partial returns preserve original sale and restore stock/cash once per return', async () => {
  let seq = 0;
  const runtime = createPdvRuntime({ now:()=>`2026-09-09T13:00:${String(seq++).padStart(2,'0')}Z`, idFactory:p=>`${p}-${seq++}` });
  seed(runtime);
  const sale = await completeSale(runtime);
  const saleItemId = sale.items[0].id;
  assert.equal(runtime.inventory.getBalance('p1'), 3);

  const first = runtime.returns.createReturn({
    saleId:'sale1', terminalId:'PDV-01', operatorId:'mgr', reason:'Cliente desistiu de uma unidade',
    items:[{ saleItemId, quantity:1 }], refunds:[{ method:'CASH', amountCents:1000 }], actor:cashActor()
  });
  assert.equal(first.totalCents, 1000);
  assert.equal(first.status, 'COMPLETED');
  assert.equal(first.authorizedById, 'mgr');
  assert.equal(runtime.sales.getSale('sale1').status, 'COMPLETED');
  let dispatch = await runtime.dispatchPending();
  assert.equal(dispatch.failed, 0);
  assert.equal(runtime.inventory.getBalance('p1'), 4);

  const firstReversals = runtime.cash.listSessionMovements(runtime.cash.getOpenSession('PDV-01').id)
    .filter(m => m.type === 'REVERSAL' && m.returnId === first.id);
  assert.equal(firstReversals.length, 1);
  assert.equal(firstReversals[0].amountCents, 1000);

  await runtime.dispatchPending();
  assert.equal(runtime.inventory.getBalance('p1'), 4);
  assert.equal(runtime.cash.listSessionMovements(runtime.cash.getOpenSession('PDV-01').id)
    .filter(m => m.type === 'REVERSAL' && m.returnId === first.id).length, 1);

  assert.throws(() => runtime.returns.createReturn({
    saleId:'sale1', terminalId:'PDV-01', operatorId:'mgr', reason:'Tentativa acima do vendido',
    items:[{ saleItemId, quantity:2 }], refunds:[{ method:'CASH', amountCents:2000 }], actor:cashActor()
  }), /quantidade.*devolv/i);

  const second = runtime.returns.createReturn({
    saleId:'sale1', terminalId:'PDV-01', operatorId:'mgr', reason:'Devolucao da unidade restante',
    items:[{ saleItemId, quantity:1 }], refunds:[{ method:'CASH', amountCents:1000 }], actor:cashActor()
  });
  dispatch = await runtime.dispatchPending();
  assert.equal(dispatch.failed, 0);
  assert.equal(runtime.inventory.getBalance('p1'), 5);
  assert.equal(runtime.cash.listSessionMovements(runtime.cash.getOpenSession('PDV-01').id)
    .filter(m => m.type === 'REVERSAL' && [first.id, second.id].includes(m.returnId)).length, 2);
  assert.equal(runtime.returns.listReturns({ saleId:'sale1' }).length, 2);
  runtime.close();
});

test('return persists cashier operator separately from delegated manager authorizer', async () => {
  const runtime = createPdvRuntime();
  seed(runtime);
  runtime.catalog.createUser({ id:'cashier1', username:'caixa', name:'Caixa', profileId:'profile-cashier', password:'senha-forte-123' });
  const sale = await completeSale(runtime);
  const created = runtime.returns.createReturn({
    saleId:sale.id,
    terminalId:'PDV-01',
    operatorId:'cashier1',
    reason:'Teste autorizado',
    items:[{ saleItemId:sale.items[0].id, quantity:1 }],
    refunds:[{ method:'CASH', amountCents:1000 }],
    actor:cashierActor(),
    authorizedBy:{ userId:'mgr', profileId:'profile-manager', name:'Gerente' }
  });
  assert.equal(created.operatorId, 'cashier1');
  assert.equal(created.authorizedById, 'mgr');
  assert.equal(runtime.sales.getSale(sale.id).status, 'COMPLETED');
  runtime.close();
});

test('return rejects delegated authorization from a non-manager role', async () => {
  const runtime = createPdvRuntime();
  seed(runtime);
  runtime.catalog.createUser({ id:'cashier1', username:'caixa', name:'Caixa', profileId:'profile-cashier', password:'senha-forte-123' });
  const sale = await completeSale(runtime);
  runtime.catalog.createUser({ id:'cashier2', username:'caixa2', name:'Outro caixa', profileId:'profile-cashier', password:'senha-caixa2-123' },{kind:'system',id:'system'});
  assert.throws(() => runtime.returns.createReturn({
    saleId:sale.id,
    terminalId:'PDV-01',
    operatorId:'cashier1',
    reason:'Tentativa sem gerente',
    items:[{ saleItemId:sale.items[0].id, quantity:1 }],
    refunds:[{ method:'CASH', amountCents:1000 }],
    actor:cashierActor(),
    authorizedBy:{ userId:'cashier2', profileId:'profile-cashier', name:'Outro caixa' }
  }), /permiss|autoriza/i);
  runtime.close();
});
