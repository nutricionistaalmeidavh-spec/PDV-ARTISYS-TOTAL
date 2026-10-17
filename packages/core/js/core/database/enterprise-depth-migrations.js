'use strict';

const { withTransaction } = require('./sqlite-database');

const ENTERPRISE_DEPTH_SCHEMA_VERSION = 1;
const ENTERPRISE_DEPTH_MIGRATION_NAME = 'enterprise_depth_p0';

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
}

function runEnterpriseDepthMigrations(db, now = () => new Date().toISOString()) {
  if (!db) throw new TypeError('Database is required.');

  db.exec(`CREATE TABLE IF NOT EXISTS enterprise_depth_schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  if (db.prepare('SELECT 1 FROM enterprise_depth_schema_migrations WHERE version=?').get(ENTERPRISE_DEPTH_SCHEMA_VERSION)) {
    return ENTERPRISE_DEPTH_SCHEMA_VERSION;
  }

  withTransaction(db, () => {
    if (!hasColumn(db, 'inventory_movements', 'location_id')) {
      db.exec('ALTER TABLE inventory_movements ADD COLUMN location_id TEXT');
    }
    if (!hasColumn(db, 'sales', 'stock_location_id')) {
      db.exec('ALTER TABLE sales ADD COLUMN stock_location_id TEXT');
    }
    if (!hasColumn(db, 'sale_items', 'cost_cents_snapshot')) {
      db.exec('ALTER TABLE sale_items ADD COLUMN cost_cents_snapshot INTEGER CHECK(cost_cents_snapshot IS NULL OR cost_cents_snapshot >= 0)');
    }
    if (!hasColumn(db, 'sale_items', 'cost_snapshot_source')) {
      db.exec("ALTER TABLE sale_items ADD COLUMN cost_snapshot_source TEXT CHECK(cost_snapshot_source IS NULL OR cost_snapshot_source IN('PRODUCT','VARIANT','ESTIMATED_CURRENT'))");
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS stock_locations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT 'OTHER' CHECK(type IN('STORE','WAREHOUSE','INTERNAL','OTHER')),
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inventory_location_balances (
        product_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 0 CHECK(quantity >= 0),
        updated_at TEXT NOT NULL,
        PRIMARY KEY(product_id,location_id),
        FOREIGN KEY(product_id) REFERENCES products(id),
        FOREIGN KEY(location_id) REFERENCES stock_locations(id)
      );
      CREATE INDEX IF NOT EXISTS idx_inventory_location_product ON inventory_location_balances(product_id,location_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_location_location ON inventory_location_balances(location_id,product_id);

      CREATE TABLE IF NOT EXISTS terminal_stock_locations (
        terminal_id TEXT PRIMARY KEY,
        location_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(location_id) REFERENCES stock_locations(id)
      );
      CREATE INDEX IF NOT EXISTS idx_terminal_stock_location ON terminal_stock_locations(location_id,terminal_id);

      CREATE TABLE IF NOT EXISTS inventory_reservations (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        quantity REAL NOT NULL CHECK(quantity > 0),
        consumed_quantity REAL NOT NULL DEFAULT 0 CHECK(consumed_quantity >= 0 AND consumed_quantity <= quantity),
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        bound_sale_id TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','RELEASED','CONSUMED','CANCELLED')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        released_at TEXT,
        consumed_at TEXT,
        cancelled_at TEXT,
        FOREIGN KEY(product_id) REFERENCES products(id),
        FOREIGN KEY(location_id) REFERENCES stock_locations(id),
        FOREIGN KEY(bound_sale_id) REFERENCES sales(id),
        UNIQUE(source_type,source_id,product_id,location_id)
      );
      CREATE INDEX IF NOT EXISTS idx_inventory_reservation_active ON inventory_reservations(product_id,location_id,status);
      CREATE INDEX IF NOT EXISTS idx_inventory_reservation_source ON inventory_reservations(source_type,source_id,status);
      CREATE INDEX IF NOT EXISTS idx_inventory_reservation_sale ON inventory_reservations(bound_sale_id,status);

      CREATE TABLE IF NOT EXISTS purchase_orders (
        id TEXT PRIMARY KEY,
        supplier_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','ORDERED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')),
        expected_at TEXT,
        notes TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        ordered_at TEXT,
        cancelled_at TEXT,
        FOREIGN KEY(supplier_id) REFERENCES suppliers(id),
        FOREIGN KEY(location_id) REFERENCES stock_locations(id),
        FOREIGN KEY(created_by) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_purchase_orders_status_date ON purchase_orders(status,created_at);
      CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id,created_at);

      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        quantity REAL NOT NULL CHECK(quantity > 0),
        unit_cost_cents INTEGER NOT NULL CHECK(unit_cost_cents >= 0),
        received_quantity REAL NOT NULL DEFAULT 0 CHECK(received_quantity >= 0 AND received_quantity <= quantity),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
        FOREIGN KEY(product_id) REFERENCES products(id),
        UNIQUE(order_id,product_id)
      );
      CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order ON purchase_order_items(order_id,product_id);

      CREATE TABLE IF NOT EXISTS purchase_receipts (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        received_at TEXT NOT NULL,
        total_cents INTEGER NOT NULL DEFAULT 0 CHECK(total_cents >= 0),
        payable_entry_id TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(order_id) REFERENCES purchase_orders(id),
        FOREIGN KEY(payable_entry_id) REFERENCES financial_entries(id),
        FOREIGN KEY(created_by) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_purchase_receipts_order_date ON purchase_receipts(order_id,received_at);

      CREATE TABLE IF NOT EXISTS purchase_receipt_items (
        id TEXT PRIMARY KEY,
        receipt_id TEXT NOT NULL,
        order_item_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        quantity REAL NOT NULL CHECK(quantity > 0),
        unit_cost_cents INTEGER NOT NULL CHECK(unit_cost_cents >= 0),
        total_cents INTEGER NOT NULL CHECK(total_cents >= 0),
        created_at TEXT NOT NULL,
        FOREIGN KEY(receipt_id) REFERENCES purchase_receipts(id) ON DELETE CASCADE,
        FOREIGN KEY(order_item_id) REFERENCES purchase_order_items(id),
        FOREIGN KEY(product_id) REFERENCES products(id),
        UNIQUE(receipt_id,order_item_id)
      );
      CREATE INDEX IF NOT EXISTS idx_purchase_receipt_items_receipt ON purchase_receipt_items(receipt_id,order_item_id);

      CREATE TABLE IF NOT EXISTS stock_transfers (
        id TEXT PRIMARY KEY,
        from_location_id TEXT NOT NULL,
        to_location_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','IN_TRANSIT','RECEIVED','CANCELLED')),
        dispatch_idempotency_key TEXT UNIQUE,
        receive_idempotency_key TEXT UNIQUE,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        dispatched_at TEXT,
        received_at TEXT,
        cancelled_at TEXT,
        cancel_reason TEXT,
        CHECK(from_location_id <> to_location_id),
        FOREIGN KEY(from_location_id) REFERENCES stock_locations(id),
        FOREIGN KEY(to_location_id) REFERENCES stock_locations(id),
        FOREIGN KEY(created_by) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_stock_transfers_status_date ON stock_transfers(status,created_at);
      CREATE INDEX IF NOT EXISTS idx_stock_transfers_locations ON stock_transfers(from_location_id,to_location_id,status);

      CREATE TABLE IF NOT EXISTS stock_transfer_items (
        id TEXT PRIMARY KEY,
        transfer_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        quantity REAL NOT NULL CHECK(quantity > 0),
        created_at TEXT NOT NULL,
        FOREIGN KEY(transfer_id) REFERENCES stock_transfers(id) ON DELETE CASCADE,
        FOREIGN KEY(product_id) REFERENCES products(id),
        UNIQUE(transfer_id,product_id)
      );
      CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer ON stock_transfer_items(transfer_id,product_id);

      CREATE TABLE IF NOT EXISTS sales_orders (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        fulfillment_type TEXT NOT NULL DEFAULT 'PICKUP' CHECK(fulfillment_type IN('PICKUP','DELIVERY')),
        status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','QUOTED','CONFIRMED','PARTIALLY_FULFILLED','FULFILLED','CANCELLED')),
        expected_at TEXT,
        notes TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        quoted_at TEXT,
        confirmed_at TEXT,
        fulfilled_at TEXT,
        cancelled_at TEXT,
        cancel_reason TEXT,
        FOREIGN KEY(customer_id) REFERENCES customers(id),
        FOREIGN KEY(location_id) REFERENCES stock_locations(id),
        FOREIGN KEY(created_by) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_sales_orders_status_date ON sales_orders(status,created_at);
      CREATE INDEX IF NOT EXISTS idx_sales_orders_customer ON sales_orders(customer_id,created_at);

      CREATE TABLE IF NOT EXISTS sales_order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        quantity REAL NOT NULL CHECK(quantity > 0),
        unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
        fulfilled_quantity REAL NOT NULL DEFAULT 0 CHECK(fulfilled_quantity >= 0 AND fulfilled_quantity <= quantity),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(order_id) REFERENCES sales_orders(id) ON DELETE CASCADE,
        FOREIGN KEY(product_id) REFERENCES products(id),
        UNIQUE(order_id,product_id)
      );
      CREATE INDEX IF NOT EXISTS idx_sales_order_items_order ON sales_order_items(order_id,product_id);

      CREATE TABLE IF NOT EXISTS sales_order_fulfillments (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        sale_id TEXT UNIQUE,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','COMPLETED','FAILED')),
        terminal_id TEXT,
        operator_id TEXT,
        seller_id TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY(order_id) REFERENCES sales_orders(id),
        FOREIGN KEY(sale_id) REFERENCES sales(id),
        FOREIGN KEY(operator_id) REFERENCES users(id),
        FOREIGN KEY(seller_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_sales_order_fulfillments_order ON sales_order_fulfillments(order_id,created_at);

      CREATE TABLE IF NOT EXISTS sales_order_fulfillment_items (
        id TEXT PRIMARY KEY,
        fulfillment_id TEXT NOT NULL,
        order_item_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        quantity REAL NOT NULL CHECK(quantity > 0),
        unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
        created_at TEXT NOT NULL,
        FOREIGN KEY(fulfillment_id) REFERENCES sales_order_fulfillments(id) ON DELETE CASCADE,
        FOREIGN KEY(order_item_id) REFERENCES sales_order_items(id),
        FOREIGN KEY(product_id) REFERENCES products(id),
        UNIQUE(fulfillment_id,order_item_id)
      );
      CREATE INDEX IF NOT EXISTS idx_sales_order_fulfillment_items_fulfillment ON sales_order_fulfillment_items(fulfillment_id,order_item_id);
    `);

    const timestamp = now();
    db.prepare(`INSERT OR IGNORE INTO stock_locations(id,name,type,active,created_at,updated_at)
      VALUES('MAIN','Estoque principal','STORE',1,?,?)`).run(timestamp,timestamp);

    db.exec(`INSERT OR IGNORE INTO inventory_location_balances(product_id,location_id,quantity,updated_at)
      SELECT product_id,'MAIN',quantity,updated_at FROM inventory_balances`);
    db.exec("UPDATE inventory_movements SET location_id='MAIN' WHERE location_id IS NULL OR location_id=''");
    db.exec("UPDATE sales SET stock_location_id='MAIN' WHERE stock_location_id IS NULL OR stock_location_id=''");

    db.prepare('INSERT INTO enterprise_depth_schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(ENTERPRISE_DEPTH_SCHEMA_VERSION,ENTERPRISE_DEPTH_MIGRATION_NAME,timestamp);
  });

  return ENTERPRISE_DEPTH_SCHEMA_VERSION;
}

module.exports = {
  ENTERPRISE_DEPTH_SCHEMA_VERSION,
  ENTERPRISE_DEPTH_MIGRATION_NAME,
  runEnterpriseDepthMigrations
};
