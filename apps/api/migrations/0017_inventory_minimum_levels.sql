-- P5 (after 0016_inventory_lot_receipts.sql): per-branch minimum stock policies; no derived stock copy or paid dependency.
CREATE TABLE IF NOT EXISTS inventory_minimum_levels (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  minimum_milli INTEGER NOT NULL CHECK(minimum_milli>=0 AND minimum_milli<=100000000),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,branch_id,product_id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_minimum_branch ON inventory_minimum_levels(tenant_id,branch_id,minimum_milli);
