'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createPdvRuntime } = require('../js/core/pdv-runtime');

const NOW = '2026-09-20T15:00:00.000Z';
const actor = { userId:'u1', profileId:'profile-manager', terminalId:'T1' };

function fixture() {
  let seq = 0;
  const runtime = createPdvRuntime({ now:() => NOW, idFactory:prefix => `${prefix}-${++seq}` });
  runtime.catalog.upsertCategory({ id:'c1', name:'Geral' }, actor);
  runtime.catalog.createUser({ id:'u1', username:'gerente', name:'Gerente', profileId:'profile-manager', password:'senha-forte' }, actor);
  runtime.catalog.upsertProduct({ id:'p1', name:'Produto', categoryId:'c1', unit:'UN', salePriceCents:1000, costCents:500, trackStock:true, minimumStock:5, active:true }, actor);
  runtime.inventory.move({ productId:'p1', locationId:'MAIN', type:'opening', quantityDelta:10, reason:'Abertura' }, actor);
  runtime.cash.openSession({ id:'cash-T1', terminalId:'T1', operatorId:'u1', initialCashCents:0, actor });
  return runtime;
}

function complete(runtime, id) { const sale = runtime.sales.openSale({ id, saleNumber:id, terminalId:'T1', operatorId:'u1', sellerId:'u1' }, actor); runtime.sales.addItem(sale.id, { productId:'p1', quantity:1 }); return runtime.sales.completeSale(sale.id, { payments:[{ method:'CASH', amountCents:1000 }], actor }); }

test('sales summary distinguishes historical, estimated and mixed cost basis', () => { const runtime = fixture(); const historical = complete(runtime, 's-historical'); const legacy = complete(runtime, 's-legacy'); runtime.db.prepare('UPDATE sale_items SET cost_cents_snapshot=NULL,cost_snapshot_source=NULL WHERE sale_id=?').run(legacy.id); runtime.db.prepare("UPDATE products SET cost_cents=800 WHERE id='p1'").run(); const report = runtime.reports.buildSalesSummary({ from:'2026-09-01T00:00:00.000Z', to:'2026-09-30T23:59:59.999Z' }); const product = report.productSales.find(row => row.productId === 'p1'); assert.equal(product.estimatedCostCents, 1300); assert.equal(product.estimatedMarginCents, 700); assert.equal(product.averageUnitCostCents, 650); assert.equal(product.costBasis, 'MIXED'); assert.equal(report.costBasis, 'MIXED'); assert.equal(report.hasEstimatedCost, true); const detail = runtime.sales.getSaleDetails(historical.id); assert.equal(detail.items[0].costCentsSnapshot, 500); assert.equal(detail.items[0].costSnapshotSource, 'PRODUCT'); assert.equal(detail.items[0].costBasis, 'HISTORICAL_SNAPSHOT'); runtime.close(); });

test('variant sales snapshot variant cost and legacy fallback uses current variant cost', () => { const runtime = fixture(); runtime.catalog.upsertProduct({ id:'p2', name:'Produto com variação', categoryId:'c1', unit:'UN', salePriceCents:1000, costCents:500, trackStock:false, minimumStock:0, active:true }, actor); runtime.catalogCustomization.upsertVariant({ id:'p2-v1', productId:'p2', name:'Variação A', priceDeltaCents:0, costCents:250 }); runtime.retail.setProductVariantStock('p2-v1', 5); const sale = runtime.sales.openSale({ id:'s-variant', saleNumber:'s-variant', terminalId:'T1', operatorId:'u1', sellerId:'u1' }, actor); runtime.retail.addProductVariantToSale(sale.id, { variantId:'p2-v1', quantity:1 }); runtime.sales.completeSale(sale.id, { payments:[{ method:'CASH', amountCents:1000 }], actor }); let detail = runtime.sales.getSaleDetails(sale.id); assert.equal(detail.items[0].costCentsSnapshot, 250); assert.equal(detail.items[0].costSnapshotSource, 'VARIANT'); runtime.db.prepare('UPDATE sale_items SET cost_cents_snapshot=NULL,cost_snapshot_source=NULL WHERE sale_id=?').run(sale.id); runtime.db.prepare("UPDATE product_variants SET cost_cents=300 WHERE id='p2-v1'").run(); detail = runtime.sales.getSaleDetails(sale.id); assert.equal(detail.items[0].effectiveCostCents, 300); assert.equal(detail.items[0].costBasis, 'ESTIMATED_CURRENT'); const report = runtime.reports.buildSalesSummary({ from:'2026-09-01T00:00:00.000Z', to:'2026-09-30T23:59:59.999Z' }); const product = report.productSales.find(row => row.productId === 'p2'); assert.equal(product.estimatedCostCents, 300); assert.equal(product.costBasis, 'ESTIMATED_CURRENT'); runtime.close(); });

test('inventory report separates shortages by stock location instead of aggregate balance', () => { const runtime = fixture(); runtime.logistics.createLocation({ id:'WH', name:'Depósito', type:'WAREHOUSE' }, actor); runtime.inventory.move({ productId:'p1', locationId:'WH', type:'opening', quantityDelta:1, reason:'Saldo depósito' }, actor); const main = runtime.reports.buildInventorySummary({ locationId:'MAIN' }); const warehouse = runtime.reports.buildInventorySummary({ locationId:'WH' }); const all = runtime.reports.buildInventorySummary(); assert.equal(main.locationId, 'MAIN'); assert.equal(main.purchaseList.length, 0); assert.equal(warehouse.locationId, 'WH'); assert.equal(warehouse.locationName, 'Depósito'); assert.equal(warehouse.purchaseList[0].quantity, 1); assert.equal(warehouse.purchaseList[0].shortageToMinimum, 4); assert.equal(warehouse.suggestedPurchaseCostCents, 2000); assert.ok(all.locations.some(row => row.id === 'MAIN')); assert.ok(all.locations.some(row => row.id === 'WH')); assert.equal(all.locationSummaries.WH.purchaseList[0].shortageToMinimum, 4); assert.equal(all.allLocationsSummary.purchaseList.find(row => row.locationId === 'WH').shortageToMinimum, 4); runtime.close(); });

test('desktop reports expose cost basis and stock-location controls', () => { const root = path.join(__dirname,'..','desktop','renderer'); const reporting = fs.readFileSync(path.join(root,'reporting-v2.js'),'utf8'); const index = fs.readFileSync(path.join(root,'index.html'),'utf8'); const detailExtension = path.join(root,'historical-cost-ui.js'); assert.match(reporting,/report-location-filter/); assert.match(reporting,/Margem histórica/); assert.match(reporting,/Margem parcialmente estimada/); assert.match(reporting,/Base do custo/); assert.match(reporting,/Custo médio unitário/); assert.match(index,/historical-cost-ui\.js/); execFileSync(process.execPath,['--check',detailExtension],{stdio:'pipe'}); });
