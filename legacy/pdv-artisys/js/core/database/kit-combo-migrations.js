'use strict';

const { withTransaction } = require('./sqlite-database');

const KIT_COMBO_SCHEMA_VERSION = 1;

function runKitComboMigrations(db, now = () => new Date().toISOString()) {
  if (!db) throw new TypeError('Database is required.');
  db.exec(`CREATE TABLE IF NOT EXISTS kit_combo_schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  if (db.prepare('SELECT 1 FROM kit_combo_schema_migrations WHERE version=?').get(KIT_COMBO_SCHEMA_VERSION)) return;

  withTransaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS product_kits (
        product_id TEXT PRIMARY KEY,
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS promotional_combo_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        selection_mode TEXT NOT NULL CHECK(selection_mode IN('SAME_PRODUCT','ANY_SELECTED')),
        required_quantity INTEGER NOT NULL CHECK(required_quantity>=2),
        bundle_price_cents INTEGER NOT NULL CHECK(bundle_price_cents>=0),
        max_applications_per_sale INTEGER CHECK(max_applications_per_sale IS NULL OR max_applications_per_sale>=1),
        allow_manual_discount INTEGER NOT NULL DEFAULT 1 CHECK(allow_manual_discount IN(0,1)),
        starts_at TEXT,
        ends_at TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_promotional_combo_active_period ON promotional_combo_rules(active,starts_at,ends_at);

      CREATE TABLE IF NOT EXISTS promotional_combo_products (
        combo_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        PRIMARY KEY(combo_id,product_id),
        FOREIGN KEY(combo_id) REFERENCES promotional_combo_rules(id) ON DELETE CASCADE,
        FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_promotional_combo_product ON promotional_combo_products(product_id,combo_id);

      CREATE TABLE IF NOT EXISTS sale_discount_states (
        sale_id TEXT PRIMARY KEY,
        manual_discount_cents INTEGER NOT NULL DEFAULT 0 CHECK(manual_discount_cents>=0),
        promotion_discount_cents INTEGER NOT NULL DEFAULT 0 CHECK(promotion_discount_cents>=0),
        promotions_json TEXT NOT NULL DEFAULT '[]',
        blocks_manual_discount INTEGER NOT NULL DEFAULT 0 CHECK(blocks_manual_discount IN(0,1)),
        updated_at TEXT NOT NULL,
        FOREIGN KEY(sale_id) REFERENCES sales(id) ON DELETE CASCADE
      );
    `);
    db.prepare('INSERT INTO kit_combo_schema_migrations(version,name,applied_at) VALUES (?,?,?)')
      .run(KIT_COMBO_SCHEMA_VERSION, 'kits_and_promotional_combos_v1', now());
  });
}

module.exports = { KIT_COMBO_SCHEMA_VERSION, runKitComboMigrations };
