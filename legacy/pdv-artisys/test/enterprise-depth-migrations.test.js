const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../js/core/database/sqlite-database');
const { runMigrations } = require('../js/core/database/migrations');
const { runEnterpriseDepthMigrations } = require('../js/core/database/enterprise-depth-migrations');

function legacyDb() {
  const db = openDatabase(':memory:');
  runMigrations(db, () => '2026-09-20T00:00:00.000Z');
  db.prepare("INSERT INTO categories(id,name,active,created_at,updated_at) VALUES('c','Geral',1,'x','x')").run();
  db.prepare("INSERT INTO users(id,username,name,role,password_hash,password_salt,active,created_at,updated_at) VALUES('u','admin','Admin','admin','h','s',1,'x','x')").run();
  db.prepare("INSERT INTO products(id,name,category_id,unit,sale_price_cents,cost_cents,track_stock,minimum_stock,active,created_at,updated_at) VALUES('p','Produto','c','UN',1000,600,1,0,1,'x','x')").run();
  db.prepare("INSERT INTO inventory_balances(product_id,quantity,updated_at) VALUES('p',7,'x')").run();
  db.prepare("INSERT INTO sales(id,sale_number,terminal_id,operator_id,status,opened_at,updated_at) VALUES('s','S-1','PDV-1','u','OPEN','x','x')").run();
  return db;
}

test('P0 migration creates MAIN and migrates legacy stock exactly once', () => {
  const db = legacyDb();
  runEnterpriseDepthMigrations(db, () => '2026-09-20T01:00:00.000Z');
  runEnterpriseDepthMigrations(db, () => '2026-09-20T02:00:00.000Z');

  assert.equal(db.prepare("SELECT COUNT(*) n FROM stock_locations WHERE id='MAIN'").get().n, 1);
  assert.equal(db.prepare("SELECT quantity FROM inventory_location_balances WHERE product_id='p' AND location_id='MAIN'").get().quantity, 7);
  assert.equal(db.prepare("SELECT stock_location_id FROM sales WHERE id='s'").get().stock_location_id, 'MAIN');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM enterprise_depth_schema_migrations WHERE version=1").get().n, 1);
  db.close();
});

test('P0 migration creates all operational depth tables without changing legacy ids', () => {
  const db = legacyDb();
  runEnterpriseDepthMigrations(db, () => '2026-09-20T01:00:00.000Z');
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  for (const name of [
    'stock_locations','inventory_location_balances','terminal_stock_locations','inventory_reservations',
    'purchase_orders','purchase_order_items','purchase_receipts','purchase_receipt_items',
    'stock_transfers','stock_transfer_items','sales_orders','sales_order_items',
    'sales_order_fulfillments','sales_order_fulfillment_items'
  ]) assert.equal(tables.has(name), true, name);

  assert.equal(db.prepare("SELECT id FROM products WHERE id='p'").get().id, 'p');
  assert.equal(db.prepare("SELECT id FROM sales WHERE id='s'").get().id, 's');
  const saleItemColumns = new Set(db.prepare('PRAGMA table_info(sale_items)').all().map(row => row.name));
  assert.equal(saleItemColumns.has('cost_cents_snapshot'), true);
  assert.equal(saleItemColumns.has('cost_snapshot_source'), true);
  db.close();
});
