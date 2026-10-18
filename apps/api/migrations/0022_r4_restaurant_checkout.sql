-- R4: financial settlement is a link to the only canonical sales ledger.
-- Neither table sessions nor delivery documents create independent payments/stock.
CREATE TABLE IF NOT EXISTS restaurant_sale_links (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 branch_id TEXT NOT NULL,
 table_session_id TEXT,
 order_id TEXT,
 sale_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,branch_id,table_session_id) REFERENCES restaurant_table_sessions(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id,order_id) REFERENCES restaurant_orders(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id,sale_id) REFERENCES sales(tenant_id,branch_id,id),
 CHECK ((table_session_id IS NOT NULL AND order_id IS NULL) OR (table_session_id IS NULL AND order_id IS NOT NULL)),
 UNIQUE(tenant_id,branch_id,sale_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_r4_checkout_one_session ON restaurant_sale_links(tenant_id,branch_id,table_session_id) WHERE table_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_r4_checkout_one_order ON restaurant_sale_links(tenant_id,branch_id,order_id) WHERE order_id IS NOT NULL;
-- When the cart is built from restaurant order snapshots, cashier may tender it
-- but cannot change quantities or prices (and silently diverge from the comanda).
CREATE TRIGGER IF NOT EXISTS r4_snapshot_locked_insert BEFORE INSERT ON sale_items
WHEN EXISTS(SELECT 1 FROM restaurant_sale_links l WHERE l.sale_id=NEW.sale_id AND l.tenant_id=NEW.tenant_id AND l.branch_id=NEW.branch_id)
BEGIN SELECT RAISE(ABORT,'RESTAURANT_SALE_SNAPSHOT_LOCKED'); END;
CREATE TRIGGER IF NOT EXISTS r4_snapshot_locked_update BEFORE UPDATE ON sale_items
WHEN EXISTS(SELECT 1 FROM restaurant_sale_links l WHERE l.sale_id=OLD.sale_id AND l.tenant_id=OLD.tenant_id AND l.branch_id=OLD.branch_id)
BEGIN SELECT RAISE(ABORT,'RESTAURANT_SALE_SNAPSHOT_LOCKED'); END;
CREATE TRIGGER IF NOT EXISTS r4_snapshot_locked_delete BEFORE DELETE ON sale_items
WHEN EXISTS(SELECT 1 FROM restaurant_sale_links l WHERE l.sale_id=OLD.sale_id AND l.tenant_id=OLD.tenant_id AND l.branch_id=OLD.branch_id)
BEGIN SELECT RAISE(ABORT,'RESTAURANT_SALE_SNAPSHOT_LOCKED'); END;
CREATE TRIGGER IF NOT EXISTS r4_no_late_table_orders BEFORE INSERT ON restaurant_orders
WHEN NEW.table_session_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM restaurant_table_sessions s WHERE s.tenant_id=NEW.tenant_id AND s.branch_id=NEW.branch_id
 AND s.id=NEW.table_session_id AND s.status='OPEN')
BEGIN SELECT RAISE(ABORT,'RESTAURANT_SESSION_NOT_OPEN'); END;
