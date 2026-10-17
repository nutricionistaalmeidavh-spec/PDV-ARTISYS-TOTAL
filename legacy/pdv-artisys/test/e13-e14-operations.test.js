'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../js/core/database/sqlite-database');
const { runMigrations, CURRENT_SCHEMA_VERSION } = require('../js/core/database/migrations');
const { SqliteOutboxStore } = require('../js/core/database/outbox-store');
const { createInventoryService } = require('../js/domains/inventory/inventory-service');
const { createCashService } = require('../js/domains/cash/cash-service');

function seedBase(db) {
  db.prepare("INSERT INTO users (id,username,name,role,password_hash,password_salt,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run('u1','admin','Admin','admin','hash','salt',1,'2026-09-09T10:00:00Z','2026-09-09T10:00:00Z');
  db.prepare("INSERT INTO categories (id,name,active,created_at,updated_at) VALUES (?,?,?,?,?)")
    .run('cat1','Geral',1,'2026-09-09T10:00:00Z','2026-09-09T10:00:00Z');
  db.prepare(`INSERT INTO products
    (id,sku,barcode,name,category_id,unit,sale_price_cents,cost_cents,track_stock,minimum_stock,active,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('p1','SKU-1','7891','Produto A','cat1','UN',1500,900,1,5,1,'2026-09-09T10:00:00Z','2026-09-09T10:00:00Z');
  db.prepare(`INSERT INTO products
    (id,sku,barcode,name,category_id,unit,sale_price_cents,cost_cents,track_stock,minimum_stock,active,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('p2','SKU-2','7892','Produto B','cat1','UN',2500,1200,1,2,1,'2026-09-09T10:00:00Z','2026-09-09T10:00:00Z');
}

test('E13-E20 migration creates incremental operational tables idempotently', () => {
  const db = openDatabase(':memory:');
  const version = runMigrations(db, () => '2026-09-09T10:00:00Z');
  assert.ok(version >= 2);
  assert.equal(version, CURRENT_SCHEMA_VERSION);
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  for (const name of ['return_transactions','return_items','financial_accounts','financial_entries','financial_settlements','print_jobs','device_settings']) {
    assert.equal(tables.has(name), true, name);
  }
  runMigrations(db, () => '2026-09-09T11:00:00Z');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, CURRENT_SCHEMA_VERSION);
  db.close();
});

test('inventory operational queries list balances, filtered movements and low stock', () => {
  const db = openDatabase(':memory:');
  runMigrations(db);
  seedBase(db);
  let n = 0;
  const inventory = createInventoryService({ db, now: () => '2026-09-09T12:00:00Z', idFactory: p => `${p}-${++n}` });
  inventory.move({ productId:'p1', type:'opening', quantityDelta:4, reason:'saldo inicial' });
  inventory.move({ productId:'p2', type:'opening', quantityDelta:10, reason:'saldo inicial' });

  const balances = inventory.listBalances({ query:'produto' });
  assert.equal(balances.length, 2);
  assert.deepEqual(balances[0], {
    productId:'p1', sku:'SKU-1', barcode:'7891', name:'Produto A', unit:'UN',
    quantity:4, minimumStock:5, costCents:900, salePriceCents:1500, lowStock:true
  });
  assert.equal(inventory.listMovements({ productId:'p1', type:'opening' }).length, 1);
  assert.deepEqual(inventory.listLowStock().map(item => item.productId), ['p1']);
  db.close();
});

test('cash operational queries expose current session, movements and closed history', () => {
  const db = openDatabase(':memory:');
  runMigrations(db);
  seedBase(db);
  const outbox = new SqliteOutboxStore(db);
  let n = 0;
  const cash = createCashService({ db, outbox, now: () => '2026-09-09T12:00:00Z', idFactory: p => `${p}-${++n}` });
  const opened = cash.openSession({ terminalId:'PDV-01', operatorId:'u1', initialCashCents:10000, actor:{userId:'u1',profileId:'profile-administrator',terminalId:'PDV-01'} });
  assert.equal(opened.expectedCashCents, 10000);
  cash.addSupply(opened.id, { amountCents:2000, note:'reforco' });
  assert.equal(cash.getOpenSession('PDV-01').id, opened.id);
  assert.equal(cash.getOpenSession('PDV-01').expectedCashCents, 12000);
  cash.withdraw(opened.id, { amountCents:500, note:'sangria' });
  assert.equal(cash.getOpenSession('PDV-01').expectedCashCents, 11500);
  assert.equal(cash.listSessionMovements(opened.id).length, 3);
  cash.closeSession(opened.id, { countedByMethod:{ CASH:11500 }, actor:{userId:'u1',profileId:'profile-administrator',terminalId:'PDV-01'} });
  const history = cash.listSessions({ terminalId:'PDV-01', status:'CLOSED' });
  assert.equal(history.length, 1);
  assert.equal(history[0].status, 'CLOSED');
  assert.equal(history[0].divergenceCents, 0);
  db.close();
});
