-- P1: shelf/bin addresses by tenant and branch, metadata ONLY.
-- Quantities stay exclusively in inventory_movements + stock_positions.
CREATE TABLE inventory_storage_locations(
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 branch_id TEXT NOT NULL,
 code TEXT NOT NULL CHECK(length(code) BETWEEN 1 AND 32),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 100),
 created_at TEXT NOT NULL,
 UNIQUE(tenant_id,branch_id,id),
 UNIQUE(tenant_id,branch_id,code),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE inventory_product_location_assignments(
 tenant_id TEXT NOT NULL,
 branch_id TEXT NOT NULL,
 product_id TEXT NOT NULL,
 location_id TEXT NOT NULL,
 assigned_at TEXT NOT NULL,
 assigned_by TEXT NOT NULL REFERENCES users(id),
 PRIMARY KEY(tenant_id,branch_id,product_id),
 FOREIGN KEY(tenant_id,branch_id,location_id) REFERENCES inventory_storage_locations(tenant_id,branch_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_inventory_location_assignments ON inventory_product_location_assignments(tenant_id,branch_id,location_id);
