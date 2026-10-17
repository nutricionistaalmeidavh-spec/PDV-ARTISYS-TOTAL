'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPdvRuntime } = require('../js/core/pdv-runtime');

const NOW = '2026-09-10T12:00:00.000Z';
const manager = { userId:'u1', profileId:'profile-manager', terminalId:'T1' };

function setup({ quantity = 1, costCents = 600 } = {}) {
  let seq = 0;
  const runtime = createPdvRuntime({ now: () => NOW, idFactory: prefix => `${prefix}-${++seq}` });
  runtime.catalog.upsertCategory({ id:'c1', name:'Geral' }, manager);
  runtime.catalog.createUser({ id:'u1', username:'gerente', name:'Gerente', profileId:'profile-manager', password:'senha-forte' }, manager);
  runtime.catalog.upsertProduct({ id:'p1', name:'Produto', categoryId:'c1', unit:'UN', salePriceCents:1000, costCents, trackStock:true, minimumStock:0, active:true }, manager);
  runtime.inventory.move({ productId:'p1', type:'purchase', quantityDelta:10, reason:'Carga inicial' }, manager);
  runtime.cash.openSession({ id:'cash-T1', terminalId:'T1', operatorId:'u1', initialCashCents:0, actor:manager });
  const sale = runtime.sales.openSale({ terminalId:'T1', operatorId:'u1', sellerId:'u1' }, manager);
  runtime.sales.addItem(sale.id, { productId:'p1', quantity });
  const completed = runtime.sales.completeSale(sale.id, { payments:[{ method:'CASH', amountCents:quantity * 1000 }], actor:manager });
  return { runtime, sale:completed };
}

function septemberReport(runtime) { return runtime.reports.buildSalesSummary({ from:'2026-09-01T00:00:00.000Z', to:'2026-09-30T23:59:59.999Z' }); }

test('completed sale keeps original cost after product cost changes', () => { const { runtime, sale } = setup({ costCents:600 }); runtime.db.prepare("UPDATE products SET cost_cents=850 WHERE id='p1'").run(); const report = septemberReport(runtime); const row = runtime.db.prepare('SELECT cost_cents_snapshot,cost_snapshot_source FROM sale_items WHERE sale_id=?').get(sale.id); assert.equal(row.cost_cents_snapshot, 600); assert.equal(row.cost_snapshot_source, 'PRODUCT'); assert.equal(report.productSales[0].estimatedCostCents, 600); assert.equal(report.productSales[0].estimatedMarginCents, 400); assert.equal(report.productSales[0].costBasis, 'HISTORICAL_SNAPSHOT'); assert.equal(report.categorySales[0].estimatedCostCents,600); assert.equal(report.categorySales[0].estimatedMarginCents,400); runtime.close(); });

test('return uses original sale item cost snapshot', () => { const { runtime, sale } = setup({ costCents:600 }); runtime.db.prepare("UPDATE products SET cost_cents=850 WHERE id='p1'").run(); runtime.returns.createReturn({ saleId:sale.id, terminalId:'T1', operatorId:'u1', reason:'Cliente devolveu', items:[{ saleItemId:sale.items[0].id, quantity:1 }], refunds:[{ method:'CASH', amountCents:1000 }], actor:manager }); const report = septemberReport(runtime); assert.equal(report.productSales[0].netQuantity, 0); assert.equal(report.productSales[0].estimatedCostCents, 0); assert.equal(report.productSales[0].estimatedMarginCents, 0); runtime.close(); });

test('legacy sale without snapshot is explicitly reported as current-cost estimate', () => { const { runtime, sale } = setup({ costCents:600 }); runtime.db.prepare('UPDATE sale_items SET cost_cents_snapshot=NULL,cost_snapshot_source=NULL WHERE sale_id=?').run(sale.id); runtime.db.prepare("UPDATE products SET cost_cents=850 WHERE id='p1'").run(); const report = septemberReport(runtime); assert.equal(report.productSales[0].estimatedCostCents, 850); assert.equal(report.productSales[0].costBasis, 'ESTIMATED_CURRENT'); runtime.close(); });


test('category report explicitly follows the product current category while cost stays historical', () => {
  const { runtime } = setup({ costCents:600 });
  runtime.db.prepare("INSERT INTO categories(id,name,active,created_at,updated_at) VALUES('c2','Nova categoria',1,?,?)").run(NOW,NOW);
  runtime.db.prepare("UPDATE products SET category_id='c2',cost_cents=900 WHERE id='p1'").run();
  const report = septemberReport(runtime);
  assert.equal(report.categorySales[0].categoryId,'c2');
  assert.equal(report.categorySales[0].categoryName,'Nova categoria');
  assert.equal(report.categorySales[0].estimatedCostCents,600);
  assert.equal(report.categorySales[0].estimatedMarginCents,400);
  runtime.close();
});
