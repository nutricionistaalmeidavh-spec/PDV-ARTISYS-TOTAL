'use strict';

const { withTransaction } = require('./sqlite-database');

const COMMERCIAL_MEDIA_SCHEMA_VERSION = 12;
const COMMERCIAL_MEDIA_MIGRATION_NAME = 'commissions_and_product_photo_sync_1_4_0';

function columns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
}

function runCommercialMediaMigrations(db, now = () => new Date().toISOString()) {
  if (!db) throw new TypeError('Database is required.');
  const current = Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get()?.version || 0);
  if (current >= COMMERCIAL_MEDIA_SCHEMA_VERSION) return current;

  withTransaction(db, () => {
    const itemColumns = columns(db, 'sale_items');
    if (!itemColumns.has('commission_bps_snapshot')) db.exec('ALTER TABLE sale_items ADD COLUMN commission_bps_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (commission_bps_snapshot>=0 AND commission_bps_snapshot<=10000)');
    if (!itemColumns.has('commission_base_cents')) db.exec('ALTER TABLE sale_items ADD COLUMN commission_base_cents INTEGER NOT NULL DEFAULT 0 CHECK (commission_base_cents>=0)');
    if (!itemColumns.has('commission_cents')) db.exec('ALTER TABLE sale_items ADD COLUMN commission_cents INTEGER NOT NULL DEFAULT 0 CHECK (commission_cents>=0)');

    db.exec(`
      CREATE TABLE IF NOT EXISTS seller_commission_rules (
        id TEXT PRIMARY KEY,
        seller_id TEXT NOT NULL,
        product_id TEXT,
        commission_bps INTEGER NOT NULL CHECK(commission_bps>=0 AND commission_bps<=10000),
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(seller_id) REFERENCES users(id),
        FOREIGN KEY(product_id) REFERENCES products(id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_seller_commission_scope ON seller_commission_rules(seller_id,COALESCE(product_id,'*'));
      CREATE INDEX IF NOT EXISTS idx_seller_commission_rules_active ON seller_commission_rules(seller_id,active,product_id);

      CREATE TABLE IF NOT EXISTS commission_payments (
        id TEXT PRIMARY KEY,
        seller_id TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
        period_from TEXT,
        period_to TEXT,
        note TEXT,
        paid_by_id TEXT,
        paid_at TEXT NOT NULL,
        FOREIGN KEY(seller_id) REFERENCES users(id),
        FOREIGN KEY(paid_by_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_commission_payments_seller ON commission_payments(seller_id,paid_at);

      CREATE TABLE IF NOT EXISTS commission_ledger (
        id TEXT PRIMARY KEY,
        seller_id TEXT NOT NULL,
        sale_id TEXT,
        sale_item_id TEXT,
        return_id TEXT,
        payment_id TEXT,
        kind TEXT NOT NULL CHECK(kind IN('EARNED','SALE_REVERSAL','RETURN_REVERSAL','RETURN_RESTORED','PAYMENT')),
        amount_cents INTEGER NOT NULL,
        reference_key TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(seller_id) REFERENCES users(id),
        FOREIGN KEY(sale_id) REFERENCES sales(id),
        FOREIGN KEY(sale_item_id) REFERENCES sale_items(id),
        FOREIGN KEY(return_id) REFERENCES return_transactions(id),
        FOREIGN KEY(payment_id) REFERENCES commission_payments(id)
      );
      CREATE INDEX IF NOT EXISTS idx_commission_ledger_seller_date ON commission_ledger(seller_id,created_at);

      CREATE TABLE IF NOT EXISTS product_photos (
        product_id TEXT PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
        mime_type TEXT NOT NULL,
        original_path TEXT NOT NULL,
        original_size INTEGER NOT NULL CHECK(original_size>=0),
        original_sha256 TEXT NOT NULL,
        thumbnail_path TEXT NOT NULL,
        thumbnail_size INTEGER NOT NULL CHECK(thumbnail_size>=0),
        thumbnail_sha256 TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        FOREIGN KEY(product_id) REFERENCES products(id)
      );
      CREATE INDEX IF NOT EXISTS idx_product_photos_updated ON product_photos(updated_at,product_id);
    `);

    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(COMMERCIAL_MEDIA_SCHEMA_VERSION, COMMERCIAL_MEDIA_MIGRATION_NAME, now());
  });
  return COMMERCIAL_MEDIA_SCHEMA_VERSION;
}

module.exports = {
  COMMERCIAL_MEDIA_SCHEMA_VERSION,
  COMMERCIAL_MEDIA_MIGRATION_NAME,
  runCommercialMediaMigrations
};
