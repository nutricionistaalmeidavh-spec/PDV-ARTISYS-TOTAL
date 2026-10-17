'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPdvRuntime } = require('../js/core/pdv-runtime');

const actor = { userId:'admin', profileId:'profile-administrator', terminalId:'PDV-01' };

function fixture() {
  let seq = 0;
  const runtime = createPdvRuntime({
    now:()=>`2026-10-01T12:00:${String(seq++ % 60).padStart(2,'0')}Z`,
    idFactory:prefix=>`${prefix}-${seq++}`
  });
  runtime.catalog.createUser({ id:'admin', username:'admin', name:'Administrador', profileId:'profile-administrator', password:'senha-forte-123', active:true });
  runtime.catalog.upsertCategory({ id:'food', name:'Alimentos' }, actor);
  runtime.catalog.upsertProduct({ id:'meal', sku:'MEAL', name:'Prato pronto', salePriceCents:1000, costCents:300, trackStock:false, minimumStock:0, categoryId:'food' }, actor);
  runtime.catalog.upsertProduct({ id:'ingredient', sku:'ING', name:'Ingrediente', salePriceCents:100, costCents:100, trackStock:true, minimumStock:0, categoryId:'food' }, actor);
  runtime.inventory.move({ productId:'ingredient', type:'opening', quantityDelta:10, reason:'saldo inicial', actor });
  runtime.recipes.setRecipe('meal', { components:[{ productId:'ingredient', quantity:2, unit:'UN' }] }, actor);
  return runtime;
}

function openDiscountedSale(runtime, cashSessionId='cash-A') {
  const cash = runtime.cash.openSession({ id:cashSessionId, terminalId:'PDV-01', operatorId:'admin', initialCashCents:0, actor });
  const sale = runtime.sales.openSale({ id:`sale-${cashSessionId}`, saleNumber:`S-${cashSessionId}`, terminalId:'PDV-01', operatorId:'admin' }, actor);
  runtime.sales.addItem(sale.id, { productId:'meal', quantity:1 });
  runtime.sales.applyDiscount(sale.id, { discountCents:200 });
  const completed = runtime.sales.completeSale(sale.id, { payments:[{ method:'CASH', amountCents:800 }], actor });
  return { cash, sale:completed };
}

function saleCompletedPayload(runtime, saleId) {
  const row = runtime.db.prepare("SELECT payload_json AS payloadJson FROM domain_events WHERE aggregate_id=? AND type='sale.completed' ORDER BY occurred_at DESC LIMIT 1").get(saleId);
  return row ? JSON.parse(row.payloadJson) : null;
}

test('runtime rejects sale completion when no cash session is open', () => {
  const runtime = fixture();
  try {
    const sale = runtime.sales.openSale({ id:'sale-no-cash', terminalId:'PDV-01', operatorId:'admin' }, actor);
    runtime.sales.addItem(sale.id, { productId:'meal', quantity:1 });
    assert.throws(
      () => runtime.sales.completeSale(sale.id, { payments:[{ method:'CASH', amountCents:1000 }], actor }),
      /caixa.*aberto/i
    );
  } finally { runtime.close(); }
});

test('sale freezes cash session, net item value and recipe stock requirements before async dispatch', async () => {
  const runtime = fixture();
  try {
    const { cash, sale } = openDiscountedSale(runtime);
    assert.equal(sale.cashSessionId, cash.id);
    assert.equal(sale.items[0].allocatedDiscountCents, 200);
    assert.equal(sale.items[0].netTotalCents, 800);

    const payload = saleCompletedPayload(runtime, sale.id);
    assert.equal(payload.cashSessionId, cash.id);
    assert.deepEqual(payload.items[0].stockItems, [{ productId:'ingredient', quantity:2 }]);

    runtime.cash.closeSession(cash.id, { countedByMethod:{ CASH:0 }, actor });
    const laterCash = runtime.cash.openSession({ id:'cash-B', terminalId:'PDV-01', operatorId:'admin', initialCashCents:0, actor });
    runtime.recipes.setRecipe('meal', { components:[{ productId:'ingredient', quantity:3, unit:'UN' }] }, actor);

    const dispatch = await runtime.dispatchPending();
    assert.equal(dispatch.failed, 0);
    assert.equal(runtime.inventory.getBalance('ingredient'), 8);
    assert.equal(runtime.cash.listSessionMovements(cash.id).filter(item=>item.type==='SALE'&&item.saleId===sale.id).length, 1);
    assert.equal(runtime.cash.listSessionMovements(laterCash.id).filter(item=>item.type==='SALE'&&item.saleId===sale.id).length, 0);
  } finally { runtime.close(); }
});

test('return uses original net value, original stock snapshot and its own immutable cash session', async () => {
  const runtime = fixture();
  try {
    const { cash:saleCash, sale } = openDiscountedSale(runtime, 'cash-sale');
    let dispatch = await runtime.dispatchPending();
    assert.equal(dispatch.failed, 0);
    assert.equal(runtime.inventory.getBalance('ingredient'), 8);

    runtime.cash.closeSession(saleCash.id, { countedByMethod:{ CASH:800 }, actor });
    const returnCash = runtime.cash.openSession({ id:'cash-return', terminalId:'PDV-01', operatorId:'admin', initialCashCents:0, actor });
    runtime.recipes.setRecipe('meal', { components:[{ productId:'ingredient', quantity:4, unit:'UN' }] }, actor);

    const created = runtime.returns.createReturn({
      saleId:sale.id,
      terminalId:'PDV-01',
      operatorId:'admin',
      reason:'devolucao integral',
      items:[{ saleItemId:sale.items[0].id, quantity:1 }],
      refunds:[{ method:'CASH', amountCents:800 }],
      actor,
      authorizedBy:actor
    });
    assert.equal(created.totalCents, 800);
    assert.equal(created.cashSessionId, returnCash.id);

    runtime.cash.closeSession(returnCash.id, { countedByMethod:{ CASH:0 }, actor });
    const laterCash = runtime.cash.openSession({ id:'cash-after-return', terminalId:'PDV-01', operatorId:'admin', initialCashCents:0, actor });
    dispatch = await runtime.dispatchPending();
    assert.equal(dispatch.failed, 0);
    assert.equal(runtime.inventory.getBalance('ingredient'), 10);
    assert.equal(runtime.cash.listSessionMovements(returnCash.id).filter(item=>item.type==='REVERSAL'&&item.returnId===created.id).length, 1);
    assert.equal(runtime.cash.listSessionMovements(laterCash.id).filter(item=>item.type==='REVERSAL'&&item.returnId===created.id).length, 0);
  } finally { runtime.close(); }
});
