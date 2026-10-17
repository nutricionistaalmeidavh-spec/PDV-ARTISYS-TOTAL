-- P2: additive product identity, variants, immutable kit stock allocations,
-- purchase cost evidence and transactional branch-specific reservations.
-- Do not edit existing 0001..0008 schemas or use desktop licensing data.
CREATE TABLE product_categories (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 100),
 created_at TEXT NOT NULL,UNIQUE(tenant_id,id),UNIQUE(tenant_id,name)
);
ALTER TABLE products ADD COLUMN brand TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN barcode TEXT DEFAULT NULL;
ALTER TABLE products ADD COLUMN category_id TEXT REFERENCES product_categories(id);
ALTER TABLE products ADD COLUMN parent_product_id TEXT REFERENCES products(id);
ALTER TABLE products ADD COLUMN variant_label TEXT DEFAULT NULL;
ALTER TABLE products ADD COLUMN last_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(last_cost_cents>=0);
CREATE UNIQUE INDEX idx_product_barcode_per_tenant ON products(tenant_id,barcode)
 WHERE barcode IS NOT NULL;
CREATE UNIQUE INDEX idx_product_variant_per_parent ON products(tenant_id,parent_product_id,variant_label)
 WHERE parent_product_id IS NOT NULL;
CREATE INDEX idx_product_category ON products(tenant_id,category_id,brand,name);
CREATE TRIGGER catalog_references_tenant_insert BEFORE INSERT ON products
WHEN (NEW.category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM product_categories c
 WHERE c.id=NEW.category_id AND c.tenant_id=NEW.tenant_id))
 OR (NEW.parent_product_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM products p
 WHERE p.id=NEW.parent_product_id AND p.tenant_id=NEW.tenant_id
   AND p.parent_product_id IS NULL))
BEGIN SELECT RAISE(ABORT,'PRODUCT_REFERENCE_TENANT_MISMATCH'); END;
CREATE TRIGGER catalog_references_tenant_update BEFORE UPDATE OF category_id,parent_product_id ON products
WHEN (NEW.category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM product_categories c
 WHERE c.id=NEW.category_id AND c.tenant_id=NEW.tenant_id))
 OR (NEW.parent_product_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM products p
 WHERE p.id=NEW.parent_product_id AND p.tenant_id=NEW.tenant_id
   AND p.parent_product_id IS NULL AND p.id<>NEW.id))
BEGIN SELECT RAISE(ABORT,'PRODUCT_REFERENCE_TENANT_MISMATCH'); END;

CREATE TABLE product_bundle_components (
 tenant_id TEXT NOT NULL,kit_id TEXT NOT NULL,component_id TEXT NOT NULL,
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 PRIMARY KEY(tenant_id,kit_id,component_id),
 FOREIGN KEY(tenant_id,kit_id) REFERENCES products(tenant_id,id),
 FOREIGN KEY(tenant_id,component_id) REFERENCES products(tenant_id,id),
 CHECK(kit_id<>component_id)
);
CREATE TRIGGER bundle_component_before_insert BEFORE INSERT ON product_bundle_components
WHEN NOT EXISTS(SELECT 1 FROM products p WHERE p.tenant_id=NEW.tenant_id AND
 p.id=NEW.kit_id AND p.track_stock=0 AND p.active=1)
 OR NOT EXISTS(SELECT 1 FROM products c WHERE c.tenant_id=NEW.tenant_id
 AND c.id=NEW.component_id AND c.track_stock=1 AND c.active=1)
 OR EXISTS(SELECT 1 FROM sale_items i WHERE i.tenant_id=NEW.tenant_id AND i.product_id=NEW.kit_id
 AND EXISTS(SELECT 1 FROM sales s WHERE s.id=i.sale_id AND s.status='COMPLETED'))
BEGIN SELECT RAISE(ABORT,'KIT_DEFINITION_INVALID'); END;
CREATE TRIGGER bundle_component_before_update BEFORE UPDATE ON product_bundle_components
BEGIN SELECT RAISE(ABORT,'BUNDLE_IMMUTABLE_REPLACE_DEFINITION'); END;
CREATE TRIGGER bundle_component_before_delete BEFORE DELETE ON product_bundle_components
WHEN EXISTS(SELECT 1 FROM sale_items i JOIN sales s ON s.id=i.sale_id
 WHERE i.tenant_id=OLD.tenant_id AND i.product_id=OLD.kit_id AND s.status='COMPLETED')
BEGIN SELECT RAISE(ABORT,'SOLD_KIT_DEFINITION_IMMUTABLE'); END;

-- The fulfillment allocation is immutable for every original sale line. Kits
-- consume component stock, never a second product-level stock ledger.
CREATE TABLE sale_stock_allocations (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 sale_id TEXT NOT NULL,sale_item_id TEXT NOT NULL REFERENCES sale_items(id),
 component_product_id TEXT NOT NULL,quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(unit_cost_cents>=0),
 created_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,branch_id,sale_id) REFERENCES sales(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,component_product_id) REFERENCES products(tenant_id,id),
 UNIQUE(tenant_id,branch_id,sale_item_id,component_product_id)
);
CREATE TRIGGER sale_stock_allocation_no_update BEFORE UPDATE ON sale_stock_allocations
BEGIN SELECT RAISE(ABORT,'STOCK_ALLOCATION_IMMUTABLE'); END;
CREATE TRIGGER sale_stock_allocation_no_delete BEFORE DELETE ON sale_stock_allocations
BEGIN SELECT RAISE(ABORT,'STOCK_ALLOCATION_IMMUTABLE'); END;

CREATE TABLE purchase_cost_history (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 product_id TEXT NOT NULL,movement_id TEXT NOT NULL UNIQUE REFERENCES inventory_movements(id),
 supplier_id TEXT,unit_cost_cents INTEGER NOT NULL CHECK(unit_cost_cents>=0),
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 operator_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id),
 FOREIGN KEY(tenant_id,supplier_id) REFERENCES suppliers(tenant_id,id)
);
CREATE TRIGGER purchase_cost_history_no_update BEFORE UPDATE ON purchase_cost_history
BEGIN SELECT RAISE(ABORT,'PURCHASE_COST_IMMUTABLE'); END;
CREATE TRIGGER purchase_cost_history_no_delete BEFORE DELETE ON purchase_cost_history
BEGIN SELECT RAISE(ABORT,'PURCHASE_COST_IMMUTABLE'); END;

CREATE TABLE inventory_reservations (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 product_id TEXT NOT NULL,quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','RELEASED')),
 reason TEXT NOT NULL CHECK(length(trim(reason))>=3),
 operator_id TEXT NOT NULL REFERENCES users(id),mutation_id TEXT NOT NULL,
 created_at TEXT NOT NULL,released_at TEXT,
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id),
 UNIQUE(tenant_id,branch_id,mutation_id)
);
CREATE INDEX idx_reserved_available ON inventory_reservations(tenant_id,branch_id,product_id,status);
CREATE TRIGGER inventory_reservation_only_available BEFORE INSERT ON inventory_reservations
WHEN NEW.status='ACTIVE' AND
  NEW.quantity_milli + COALESCE((SELECT SUM(r.quantity_milli) FROM inventory_reservations r
    WHERE r.tenant_id=NEW.tenant_id AND r.branch_id=NEW.branch_id
      AND r.product_id=NEW.product_id AND r.status='ACTIVE'),0)
  > COALESCE((SELECT p.balance_milli FROM stock_positions p WHERE
    p.tenant_id=NEW.tenant_id AND p.branch_id=NEW.branch_id AND p.product_id=NEW.product_id),0)
BEGIN SELECT RAISE(ABORT,'RESERVATION_STOCK_INSUFFICIENT'); END;
CREATE TRIGGER inventory_reservation_release_only BEFORE UPDATE ON inventory_reservations
WHEN OLD.status<>'ACTIVE' OR NEW.status<>'RELEASED'
 OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.branch_id<>OLD.branch_id
 OR NEW.product_id<>OLD.product_id OR NEW.quantity_milli<>OLD.quantity_milli
 OR NEW.reason<>OLD.reason OR NEW.operator_id<>OLD.operator_id OR NEW.mutation_id<>OLD.mutation_id
 OR NEW.created_at<>OLD.created_at OR NEW.released_at IS NULL
BEGIN SELECT RAISE(ABORT,'RESERVATION_IMMUTABLE'); END;
CREATE TRIGGER inventory_reservation_no_delete BEFORE DELETE ON inventory_reservations
BEGIN SELECT RAISE(ABORT,'RESERVATION_IMMUTABLE'); END;
-- SQLite/D1 write serialization checks actual availability at stock decrement time.
CREATE TRIGGER reserved_stock_guard BEFORE INSERT ON inventory_movements
WHEN NEW.delta_milli<0 AND
 COALESCE((SELECT balance_milli FROM stock_positions WHERE tenant_id=NEW.tenant_id
  AND branch_id=NEW.branch_id AND product_id=NEW.product_id),0)+NEW.delta_milli <
 COALESCE((SELECT SUM(quantity_milli) FROM inventory_reservations WHERE tenant_id=NEW.tenant_id
  AND branch_id=NEW.branch_id AND product_id=NEW.product_id AND status='ACTIVE'),0)
BEGIN SELECT RAISE(ABORT,'RESERVED_STOCK_UNAVAILABLE'); END;
