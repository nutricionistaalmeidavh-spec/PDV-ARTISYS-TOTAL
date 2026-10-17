-- Canonical PDV Total commerce storage. Amounts are integer cents; stock is 0.001 units.
-- The immutable inventory movement ledger is the authority; stock_positions is a projection.
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  sale_price_cents INTEGER NOT NULL CHECK(sale_price_cents>=0),
  unit TEXT NOT NULL DEFAULT 'UN',
  track_stock INTEGER NOT NULL DEFAULT 1 CHECK(track_stock IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,sku)
);
CREATE INDEX IF NOT EXISTS idx_products_tenant_active ON products(tenant_id,active,name);

CREATE TABLE IF NOT EXISTS stock_positions (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  balance_milli INTEGER NOT NULL DEFAULT 0 CHECK(balance_milli>=0),
  PRIMARY KEY(tenant_id,branch_id,product_id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  delta_milli INTEGER NOT NULL CHECK(delta_milli<>0),
  type TEXT NOT NULL CHECK(type IN ('opening','purchase','adjustment','sale','return')),
  sale_id TEXT,
  mutation_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id) ON DELETE RESTRICT,
  UNIQUE(tenant_id,branch_id,mutation_id,product_id,type),
  FOREIGN KEY(tenant_id,branch_id,sale_id) REFERENCES sales(tenant_id,branch_id,id) ON DELETE RESTRICT,
  CHECK ((type='sale' AND delta_milli<0 AND sale_id IS NOT NULL)
       OR (type<>'sale' AND sale_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_inventory_movements ON inventory_movements(tenant_id,branch_id,product_id,occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_stock_effect_once ON inventory_movements(tenant_id,branch_id,sale_id,product_id) WHERE type='sale';
CREATE TRIGGER IF NOT EXISTS inventory_movements_immutable_update BEFORE UPDATE ON inventory_movements
BEGIN SELECT RAISE(ABORT,'INVENTORY_LEDGER_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS inventory_movements_immutable_delete BEFORE DELETE ON inventory_movements
BEGIN SELECT RAISE(ABORT,'INVENTORY_LEDGER_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS inventory_project_after_insert AFTER INSERT ON inventory_movements
BEGIN
  -- Never attempt INSERT of a negative provisional balance: SQLite evaluates
  -- CHECK before the UPSERT conflict action, even if a positive row exists.
  INSERT OR IGNORE INTO stock_positions(tenant_id,branch_id,product_id,balance_milli)
  VALUES(NEW.tenant_id,NEW.branch_id,NEW.product_id,0);
  UPDATE stock_positions SET balance_milli=balance_milli + NEW.delta_milli
  WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id AND product_id=NEW.product_id;
END;

CREATE TABLE IF NOT EXISTS cash_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  operator_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK(status IN ('OPEN','CLOSED')),
  opening_cents INTEGER NOT NULL CHECK(opening_cents>=0),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id) ON DELETE RESTRICT,
  UNIQUE(tenant_id,branch_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_open_cash_tenant_branch ON cash_sessions(tenant_id,branch_id) WHERE status='OPEN';
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  operator_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sale_number TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('OPEN','SUSPENDED','COMPLETED','CANCELLED')),
  discount_cents INTEGER NOT NULL DEFAULT 0 CHECK(discount_cents>=0),
  subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK(subtotal_cents>=0),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK(total_cents>=0),
  change_cents INTEGER NOT NULL DEFAULT 0 CHECK(change_cents>=0),
  cash_session_id TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,branch_id,cash_session_id) REFERENCES cash_sessions(tenant_id,branch_id,id) ON DELETE RESTRICT,
  UNIQUE(tenant_id,branch_id,id),
  UNIQUE(tenant_id,branch_id,sale_number)
);
CREATE INDEX IF NOT EXISTS idx_sales_tenant_status ON sales(tenant_id,branch_id,status,created_at);
CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  sku TEXT NOT NULL,
  quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
  unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0),
  created_at TEXT NOT NULL,
  UNIQUE(sale_id,product_id),
  FOREIGN KEY(tenant_id,branch_id,sale_id) REFERENCES sales(tenant_id,branch_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id,created_at);
CREATE TABLE IF NOT EXISTS sale_payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('CASH','PIX','DEBIT_CARD','CREDIT_CARD','OTHER')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  created_at TEXT NOT NULL,
  FOREIGN KEY(tenant_id,branch_id,sale_id) REFERENCES sales(tenant_id,branch_id,id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  cash_session_id TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  method TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  created_at TEXT NOT NULL,
  FOREIGN KEY(tenant_id,branch_id,cash_session_id) REFERENCES cash_sessions(tenant_id,branch_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,branch_id,sale_id) REFERENCES sales(tenant_id,branch_id,id) ON DELETE RESTRICT,
  UNIQUE(tenant_id,branch_id,sale_id,method)
);
CREATE TRIGGER IF NOT EXISTS cash_move_requires_open BEFORE INSERT ON cash_movements
WHEN NOT EXISTS(SELECT 1 FROM cash_sessions c WHERE c.id=NEW.cash_session_id
  AND c.tenant_id=NEW.tenant_id AND c.branch_id=NEW.branch_id AND c.status='OPEN')
BEGIN SELECT RAISE(ABORT,'CASH_SESSION_NOT_OPEN'); END;
CREATE TRIGGER IF NOT EXISTS sale_items_locked_insert BEFORE INSERT ON sale_items
WHEN NOT EXISTS(SELECT 1 FROM sales s WHERE s.id=NEW.sale_id AND s.tenant_id=NEW.tenant_id
  AND s.branch_id=NEW.branch_id AND s.status='OPEN')
BEGIN SELECT RAISE(ABORT,'SALE_NOT_OPEN'); END;
CREATE TRIGGER IF NOT EXISTS sale_items_locked_update BEFORE UPDATE ON sale_items
WHEN NOT EXISTS(SELECT 1 FROM sales s WHERE s.id=OLD.sale_id AND s.tenant_id=OLD.tenant_id
  AND s.branch_id=OLD.branch_id AND s.status='OPEN')
BEGIN SELECT RAISE(ABORT,'SALE_NOT_OPEN'); END;
CREATE TRIGGER IF NOT EXISTS sale_items_locked_delete BEFORE DELETE ON sale_items
WHEN NOT EXISTS(SELECT 1 FROM sales s WHERE s.id=OLD.sale_id AND s.tenant_id=OLD.tenant_id
  AND s.branch_id=OLD.branch_id AND s.status='OPEN')
BEGIN SELECT RAISE(ABORT,'SALE_NOT_OPEN'); END;
CREATE TRIGGER IF NOT EXISTS completed_sales_immutable BEFORE UPDATE ON sales
WHEN OLD.status IN ('COMPLETED','CANCELLED')
BEGIN SELECT RAISE(ABORT,'FINAL_SALE_IMMUTABLE'); END;
CREATE TABLE IF NOT EXISTS commerce_mutations (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  scope TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  result_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,scope,mutation_id)
);
CREATE TABLE IF NOT EXISTS domain_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id) ON DELETE RESTRICT,
  UNIQUE(tenant_id,type,aggregate_id)
);
CREATE TRIGGER IF NOT EXISTS domain_events_immutable_update BEFORE UPDATE ON domain_events
BEGIN SELECT RAISE(ABORT,'DOMAIN_EVENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS domain_events_immutable_delete BEFORE DELETE ON domain_events
BEGIN SELECT RAISE(ABORT,'DOMAIN_EVENT_IMMUTABLE'); END;
