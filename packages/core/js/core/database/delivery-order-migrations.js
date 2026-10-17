'use strict';

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
}

function runDeliveryOrderMigrations(db) {
  if (!db) throw new TypeError('Database is required.');
  const table=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales_orders'").get();
  if (!table) throw new Error('sales_orders table is required before delivery migration.');
  if (!hasColumn(db,'sales_orders','delivery_address_json')) db.exec('ALTER TABLE sales_orders ADD COLUMN delivery_address_json TEXT');
  if (!hasColumn(db,'sales_orders','delivery_instructions')) db.exec('ALTER TABLE sales_orders ADD COLUMN delivery_instructions TEXT');
  return 1;
}

module.exports={runDeliveryOrderMigrations};
