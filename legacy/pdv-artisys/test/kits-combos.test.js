'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../js/core/database/sqlite-database');
const { runMigrations } = require('../js/core/database/migrations');
const { runReleaseMigrations } = require('../js/core/database/release-migrations');
const { runVerticalMigrations } = require('../js/core/database/vertical-migrations');
const {runSalesEnhancementMigrations}=require('../js/core/database/sales-enhancement-migrations');
const {runCommercialMediaMigrations}=require('../js/core/database/commercial-media-migrations');
const { runAccessProfileMigrations } = require('../js/core/database/access-profile-migrations');
const { runCanonicalAccessMigrations } = require('../js/core/database/canonical-access-migrations');
const { runKitComboMigrations } = require('../js/core/database/kit-combo-migrations');
const { createCatalogService } = require('../js/domains/catalog/catalog-service');
const { createRecipeService } = require('../js/domains/inventory/recipe-service');
const { createKitComboService } = require('../js/domains/catalog/kit-combo-service');
const { SqliteOutboxStore } = require('../js/core/database/outbox-store');
const { createSaleService } = require('../js/domains/sales/sale-service');
const { createPromotionSaleService } = require('../js/domains/sales/promotion-sale-service');
const { createPdvRuntime } = require('../js/core/pdv-runtime');

const NOW = '2026-09-12T12:00:00.000Z';

function foundation() {
  const db = openDatabase(':memory:');
  runMigrations(db); runReleaseMigrations(db); runVerticalMigrations(db); runKitComboMigrations(db); runSalesEnhancementMigrations(db); runCommercialMediaMigrations(db); runAccessProfileMigrations(db); runCanonicalAccessMigrations(db);
  let seq = 0;
  const idFactory = prefix => `${prefix}-${++seq}`;
  const now = () => NOW;
  const catalog = createCatalogService({ db, now, idFactory });
  const recipes = createRecipeService({ db, now, idFactory });
  const kitsCombos = createKitComboService({ db, catalog, recipes, now, idFactory });
  return { db, idFactory, now, catalog, recipes, kitsCombos };
}

function seedProducts(catalog) {
  catalog.upsertProduct({ id:'p399', sku:'399', name:'Produto 3,99', salePriceCents:399, costCents:200, trackStock:true });
  catalog.upsertProduct({ id:'p350', sku:'350', name:'Produto 3,50', salePriceCents:350, costCents:180, trackStock:true });
  catalog.upsertProduct({ id:'p200', sku:'200', name:'Produto 2,00', salePriceCents:200, costCents:100, trackStock:true });
}

test('kit/combo migration is incremental and idempotent', () => {
  const db = openDatabase(':memory:');
  runMigrations(db); runReleaseMigrations(db); runVerticalMigrations(db);
  runKitComboMigrations(db); runKitComboMigrations(db);
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  for (const name of ['product_kits','promotional_combo_rules','promotional_combo_products','sale_discount_states']) assert.equal(tables.has(name), true, name);
  db.close();
});

test('kit price is user-defined while stock composition reuses recipes', () => {
  const { db, catalog, recipes, kitsCombos } = foundation();
  seedProducts(catalog);
  const kit = kitsCombos.upsertKit({
    id:'kit-1', name:'Kit balcão', sku:'KIT001', salePriceCents:1790, costCents:900,
    components:[{ productId:'p399', quantity:2 }, { productId:'p200', quantity:1 }]
  }, { userId:'admin', profileId:'profile-administrator' });
  assert.equal(kit.salePriceCents, 1790);
  assert.equal(kit.trackStock, false, 'kit itself must not create parallel stock');
  assert.deepEqual(recipes.expandItems([{ productId:'kit-1', quantity:2 }]), [
    { productId:'p200', quantity:2 },
    { productId:'p399', quantity:4 }
  ]);
  db.close();
});

test('same-product promotional combo uses quantity and price defined by the user', () => {
  const { db, catalog, kitsCombos } = foundation();
  seedProducts(catalog);
  kitsCombos.upsertPromotionalCombo({
    id:'combo-3x10', name:'3 por 10', selectionMode:'SAME_PRODUCT', requiredQuantity:3,
    bundlePriceCents:1000, productIds:['p399'], allowManualDiscount:true
  });
  const promo = kitsCombos.resolvePromotions([{ productId:'p399', quantity:7, unitPriceCents:399 }]);
  assert.equal(promo.discountCents, 394);
  assert.equal(promo.applied[0].applications, 2);

  kitsCombos.upsertPromotionalCombo({
    id:'combo-2x750', name:'2 por 7,50', selectionMode:'SAME_PRODUCT', requiredQuantity:2,
    bundlePriceCents:750, productIds:['p399'], allowManualDiscount:true
  });
  const custom = kitsCombos.resolvePromotions([{ productId:'p399', quantity:2, unitPriceCents:399 }]);
  assert.equal(custom.discountCents, 48, 'no promotional price may be hardcoded');
  db.close();
});

test('mixed promotional combo can group different selected products without stacking units', () => {
  const { db, catalog, kitsCombos } = foundation();
  seedProducts(catalog);
  kitsCombos.upsertPromotionalCombo({
    id:'combo-mix', name:'Misture 3', selectionMode:'ANY_SELECTED', requiredQuantity:3,
    bundlePriceCents:900, productIds:['p399','p350','p200'], allowManualDiscount:true
  });
  const promo = kitsCombos.resolvePromotions([
    { productId:'p399', quantity:2, unitPriceCents:399 },
    { productId:'p350', quantity:1, unitPriceCents:350 }
  ]);
  assert.equal(promo.discountCents, 248);
  assert.equal(promo.applied[0].applications, 1);
  db.close();
});

test('inactive and out-of-period combos are ignored', () => {
  const { db, catalog, kitsCombos } = foundation();
  seedProducts(catalog);
  kitsCombos.upsertPromotionalCombo({ id:'future', name:'Futuro', selectionMode:'SAME_PRODUCT', requiredQuantity:3, bundlePriceCents:1000, productIds:['p399'], startsAt:'2026-10-01T00:00:00.000Z' });
  kitsCombos.upsertPromotionalCombo({ id:'off', name:'Desativado', selectionMode:'SAME_PRODUCT', requiredQuantity:3, bundlePriceCents:1000, productIds:['p399'], active:false });
  assert.equal(kitsCombos.resolvePromotions([{ productId:'p399', quantity:3, unitPriceCents:399 }]).discountCents, 0);
  db.close();
});

test('promotion sale wrapper keeps manual and automatic discounts separate', () => {
  const { db, idFactory, now, catalog, recipes, kitsCombos } = foundation();
  seedProducts(catalog);
  catalog.createUser({ id:'u1', username:'caixa', name:'Caixa', profileId:'profile-cashier', password:'senha-forte-123' });
  kitsCombos.upsertPromotionalCombo({ id:'combo', name:'3 por 10', selectionMode:'SAME_PRODUCT', requiredQuantity:3, bundlePriceCents:1000, productIds:['p399'], allowManualDiscount:true });
  const outbox = new SqliteOutboxStore(db);
  const baseSales = createSaleService({ db, outbox, now, idFactory, stockRequirementsResolver:items=>recipes.expandItems(items) });
  const sales = createPromotionSaleService({ db, baseSales, promotionService:kitsCombos, now });
  sales.openSale({ id:'s1', saleNumber:'1', terminalId:'T1', operatorId:'u1' });
  let sale = sales.addItem('s1', { productId:'p399', quantity:3 });
  assert.equal(sale.promotionDiscountCents, 197);
  assert.equal(sale.manualDiscountCents, 0);
  assert.equal(sale.discountCents, 197);
  assert.equal(sale.totalCents, 1000);
  sale = sales.applyDiscount('s1', { discountCents:100 });
  assert.equal(sale.manualDiscountCents, 100);
  assert.equal(sale.promotionDiscountCents, 197);
  assert.equal(sale.discountCents, 297);
  assert.equal(sale.totalCents, 900);
  db.close();
});

test('combo may block manual discounts when configured by the user', () => {
  const { db, idFactory, now, catalog, recipes, kitsCombos } = foundation();
  seedProducts(catalog);
  catalog.createUser({ id:'u1', username:'caixa', name:'Caixa', profileId:'profile-cashier', password:'senha-forte-123' });
  kitsCombos.upsertPromotionalCombo({ id:'exclusive', name:'Preço fechado', selectionMode:'SAME_PRODUCT', requiredQuantity:3, bundlePriceCents:1000, productIds:['p399'], allowManualDiscount:false });
  const baseSales = createSaleService({ db, outbox:new SqliteOutboxStore(db), now, idFactory, stockRequirementsResolver:items=>recipes.expandItems(items) });
  const sales = createPromotionSaleService({ db, baseSales, promotionService:kitsCombos, now });
  sales.openSale({ id:'s1', saleNumber:'1', terminalId:'T1', operatorId:'u1' });
  sales.addItem('s1', { productId:'p399', quantity:3 });
  assert.throws(() => sales.applyDiscount('s1', { discountCents:1 }), /nao permite desconto manual/i);
  db.close();
});

test('kit stock snapshot survives later composition edits and cancellation', async () => {
  let seq=0; const rt=createPdvRuntime({ now:()=>NOW, idFactory:p=>`${p}-${++seq}` });
  rt.catalog.createUser({ id:'cashier', username:'caixa', name:'Caixa', profileId:'profile-cashier', password:'senha-forte-123' });
  rt.catalog.createUser({ id:'manager', username:'gerente', name:'Gerente', profileId:'profile-manager', password:'senha-forte-456' });
  rt.catalog.upsertProduct({ id:'a', name:'A', salePriceCents:400, trackStock:true });
  rt.catalog.upsertProduct({ id:'b', name:'B', salePriceCents:300, trackStock:true });
  rt.inventory.move({ productId:'a', type:'opening', quantityDelta:10 });
  rt.inventory.move({ productId:'b', type:'opening', quantityDelta:10 });
  rt.kitsCombos.upsertKit({ id:'kit', name:'Kit AB', salePriceCents:1000, components:[{productId:'a',quantity:2},{productId:'b',quantity:1}] });
  rt.cash.openSession({ id:'cash-1', terminalId:'T1', operatorId:'cashier', initialCashCents:0 });
  rt.sales.openSale({ id:'sale-kit', saleNumber:'1', terminalId:'T1', operatorId:'cashier' });
  let sale=rt.sales.addItem('sale-kit',{productId:'kit',quantity:1});
  assert.deepEqual(sale.items[0].configuration.kit.components.map(item=>({productId:item.productId,quantity:item.quantity})),[{productId:'a',quantity:2},{productId:'b',quantity:1}]);
  rt.sales.completeSale('sale-kit',{payments:[{method:'CASH',amountCents:1000}],actor:{userId:'cashier',profileId:'profile-cashier',terminalId:'T1'}});
  rt.kitsCombos.upsertKit({ id:'kit', name:'Kit AB alterado', salePriceCents:1000, components:[{productId:'a',quantity:1},{productId:'b',quantity:3}] });
  await rt.dispatchPending();
  assert.equal(rt.inventory.getBalance('a'),8);
  assert.equal(rt.inventory.getBalance('b'),9);
  rt.sales.cancelSale('sale-kit',{reason:'Teste',actor:{userId:'manager',profileId:'profile-manager',terminalId:'T1'}});
  await rt.dispatchPending();
  assert.equal(rt.inventory.getBalance('a'),10);
  assert.equal(rt.inventory.getBalance('b'),10);
  rt.close();
});
