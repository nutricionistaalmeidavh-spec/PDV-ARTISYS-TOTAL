const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../js/core/database/sqlite-database');
const { runMigrations } = require('../js/core/database/migrations');
const { SqliteEffectStore } = require('../js/core/database/effect-store');
const { DomainEventBus } = require('../js/core/domain-event-bus');
const { createCatalogService } = require('../js/domains/catalog/catalog-service');
const { roundQuantity, applyStockDelta } = require('../js/domains/inventory/inventory-rules');
const { createInventoryService } = require('../js/domains/inventory/inventory-service');
const { registerInventoryEffects } = require('../js/domains/inventory/inventory-effects');

function setup() {
  const db=openDatabase(':memory:'); runMigrations(db);
  const catalog=createCatalogService({db,now:()=> '2026-09-09T15:00:00Z'});
  catalog.upsertProduct({id:'p1',sku:'1',name:'Teclado',salePriceCents:10000,minimumStock:2});
  let seq=0;
  const inventory=createInventoryService({db,now:()=> '2026-09-09T15:00:00Z',idFactory:p=>`${p}-${++seq}`});
  return {db,catalog,inventory};
}

test('roundQuantity and applyStockDelta preserve three decimals and block negative stock', () => {
  assert.equal(roundQuantity(1.23456),1.235);
  assert.deepEqual(applyStockDelta(5,4),{before:5,after:9,delta:4});
  assert.throws(()=>applyStockDelta(2,-3),/Estoque nao pode ficar negativo/);
});

test('inventory service records immutable movements and balance projection', () => {
  const {db,inventory}=setup();
  const movement=inventory.move({productId:'p1',type:'purchase',quantityDelta:5,reason:'Compra'});
  assert.equal(movement.quantityBefore,0); assert.equal(movement.quantityAfter,5);
  assert.equal(inventory.getBalance('p1'),5);
  inventory.count({productId:'p1',countedQuantity:1.5,reason:'Contagem'});
  assert.equal(inventory.getBalance('p1'),1.5);
  assert.equal(inventory.getLowStock().length,1);
  assert.equal(inventory.listMovements('p1').length,2);
  db.close();
});

test('sale completed inventory effect is idempotent on retry', async () => {
  const {db,inventory}=setup(); inventory.move({productId:'p1',type:'opening',quantityDelta:5});
  const bus=new DomainEventBus(); const effectStore=new SqliteEffectStore(db);
  registerInventoryEffects({bus,inventoryService:inventory,effectStore});
  const evt={eventId:'evt-sale-1',type:'sale.completed',aggregate:'sale',aggregateId:'s1',occurredAt:'2026-09-09T15:01:00Z',actor:{userId:'u1',profileId:'profile-cashier'},source:'server',payload:{items:[{productId:'p1',quantity:2}]}};
  assert.equal((await bus.publishAsync(evt)).failures.length,0);
  assert.equal(inventory.getBalance('p1'),3);
  assert.equal((await bus.publishAsync(evt)).failures.length,0);
  assert.equal(inventory.getBalance('p1'),3);
  assert.equal(inventory.listMovements('p1').filter(m=>m.type==='sale').length,1);
  db.close();
});

test('sale cancelled inventory effect restores stock once', async () => {
  const {db,inventory}=setup(); inventory.move({productId:'p1',type:'opening',quantityDelta:3});
  const bus=new DomainEventBus(); const effectStore=new SqliteEffectStore(db); registerInventoryEffects({bus,inventoryService:inventory,effectStore});
  const evt={eventId:'evt-cancel-1',type:'sale.cancelled',aggregate:'sale',aggregateId:'s1',occurredAt:'2026-09-09T15:02:00Z',actor:{userId:'u1',profileId:'profile-manager'},source:'server',payload:{items:[{productId:'p1',quantity:2}]}};
  await bus.publishAsync(evt); await bus.publishAsync(evt);
  assert.equal(inventory.getBalance('p1'),5);
  assert.equal(inventory.listMovements('p1').filter(m=>m.type==='sale-cancel').length,1);
  db.close();
});
