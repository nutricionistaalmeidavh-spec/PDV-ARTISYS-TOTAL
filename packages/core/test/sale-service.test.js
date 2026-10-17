const test=require('node:test');
const assert=require('node:assert/strict');
const { openDatabase }=require('../js/core/database/sqlite-database');
const { runMigrations }=require('../js/core/database/migrations');
const { runReleaseMigrations }=require('../js/core/database/release-migrations');
const { runVerticalMigrations }=require('../js/core/database/vertical-migrations');
const {runSalesEnhancementMigrations}=require('../js/core/database/sales-enhancement-migrations');
const {runCommercialMediaMigrations}=require('../js/core/database/commercial-media-migrations');
const { runAccessProfileMigrations } = require('../js/core/database/access-profile-migrations');
const { runCanonicalAccessMigrations } = require('../js/core/database/canonical-access-migrations');
const { SqliteOutboxStore }=require('../js/core/database/outbox-store');
const { createCatalogService }=require('../js/domains/catalog/catalog-service');
const { createInventoryService }=require('../js/domains/inventory/inventory-service');
const { calculateSaleTotals }=require('../js/domains/sales/pricing');
const { createSaleService }=require('../js/domains/sales/sale-service');

function setup(){
  const db=openDatabase(':memory:');runMigrations(db);runReleaseMigrations(db);runVerticalMigrations(db);runSalesEnhancementMigrations(db);runCommercialMediaMigrations(db);runAccessProfileMigrations(db);runCanonicalAccessMigrations(db);let seq=0;const ids=p=>`${p}-${++seq}`;
  const catalog=createCatalogService({db,now:()=> '2026-09-09T15:00:00Z',idFactory:ids});
  catalog.createUser({id:'u1',username:'caixa',name:'Caixa',profileId:'profile-cashier',password:'senha-forte-123'});
  catalog.createUser({id:'m1',username:'gerente',name:'Gerente',profileId:'profile-manager',password:'senha-forte-456'});
  catalog.upsertProduct({id:'p1',sku:'1',name:'Teclado',salePriceCents:10000,minimumStock:1});
  catalog.upsertProduct({id:'p2',sku:'2',name:'Mouse',salePriceCents:5000,minimumStock:1});
  catalog.upsertCustomer({id:'c1',name:'Maria',creditLimitCents:20000,creditUsedCents:5000});
  const inventory=createInventoryService({db,now:()=> '2026-09-09T15:00:00Z',idFactory:ids});
  inventory.move({productId:'p1',type:'opening',quantityDelta:5}); inventory.move({productId:'p2',type:'opening',quantityDelta:10});
  const outbox=new SqliteOutboxStore(db);
  const sales=createSaleService({db,outbox,now:()=> '2026-09-09T15:10:00Z',idFactory:ids});
  return {db,catalog,inventory,outbox,sales};
}

test('calculateSaleTotals works only in integer cents',()=>{
  assert.deepEqual(calculateSaleTotals({items:[{quantity:2,unitPriceCents:1000},{quantity:0.5,unitPriceCents:500}],discountCents:250}),{subtotalCents:2250,discountCents:250,totalCents:2000});
  assert.throws(()=>calculateSaleTotals({items:[],discountCents:1.5}),/centavos inteiros/);
});

test('sale lifecycle supports open add update remove discount suspend and resume',()=>{
  const {db,sales}=setup();
  const sale=sales.openSale({id:'s1',saleNumber:'000001',terminalId:'pdv-01',operatorId:'u1',customerId:'c1'});
  assert.equal(sale.status,'OPEN');
  sales.addItem('s1',{productId:'p1',quantity:1}); sales.addItem('s1',{productId:'p2',quantity:2});
  sales.updateItemQuantity('s1','p2',3); sales.applyDiscount('s1',{discountCents:500});
  assert.equal(sales.getSale('s1').totalCents,24500);
  sales.suspendSale('s1'); assert.equal(sales.getSale('s1').status,'SUSPENDED');
  sales.resumeSale('s1'); assert.equal(sales.getSale('s1').status,'OPEN');
  sales.removeItem('s1','p2'); assert.equal(sales.getSale('s1').totalCents,9500);
  db.close();
});

test('completeSale persists multiple payments and sale.completed outbox without changing stock',async()=>{
  const {db,inventory,outbox,sales}=setup();
  sales.openSale({id:'s1',saleNumber:'000001',terminalId:'pdv-01',operatorId:'u1',customerId:'c1'}); sales.addItem('s1',{productId:'p1',quantity:1});
  const completed=sales.completeSale('s1',{payments:[{method:'CASH',amountCents:7000},{method:'STORE_CREDIT',amountCents:3000}],actor:{userId:'u1',profileId:'profile-cashier',terminalId:'pdv-01'},mutationId:'mut-1'});
  assert.equal(completed.status,'COMPLETED'); assert.equal(completed.totalCents,10000); assert.equal(completed.payments.length,2);
  assert.equal(inventory.getBalance('p1'),5,'stock must be changed only by EventBus effect');
  assert.equal(db.prepare('SELECT credit_used_cents AS value FROM customers WHERE id=?').get('c1').value,8000);
  const events=await outbox.listPending(10); assert.equal(events.length,1); assert.equal(events[0].type,'sale.completed'); assert.equal(events[0].payload.items[0].productId,'p1');
  db.close();
});

test('completeSale rejects insufficient payment, insufficient stock and duplicate completion atomically',async()=>{
  const {db,outbox,sales}=setup();
  sales.openSale({id:'s1',saleNumber:'000001',terminalId:'pdv-01',operatorId:'u1'});sales.addItem('s1',{productId:'p1',quantity:1});
  assert.throws(()=>sales.completeSale('s1',{payments:[{method:'CASH',amountCents:5000}],actor:{userId:'u1',profileId:'profile-cashier'}}),/Pagamento insuficiente/);
  assert.equal((await outbox.listPending(10)).length,0); assert.equal(sales.getSale('s1').status,'OPEN');
  sales.updateItemQuantity('s1','p1',6);assert.throws(()=>sales.completeSale('s1',{payments:[{method:'CASH',amountCents:60000}],actor:{userId:'u1',profileId:'profile-cashier'}}),/Estoque insuficiente/);
  sales.updateItemQuantity('s1','p1',1);sales.completeSale('s1',{payments:[{method:'CASH',amountCents:10000}],actor:{userId:'u1',profileId:'profile-cashier'}});
  assert.throws(()=>sales.completeSale('s1',{payments:[{method:'CASH',amountCents:10000}],actor:{userId:'u1',profileId:'profile-cashier'}}),/nao esta aberta/);
  db.close();
});

test('cancelSale preserves history, reverses credit and emits sale.cancelled without restoring stock directly',async()=>{
  const {db,inventory,outbox,sales}=setup();
  sales.openSale({id:'s1',saleNumber:'000001',terminalId:'pdv-01',operatorId:'u1',customerId:'c1'});sales.addItem('s1',{productId:'p1',quantity:1});
  sales.completeSale('s1',{payments:[{method:'STORE_CREDIT',amountCents:10000}],actor:{userId:'u1',profileId:'profile-cashier'}});
  const cancelled=sales.cancelSale('s1',{reason:'Cliente desistiu',actor:{userId:'m1',profileId:'profile-manager',terminalId:'pdv-01'}});
  assert.equal(cancelled.status,'CANCELLED'); assert.equal(cancelled.cancelReason,'Cliente desistiu'); assert.equal(cancelled.items.length,1);
  assert.equal(db.prepare('SELECT credit_used_cents AS value FROM customers WHERE id=?').get('c1').value,5000);
  assert.equal(inventory.getBalance('p1'),5);
  const events=await outbox.listPending(10); assert.deepEqual(events.map(e=>e.type),['sale.completed','sale.cancelled']);
  db.close();
});