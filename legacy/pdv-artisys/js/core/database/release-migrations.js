'use strict';

const { withTransaction } = require('./sqlite-database');

const RELEASE_SCHEMA_VERSION = 5;
const RELEASE_MIGRATION_NAME = 'pdv_restaurant_e30_e34';

const RELEASE_SQL = `
  CREATE TABLE IF NOT EXISTS app_settings (
    scope TEXT NOT NULL,
    setting_key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    value_type TEXT NOT NULL,
    updated_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (scope,setting_key)
  );
  CREATE INDEX IF NOT EXISTS idx_app_settings_key ON app_settings(setting_key,scope);

  CREATE TABLE IF NOT EXISTS backup_records (
    id TEXT PRIMARY KEY,
    file_path TEXT NOT NULL,
    manifest_path TEXT NOT NULL,
    reason TEXT NOT NULL,
    app_version TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    valid INTEGER NOT NULL DEFAULT 0 CHECK (valid IN (0,1)),
    created_at TEXT NOT NULL,
    validated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_backup_records_created ON backup_records(created_at);

  CREATE TABLE IF NOT EXISTS import_batches (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    format TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    collision_policy TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN('PREVIEWED','COMMITTED','FAILED')),
    rows_json TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    committed_at TEXT,
    committed_by TEXT,
    UNIQUE(type,format,content_hash,collision_policy)
  );
  CREATE INDEX IF NOT EXISTS idx_import_batches_status_created ON import_batches(status,created_at);

  CREATE TABLE IF NOT EXISTS import_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL,
    row_number INTEGER NOT NULL,
    message TEXT NOT NULL,
    row_json TEXT,
    FOREIGN KEY(batch_id) REFERENCES import_batches(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_import_errors_batch ON import_errors(batch_id,row_number);

  CREATE TABLE IF NOT EXISTS system_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL CHECK(level IN('debug','info','warn','error')),
    subsystem TEXT NOT NULL,
    message TEXT NOT NULL,
    correlation_id TEXT,
    terminal_id TEXT,
    context_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_system_logs_filter ON system_logs(level,subsystem,terminal_id,created_at);

  CREATE TABLE IF NOT EXISTS pilot_checks (
    check_key TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    optional INTEGER NOT NULL DEFAULT 0 CHECK(optional IN(0,1)),
    status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK(status IN('NOT_STARTED','IN_PROGRESS','READY','BLOCKED','BLOCKED_EXTERNAL')),
    note TEXT,
    evidence_json TEXT,
    updated_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pilot_checks_status ON pilot_checks(status,category);
`;

const RESTAURANT_SQL = `
  CREATE TABLE IF NOT EXISTS restaurant_tables (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL UNIQUE,
    seats INTEGER NOT NULL DEFAULT 0 CHECK(seats >= 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_restaurant_tables_active_sort ON restaurant_tables(active,sort_order,label);

  CREATE TABLE IF NOT EXISTS table_sessions (
    id TEXT PRIMARY KEY,
    table_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN('OPEN','CHECKOUT','CLOSED')),
    opened_by TEXT,
    checkout_sale_id TEXT UNIQUE,
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(table_id) REFERENCES restaurant_tables(id),
    FOREIGN KEY(opened_by) REFERENCES users(id),
    FOREIGN KEY(checkout_sale_id) REFERENCES sales(id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_table_active_session ON table_sessions(table_id) WHERE status IN('OPEN','CHECKOUT');
  CREATE INDEX IF NOT EXISTS idx_table_sessions_status_opened ON table_sessions(status,opened_at);

  CREATE TABLE IF NOT EXISTS restaurant_orders (
    id TEXT PRIMARY KEY,
    table_session_id TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN('DESKTOP','WAITER','TABLE')),
    device_id TEXT,
    created_by TEXT,
    status TEXT NOT NULL CHECK(status IN('NEW','PREPARING','READY','SERVED','CANCELLED')),
    note TEXT,
    total_cents INTEGER NOT NULL DEFAULT 0 CHECK(total_cents >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(table_session_id) REFERENCES table_sessions(id),
    FOREIGN KEY(created_by) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_restaurant_orders_session ON restaurant_orders(table_session_id,created_at);
  CREATE INDEX IF NOT EXISTS idx_restaurant_orders_status ON restaurant_orders(status,created_at);

  CREATE TABLE IF NOT EXISTS restaurant_order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    quantity REAL NOT NULL CHECK(quantity > 0),
    unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
    total_cents INTEGER NOT NULL CHECK(total_cents >= 0),
    note TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(order_id) REFERENCES restaurant_orders(id) ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES products(id)
  );
  CREATE INDEX IF NOT EXISTS idx_restaurant_order_items_order ON restaurant_order_items(order_id);

  CREATE TABLE IF NOT EXISTS service_requests (
    id TEXT PRIMARY KEY,
    table_session_id TEXT NOT NULL,
    request_type TEXT NOT NULL CHECK(request_type IN('WAITER','BILL')),
    status TEXT NOT NULL CHECK(status IN('OPEN','ACKNOWLEDGED','CLOSED')),
    device_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(table_session_id) REFERENCES table_sessions(id)
  );
  CREATE INDEX IF NOT EXISTS idx_service_requests_open ON service_requests(status,request_type,created_at);

  CREATE TABLE IF NOT EXISTS kitchen_stations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    printer_name TEXT,
    print_enabled INTEGER NOT NULL DEFAULT 1 CHECK(print_enabled IN(0,1)),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS product_kitchen_stations (
    product_id TEXT PRIMARY KEY,
    station_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY(station_id) REFERENCES kitchen_stations(id)
  );

  CREATE TABLE IF NOT EXISTS kitchen_tickets (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    station_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN('NEW','PREPARING','READY','CANCELLED')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(order_id,station_id),
    FOREIGN KEY(order_id) REFERENCES restaurant_orders(id) ON DELETE CASCADE,
    FOREIGN KEY(station_id) REFERENCES kitchen_stations(id)
  );
  CREATE INDEX IF NOT EXISTS idx_kitchen_tickets_status ON kitchen_tickets(status,station_id,created_at);

  CREATE TABLE IF NOT EXISTS kitchen_ticket_items (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    order_item_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    quantity REAL NOT NULL CHECK(quantity > 0),
    note TEXT,
    FOREIGN KEY(ticket_id) REFERENCES kitchen_tickets(id) ON DELETE CASCADE,
    FOREIGN KEY(order_item_id) REFERENCES restaurant_order_items(id)
  );
  CREATE INDEX IF NOT EXISTS idx_kitchen_ticket_items_ticket ON kitchen_ticket_items(ticket_id);

  CREATE TABLE IF NOT EXISTS mobile_devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    device_type TEXT NOT NULL CHECK(device_type IN('WAITER','KITCHEN')),
    table_id TEXT,
    user_id TEXT,
    credential_hash TEXT NOT NULL,
    credential_salt TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN('ACTIVE','BLOCKED')),
    last_seen_at TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(table_id) REFERENCES restaurant_tables(id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(created_by) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_mobile_devices_status_type ON mobile_devices(status,device_type,name);
`;

const RELEASE_MIGRATIONS = Object.freeze([
  { version:4, name:'pdv_release_e22_e29', sql:RELEASE_SQL },
  { version:5, name:RELEASE_MIGRATION_NAME, sql:RESTAURANT_SQL }
]);

function runReleaseMigrations(db, now = () => new Date().toISOString()) {
  if (!db) throw new TypeError('Database is required.');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  let current = Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get()?.version || 0);
  for (const migration of RELEASE_MIGRATIONS) {
    if (current >= migration.version) continue;
    withTransaction(db, () => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)').run(migration.version,migration.name,now());
    });
    current = migration.version;
  }
  return RELEASE_SCHEMA_VERSION;
}

module.exports = {
  RELEASE_SCHEMA_VERSION,
  RELEASE_MIGRATION_NAME,
  RELEASE_SQL,
  RESTAURANT_SQL,
  RELEASE_MIGRATIONS,
  runReleaseMigrations
};
