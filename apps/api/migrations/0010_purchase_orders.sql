-- P2.1: immutable purchase orders and partial receiving; stock remains
-- inventory_movements, cost remains purchase_cost_history. Apply after 0009.
CREATE TABLE purchase_orders(
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 supplier_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CANCELLED')),
 reason TEXT, created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,cancelled_at TEXT,
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
 FOREIGN KEY(tenant_id,supplier_id) REFERENCES suppliers(tenant_id,id),
 UNIQUE(tenant_id,branch_id,id)
);
CREATE INDEX idx_purchase_orders_supplier ON purchase_orders(tenant_id,branch_id,supplier_id,created_at);
CREATE TRIGGER purchase_orders_no_delete BEFORE DELETE ON purchase_orders
BEGIN SELECT RAISE(ABORT,'PURCHASE_ORDER_IMMUTABLE'); END;
CREATE TRIGGER purchase_orders_only_cancel BEFORE UPDATE ON purchase_orders
WHEN OLD.status<>'OPEN' OR NEW.status<>'CANCELLED' OR
 NEW.tenant_id<>OLD.tenant_id OR NEW.branch_id<>OLD.branch_id OR
 NEW.supplier_id<>OLD.supplier_id OR NEW.created_by<>OLD.created_by OR
 NEW.created_at<>OLD.created_at OR NEW.id<>OLD.id OR
 NEW.cancelled_at IS NULL OR length(trim(NEW.reason))<3
BEGIN SELECT RAISE(ABORT,'PURCHASE_ORDER_IMMUTABLE'); END;

CREATE TABLE purchase_order_lines(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 order_id TEXT NOT NULL,product_id TEXT NOT NULL,
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 unit_cost_cents INTEGER NOT NULL CHECK(unit_cost_cents BETWEEN 0 AND 10000000),
 FOREIGN KEY(tenant_id,branch_id,order_id) REFERENCES purchase_orders(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id),
 UNIQUE(tenant_id,branch_id,order_id,product_id),
 UNIQUE(tenant_id,branch_id,order_id,id)
);
CREATE TRIGGER purchase_order_lines_no_update BEFORE UPDATE ON purchase_order_lines
BEGIN SELECT RAISE(ABORT,'PURCHASE_ORDER_LINE_IMMUTABLE'); END;
CREATE TRIGGER purchase_order_lines_no_delete BEFORE DELETE ON purchase_order_lines
BEGIN SELECT RAISE(ABORT,'PURCHASE_ORDER_LINE_IMMUTABLE'); END;

CREATE TABLE purchase_receipts(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 order_id TEXT NOT NULL,operator_id TEXT NOT NULL REFERENCES users(id),
 mutation_id TEXT NOT NULL,created_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,branch_id,order_id) REFERENCES purchase_orders(tenant_id,branch_id,id),
 UNIQUE(tenant_id,branch_id,order_id,mutation_id),
 UNIQUE(tenant_id,branch_id,order_id,id)
);
CREATE TRIGGER purchase_receipts_only_open BEFORE INSERT ON purchase_receipts
WHEN NOT EXISTS(SELECT 1 FROM purchase_orders o WHERE o.id=NEW.order_id
 AND o.tenant_id=NEW.tenant_id AND o.branch_id=NEW.branch_id
 AND o.status='OPEN')
BEGIN SELECT RAISE(ABORT,'PURCHASE_ORDER_CLOSED'); END;
CREATE TRIGGER purchase_receipts_no_update BEFORE UPDATE ON purchase_receipts
BEGIN SELECT RAISE(ABORT,'PURCHASE_RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER purchase_receipts_no_delete BEFORE DELETE ON purchase_receipts
BEGIN SELECT RAISE(ABORT,'PURCHASE_RECEIPT_IMMUTABLE'); END;

CREATE TABLE purchase_receipt_lines(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 order_id TEXT NOT NULL,receipt_id TEXT NOT NULL,line_id TEXT NOT NULL,
 product_id TEXT NOT NULL,movement_id TEXT NOT NULL UNIQUE,
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 unit_cost_cents INTEGER NOT NULL CHECK(unit_cost_cents BETWEEN 0 AND 10000000),
 FOREIGN KEY(tenant_id,branch_id,order_id,receipt_id) REFERENCES purchase_receipts(tenant_id,branch_id,order_id,id),
 FOREIGN KEY(tenant_id,branch_id,order_id,line_id) REFERENCES purchase_order_lines(tenant_id,branch_id,order_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id),
 FOREIGN KEY(movement_id) REFERENCES inventory_movements(id),
 UNIQUE(tenant_id,branch_id,receipt_id,line_id)
);
CREATE INDEX idx_purchase_receipt_line_order ON purchase_receipt_lines(tenant_id,branch_id,order_id,line_id);
CREATE TRIGGER purchase_receipt_line_guard BEFORE INSERT ON purchase_receipt_lines
WHEN NOT EXISTS(
 SELECT 1 FROM purchase_order_lines l JOIN purchase_orders o ON o.id=l.order_id
 WHERE l.tenant_id=NEW.tenant_id AND l.branch_id=NEW.branch_id
 AND l.order_id=NEW.order_id AND l.id=NEW.line_id
 AND l.product_id=NEW.product_id AND l.unit_cost_cents=NEW.unit_cost_cents
 AND o.tenant_id=NEW.tenant_id AND o.branch_id=NEW.branch_id AND o.status='OPEN')
 OR NEW.quantity_milli + COALESCE((
 SELECT SUM(r.quantity_milli) FROM purchase_receipt_lines r
 WHERE r.tenant_id=NEW.tenant_id AND r.branch_id=NEW.branch_id
 AND r.order_id=NEW.order_id AND r.line_id=NEW.line_id),0) >
 COALESCE((SELECT quantity_milli FROM purchase_order_lines l
 WHERE l.id=NEW.line_id AND l.tenant_id=NEW.tenant_id
 AND l.branch_id=NEW.branch_id AND l.order_id=NEW.order_id),0)
BEGIN SELECT RAISE(ABORT,'PURCHASE_OVERRECEIPT'); END;
CREATE TRIGGER purchase_receipt_lines_no_update BEFORE UPDATE ON purchase_receipt_lines
BEGIN SELECT RAISE(ABORT,'PURCHASE_RECEIPT_LINE_IMMUTABLE'); END;
CREATE TRIGGER purchase_receipt_lines_no_delete BEFORE DELETE ON purchase_receipt_lines
BEGIN SELECT RAISE(ABORT,'PURCHASE_RECEIPT_LINE_IMMUTABLE'); END;
