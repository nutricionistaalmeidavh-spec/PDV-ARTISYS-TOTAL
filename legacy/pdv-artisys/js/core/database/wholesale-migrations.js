'use strict';

const { withTransaction }=require('./sqlite-database');

const WHOLESALE_SCHEMA_VERSION=1;
const WHOLESALE_MIGRATION_NAME='product_p3_wholesale_quantity_pricing';

function hasColumn(db,table,column){
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row=>row.name===column);
}

function runWholesaleMigrations(db,now=()=>new Date().toISOString()){
  if(!db)throw new TypeError('db is required.');
  db.exec(`CREATE TABLE IF NOT EXISTS wholesale_schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  if(db.prepare('SELECT 1 FROM wholesale_schema_migrations WHERE version=?').get(WHOLESALE_SCHEMA_VERSION))return WHOLESALE_SCHEMA_VERSION;

  withTransaction(db,()=>{
    db.exec(`CREATE TABLE IF NOT EXISTS wholesale_price_tiers (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      min_quantity REAL NOT NULL CHECK(min_quantity > 0),
      unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id),
      FOREIGN KEY(created_by) REFERENCES users(id),
      UNIQUE(product_id,min_quantity)
    );
    CREATE INDEX IF NOT EXISTS idx_wholesale_tiers_product_quantity ON wholesale_price_tiers(product_id,active,min_quantity DESC);
    `);
    if(!hasColumn(db,'sales_orders','origin'))db.exec("ALTER TABLE sales_orders ADD COLUMN origin TEXT NOT NULL DEFAULT 'STANDARD'");
    if(!hasColumn(db,'sales_orders','order_number')){
      db.exec("ALTER TABLE sales_orders ADD COLUMN order_number TEXT");
      db.exec("UPDATE sales_orders SET order_number='P-'||printf('%06d',rowid) WHERE order_number IS NULL");
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_orders_order_number ON sales_orders(order_number)");
    }
    if(!hasColumn(db,'sales_order_items','pricing_snapshot_json'))db.exec('ALTER TABLE sales_order_items ADD COLUMN pricing_snapshot_json TEXT');
    if(!hasColumn(db,'sales_orders','commercial_policy_snapshot_json'))db.exec('ALTER TABLE sales_orders ADD COLUMN commercial_policy_snapshot_json TEXT');
    db.exec(`CREATE TABLE IF NOT EXISTS wholesale_customer_policies (
      customer_id TEXT PRIMARY KEY,
      minimum_order_cents INTEGER NOT NULL DEFAULT 0 CHECK(minimum_order_cents >= 0),
      allowed_payment_methods_json TEXT NOT NULL DEFAULT '["CASH","PIX","DEBIT_CARD","CREDIT_CARD","STORE_CREDIT"]',
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(customer_id) REFERENCES customers(id),
      FOREIGN KEY(created_by) REFERENCES users(id)
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_sales_orders_origin_status ON sales_orders(origin,status,created_at)');
    const ts=now();
    db.prepare('INSERT INTO wholesale_schema_migrations(version,name,applied_at) VALUES(?,?,?)').run(WHOLESALE_SCHEMA_VERSION,WHOLESALE_MIGRATION_NAME,ts);
  });
  return WHOLESALE_SCHEMA_VERSION;
}

module.exports={WHOLESALE_SCHEMA_VERSION,WHOLESALE_MIGRATION_NAME,runWholesaleMigrations};
