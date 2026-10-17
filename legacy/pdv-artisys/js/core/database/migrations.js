'use strict';

const { withTransaction } = require('./sqlite-database');

const MIGRATIONS = [
  {
    version: 1,
    name: 'pdv_core_e02_e06',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin','manager','cashier')),
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        sku TEXT,
        barcode TEXT,
        name TEXT NOT NULL,
        category_id TEXT,
        unit TEXT NOT NULL DEFAULT 'UN',
        sale_price_cents INTEGER NOT NULL CHECK (sale_price_cents >= 0),
        cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
        track_stock INTEGER NOT NULL DEFAULT 1 CHECK (track_stock IN (0,1)),
        minimum_stock REAL NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
        usage_type TEXT NOT NULL DEFAULT 'DIRECT' CHECK (usage_type IN ('INGREDIENT','DIRECT','BOTH')),
        menu_enabled INTEGER NOT NULL DEFAULT 0 CHECK (menu_enabled IN (0,1)),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (category_id) REFERENCES categories(id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku ON products(sku) WHERE sku IS NOT NULL AND sku <> '';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL AND barcode <> '';
      CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        document TEXT,
        phone TEXT,
        email TEXT,
        notes TEXT,
        credit_limit_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit_cents >= 0),
        credit_used_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_used_cents >= 0),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_document ON customers(document) WHERE document IS NOT NULL AND document <> '';

      CREATE TABLE IF NOT EXISTS suppliers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        document TEXT,
        phone TEXT,
        email TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_document ON suppliers(document) WHERE document IS NOT NULL AND document <> '';

      CREATE TABLE IF NOT EXISTS inventory_balances (
        product_id TEXT PRIMARY KEY,
        quantity REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
        updated_at TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products(id)
      );

      CREATE TABLE IF NOT EXISTS inventory_movements (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('opening','purchase','sale','sale-cancel','adjustment-in','adjustment-out','inventory-count')),
        quantity_delta REAL NOT NULL,
        quantity_before REAL NOT NULL,
        quantity_after REAL NOT NULL CHECK (quantity_after >= 0),
        reason TEXT,
        source_type TEXT,
        source_id TEXT,
        event_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products(id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_event_product ON inventory_movements(event_id,product_id,type) WHERE event_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_inventory_product_created ON inventory_movements(product_id,created_at);

      CREATE TABLE IF NOT EXISTS sales (
        id TEXT PRIMARY KEY,
        sale_number TEXT NOT NULL UNIQUE,
        terminal_id TEXT NOT NULL,
        operator_id TEXT NOT NULL,
        customer_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('OPEN','SUSPENDED','COMPLETED','CANCELLED')),
        subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
        discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
        total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
        change_cents INTEGER NOT NULL DEFAULT 0 CHECK (change_cents >= 0),
        cancel_reason TEXT,
        opened_at TEXT NOT NULL,
        completed_at TEXT,
        cancelled_at TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (operator_id) REFERENCES users(id),
        FOREIGN KEY (customer_id) REFERENCES customers(id)
      );
      CREATE INDEX IF NOT EXISTS idx_sales_status_date ON sales(status,opened_at);
      CREATE INDEX IF NOT EXISTS idx_sales_terminal ON sales(terminal_id,opened_at);

      CREATE TABLE IF NOT EXISTS sale_items (
        id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        sku TEXT,
        quantity REAL NOT NULL CHECK (quantity > 0),
        unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
        total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
      );
      CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);

      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL,
        method TEXT NOT NULL CHECK (method IN ('CASH','PIX','DEBIT_CARD','CREDIT_CARD','STORE_CREDIT','OTHER')),
        amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_payments_sale ON payments(sale_id);

      CREATE TABLE IF NOT EXISTS cash_sessions (
        id TEXT PRIMARY KEY,
        terminal_id TEXT NOT NULL,
        operator_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('OPEN','CLOSED')),
        initial_cash_cents INTEGER NOT NULL DEFAULT 0 CHECK (initial_cash_cents >= 0),
        expected_cash_cents INTEGER,
        counted_cash_cents INTEGER,
        divergence_cents INTEGER,
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        FOREIGN KEY (operator_id) REFERENCES users(id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_open_terminal ON cash_sessions(terminal_id) WHERE status='OPEN';

      CREATE TABLE IF NOT EXISTS cash_movements (
        id TEXT PRIMARY KEY,
        cash_session_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('OPENING','SUPPLY','WITHDRAWAL','SALE','REVERSAL')),
        amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
        payment_method TEXT,
        sale_id TEXT,
        note TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (cash_session_id) REFERENCES cash_sessions(id),
        FOREIGN KEY (sale_id) REFERENCES sales(id)
      );
      CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements(cash_session_id,created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_sale_method ON cash_movements(cash_session_id,sale_id,payment_method,type) WHERE sale_id IS NOT NULL AND type IN ('SALE','REVERSAL');

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT,
        actor_id TEXT,
        actor_role TEXT,
        context_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity,entity_id,created_at);

      CREATE TABLE IF NOT EXISTS domain_events (
        event_id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        mutation_id TEXT,
        source TEXT NOT NULL,
        actor_json TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        dispatched_at TEXT,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_domain_events_pending ON domain_events(dispatched_at,occurred_at);

      CREATE TABLE IF NOT EXISTS domain_event_effects (
        event_id TEXT NOT NULL,
        effect_key TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        PRIMARY KEY (event_id,effect_key)
      );
    `
  },
  {
    version: 2,
    name: 'pdv_operational_e13_e20',
    sql: `
      CREATE TABLE IF NOT EXISTS return_transactions (
        id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL,
        terminal_id TEXT NOT NULL,
        operator_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('COMPLETED','CANCELLED')),
        total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
        reason TEXT,
        authorized_by_id TEXT,
        created_at TEXT NOT NULL,
        cancelled_at TEXT,
        FOREIGN KEY (sale_id) REFERENCES sales(id),
        FOREIGN KEY (operator_id) REFERENCES users(id),
        FOREIGN KEY (authorized_by_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_returns_sale_created ON return_transactions(sale_id,created_at);
      CREATE INDEX IF NOT EXISTS idx_returns_status_created ON return_transactions(status,created_at);

      CREATE TABLE IF NOT EXISTS return_items (
        id TEXT PRIMARY KEY,
        return_id TEXT NOT NULL,
        sale_item_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        quantity REAL NOT NULL CHECK (quantity > 0),
        unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
        total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
        created_at TEXT NOT NULL,
        FOREIGN KEY (return_id) REFERENCES return_transactions(id) ON DELETE CASCADE,
        FOREIGN KEY (sale_item_id) REFERENCES sale_items(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      );
      CREATE INDEX IF NOT EXISTS idx_return_items_return ON return_items(return_id);
      CREATE INDEX IF NOT EXISTS idx_return_items_sale_item ON return_items(sale_item_id);

      CREATE TABLE IF NOT EXISTS financial_accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT 'OTHER' CHECK (type IN ('CASH','BANK','CARD','OTHER')),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS financial_entries (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('PAYABLE','RECEIVABLE')),
        description TEXT NOT NULL,
        category TEXT,
        account_id TEXT,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        due_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PARTIAL','SETTLED','CANCELLED')),
        source_type TEXT,
        source_id TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        cancelled_at TEXT,
        FOREIGN KEY (account_id) REFERENCES financial_accounts(id)
      );
      CREATE INDEX IF NOT EXISTS idx_financial_entries_due_status ON financial_entries(status,due_at);
      CREATE INDEX IF NOT EXISTS idx_financial_entries_kind_due ON financial_entries(kind,due_at);
      CREATE INDEX IF NOT EXISTS idx_financial_entries_source ON financial_entries(source_type,source_id);

      CREATE TABLE IF NOT EXISTS financial_settlements (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        method TEXT,
        note TEXT,
        created_at TEXT NOT NULL,
        reversed_at TEXT,
        FOREIGN KEY (entry_id) REFERENCES financial_entries(id)
      );
      CREATE INDEX IF NOT EXISTS idx_financial_settlements_entry ON financial_settlements(entry_id,created_at);

      CREATE TABLE IF NOT EXISTS print_jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        payload_json TEXT NOT NULL,
        width INTEGER NOT NULL DEFAULT 42 CHECK (width IN (32,42,48)),
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PRINTED','FAILED','CANCELLED')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        printed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_print_jobs_status_created ON print_jobs(status,created_at);
      CREATE INDEX IF NOT EXISTS idx_print_jobs_entity ON print_jobs(entity_type,entity_id,created_at);

      CREATE TABLE IF NOT EXISTS device_settings (
        id TEXT PRIMARY KEY,
        terminal_id TEXT NOT NULL,
        device_type TEXT NOT NULL,
        config_json TEXT NOT NULL DEFAULT '{}',
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (terminal_id,device_type)
      );
      CREATE INDEX IF NOT EXISTS idx_device_settings_terminal ON device_settings(terminal_id,device_type);
    `
  },
  {
    version: 3,
    name: 'pdv_lan_e21',
    sql: `
      CREATE TABLE IF NOT EXISTS terminals (
        terminal_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE,
        credential_hash TEXT NOT NULL,
        credential_salt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','BLOCKED')),
        app_version TEXT NOT NULL,
        last_seen_at TEXT,
        paired_at TEXT NOT NULL,
        paired_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_terminals_status_seen ON terminals(status,last_seen_at);

      CREATE TABLE IF NOT EXISTS pairing_codes (
        id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL,
        code_salt TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        used_by_terminal_id TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pairing_codes_expiry ON pairing_codes(used_at,expires_at);

      CREATE TABLE IF NOT EXISTS processed_mutations (
        mutation_id TEXT PRIMARY KEY,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_processed_mutations_completed ON processed_mutations(completed_at);
    `
  }
];

const CURRENT_SCHEMA_VERSION = MIGRATIONS.at(-1).version;

function runMigrations(db, now = () => new Date().toISOString()) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const current = db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get().version;
  for (const migration of MIGRATIONS.filter(item => item.version > current)) {
    withTransaction(db, () => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)')
        .run(migration.version, migration.name, now());
    });
  }
  return CURRENT_SCHEMA_VERSION;
}

module.exports = { MIGRATIONS, CURRENT_SCHEMA_VERSION, runMigrations };
