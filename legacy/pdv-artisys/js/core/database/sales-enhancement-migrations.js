'use strict';

const { withTransaction } = require('./sqlite-database');

const SALES_ENHANCEMENT_SCHEMA_VERSION = 11;
const SALES_ENHANCEMENT_MIGRATION_NAME = 'pdv_seller_price_reports_1_4_0';

function columns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
}

function runSalesEnhancementMigrations(db, now = () => new Date().toISOString()) {
  if (!db) throw new TypeError('Database is required.');
  const current = Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get()?.version || 0);
  if (current >= SALES_ENHANCEMENT_SCHEMA_VERSION) return current;

  withTransaction(db, () => {
    const saleColumns = columns(db, 'sales');
    if (!saleColumns.has('seller_id')) db.exec('ALTER TABLE sales ADD COLUMN seller_id TEXT REFERENCES users(id)');
    if (!saleColumns.has('seller_name_snapshot')) db.exec('ALTER TABLE sales ADD COLUMN seller_name_snapshot TEXT');

    const itemColumns = columns(db, 'sale_items');
    if (!itemColumns.has('catalog_unit_price_cents')) db.exec('ALTER TABLE sale_items ADD COLUMN catalog_unit_price_cents INTEGER CHECK (catalog_unit_price_cents >= 0)');
    if (!itemColumns.has('price_override_reason')) db.exec('ALTER TABLE sale_items ADD COLUMN price_override_reason TEXT');
    if (!itemColumns.has('price_changed_by_id')) db.exec('ALTER TABLE sale_items ADD COLUMN price_changed_by_id TEXT REFERENCES users(id)');
    if (!itemColumns.has('price_authorized_by_id')) db.exec('ALTER TABLE sale_items ADD COLUMN price_authorized_by_id TEXT REFERENCES users(id)');

    db.exec(`UPDATE sales SET seller_id=operator_id WHERE seller_id IS NULL;
      UPDATE sales SET seller_name_snapshot=(SELECT name FROM users WHERE users.id=sales.seller_id) WHERE seller_name_snapshot IS NULL;
      UPDATE sale_items SET catalog_unit_price_cents=unit_price_cents WHERE catalog_unit_price_cents IS NULL;`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_sales_seller_completed ON sales(seller_id,completed_at)');
    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(SALES_ENHANCEMENT_SCHEMA_VERSION, SALES_ENHANCEMENT_MIGRATION_NAME, now());
  });
  return SALES_ENHANCEMENT_SCHEMA_VERSION;
}

module.exports = {
  SALES_ENHANCEMENT_SCHEMA_VERSION,
  SALES_ENHANCEMENT_MIGRATION_NAME,
  runSalesEnhancementMigrations
};
