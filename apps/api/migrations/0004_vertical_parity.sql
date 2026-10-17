-- P7 web vertical persistence: scoped, canonical tenant/branch records.
-- A quote and a restaurant order are operational documents, never a second sale.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS customers (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
 name TEXT NOT NULL, document TEXT, phone TEXT, email TEXT, address TEXT,
 credit_limit_cents INTEGER NOT NULL DEFAULT 0 CHECK(credit_limit_cents>=0),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,document)
);
CREATE INDEX IF NOT EXISTS idx_web_customers ON customers(tenant_id,active,name);
CREATE TABLE IF NOT EXISTS suppliers (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
 name TEXT NOT NULL, document TEXT, phone TEXT, email TEXT, address TEXT,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,document)
);
CREATE INDEX IF NOT EXISTS idx_web_suppliers ON suppliers(tenant_id,active,name);
-- Sellers are active tenant members / user identities; do not replicate users.
ALTER TABLE sales ADD COLUMN seller_id TEXT REFERENCES users(id);
ALTER TABLE sales ADD COLUMN customer_id TEXT;
CREATE TABLE IF NOT EXISTS seller_commission_rules (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL, seller_id TEXT NOT NULL REFERENCES users(id),
 product_id TEXT, commission_bps INTEGER NOT NULL CHECK(commission_bps BETWEEN 0 AND 10000),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id),
 UNIQUE(tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_global ON seller_commission_rules(tenant_id,seller_id) WHERE product_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_product ON seller_commission_rules(tenant_id,seller_id,product_id) WHERE product_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS seller_commission_ledger (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
 seller_id TEXT NOT NULL REFERENCES users(id), sale_id TEXT, sale_item_id TEXT,
 kind TEXT NOT NULL CHECK(kind IN('EARNED','REVERSED','PAID')),
 amount_cents INTEGER NOT NULL, reference_key TEXT NOT NULL, occurred_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
 UNIQUE(tenant_id,reference_key)
);
CREATE TRIGGER IF NOT EXISTS commission_ledger_no_update BEFORE UPDATE ON seller_commission_ledger BEGIN SELECT RAISE(ABORT,'COMMISSION_LEDGER_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS commission_ledger_no_delete BEFORE DELETE ON seller_commission_ledger BEGIN SELECT RAISE(ABORT,'COMMISSION_LEDGER_IMMUTABLE'); END;
CREATE TABLE IF NOT EXISTS restaurant_tables (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 label TEXT NOT NULL,seats INTEGER NOT NULL DEFAULT 4 CHECK(seats BETWEEN 0 AND 1000),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
 UNIQUE(tenant_id,branch_id,id), UNIQUE(tenant_id,branch_id,label)
);
CREATE TABLE IF NOT EXISTS restaurant_table_sessions (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,table_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('OPEN','CHECKOUT','CLOSED')),
 party_size INTEGER NOT NULL CHECK(party_size BETWEEN 1 AND 1000),
 customer_id TEXT,opened_by TEXT NOT NULL REFERENCES users(id),
 opened_at TEXT NOT NULL,closed_at TEXT,
 FOREIGN KEY(tenant_id,branch_id,table_id) REFERENCES restaurant_tables(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
 UNIQUE(tenant_id,branch_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_open_restaurant_table ON restaurant_table_sessions(tenant_id,branch_id,table_id) WHERE status IN('OPEN','CHECKOUT');
CREATE TABLE IF NOT EXISTS restaurant_orders (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 table_session_id TEXT,customer_id TEXT,fulfillment TEXT NOT NULL CHECK(fulfillment IN('TABLE','DELIVERY','PICKUP')),
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','READY','DELIVERED','CANCELLED')),
 address TEXT,contact TEXT,note TEXT,total_cents INTEGER NOT NULL CHECK(total_cents>=0),
 created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
 FOREIGN KEY(tenant_id,branch_id,table_session_id) REFERENCES restaurant_table_sessions(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
 UNIQUE(tenant_id,branch_id,id),
 CHECK((fulfillment='TABLE' AND table_session_id IS NOT NULL) OR (fulfillment<>'TABLE' AND table_session_id IS NULL)),
 CHECK(fulfillment<>'DELIVERY' OR length(trim(address))>0)
);
CREATE TABLE IF NOT EXISTS restaurant_order_items (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,order_id TEXT NOT NULL,
 product_id TEXT NOT NULL,product_name TEXT NOT NULL,quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0),
 FOREIGN KEY(tenant_id,branch_id,order_id) REFERENCES restaurant_orders(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS restaurant_kitchen_tickets (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,order_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('NEW','PREPARING','READY','CANCELLED')),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,branch_id,order_id) REFERENCES restaurant_orders(tenant_id,branch_id,id),
 UNIQUE(tenant_id,branch_id,order_id)
);
CREATE INDEX IF NOT EXISTS idx_kitchen_queue ON restaurant_kitchen_tickets(tenant_id,branch_id,status,created_at);
CREATE TABLE IF NOT EXISTS wholesale_tiers (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,product_id TEXT NOT NULL,
 min_quantity_milli INTEGER NOT NULL CHECK(min_quantity_milli>0),
 unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id),
 UNIQUE(tenant_id,branch_id,product_id,min_quantity_milli)
);
CREATE TABLE IF NOT EXISTS wholesale_customer_policies (
 tenant_id TEXT NOT NULL,customer_id TEXT NOT NULL,
 minimum_order_cents INTEGER NOT NULL DEFAULT 0 CHECK(minimum_order_cents>=0),
 allowed_payment_methods_json TEXT NOT NULL DEFAULT '["CASH","PIX","DEBIT_CARD","CREDIT_CARD"]',
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 PRIMARY KEY(tenant_id,customer_id),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS wholesale_orders (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 customer_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'QUOTE' CHECK(status IN('QUOTE','CONFIRMED','CANCELLED','FULFILLED')),
 total_cents INTEGER NOT NULL CHECK(total_cents>=0),fulfillment TEXT NOT NULL DEFAULT 'PICKUP' CHECK(fulfillment IN('PICKUP','DELIVERY')),
 expected_at TEXT,created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
 UNIQUE(tenant_id,branch_id,id)
);
CREATE TABLE IF NOT EXISTS wholesale_order_items (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,order_id TEXT NOT NULL,
 product_id TEXT NOT NULL,quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0),
 tier_id TEXT,created_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,branch_id,order_id) REFERENCES wholesale_orders(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE TRIGGER IF NOT EXISTS wholesale_items_immutable_update BEFORE UPDATE ON wholesale_order_items BEGIN SELECT RAISE(ABORT,'QUOTE_PRICING_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS wholesale_items_immutable_delete BEFORE DELETE ON wholesale_order_items BEGIN SELECT RAISE(ABORT,'QUOTE_PRICING_IMMUTABLE'); END;
-- Credit is a derived ledger connected to real completed sales, not a separate cash balance.
CREATE TABLE IF NOT EXISTS customer_credit_ledger (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 customer_id TEXT NOT NULL, sale_id TEXT,
 type TEXT NOT NULL CHECK(type IN('CHARGE','PAYMENT','REVERSAL')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents<>0),
 reference_key TEXT NOT NULL,occurred_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
 FOREIGN KEY(tenant_id,branch_id,sale_id) REFERENCES sales(tenant_id,branch_id,id),
 UNIQUE(tenant_id,reference_key)
);
CREATE TRIGGER IF NOT EXISTS credit_ledger_immutable_update BEFORE UPDATE ON customer_credit_ledger BEGIN SELECT RAISE(ABORT,'CREDIT_LEDGER_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS credit_ledger_immutable_delete BEFORE DELETE ON customer_credit_ledger BEGIN SELECT RAISE(ABORT,'CREDIT_LEDGER_IMMUTABLE'); END;

-- Concurrent credit charges are checked inside the same serialized SQLite/D1 write transaction.
CREATE TRIGGER IF NOT EXISTS credit_limit_guard BEFORE INSERT ON customer_credit_ledger
WHEN NEW.type='CHARGE' AND
  (SELECT COALESCE(SUM(l.amount_cents),0) FROM customer_credit_ledger l WHERE l.tenant_id=NEW.tenant_id AND l.customer_id=NEW.customer_id)
   + NEW.amount_cents > (SELECT c.credit_limit_cents FROM customers c WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.customer_id)
BEGIN SELECT RAISE(ABORT,'CREDIT_LIMIT_EXCEEDED'); END;
