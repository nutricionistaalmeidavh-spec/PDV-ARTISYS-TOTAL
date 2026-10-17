-- P8: canonical cross-branch transfers. Never mutate stock_positions directly.
-- Both signed immutable inventory_movements and this transfer record are inserted
-- in one SQLite/D1 batch transaction. Apply only after 0006_desktop_parity.sql.
CREATE TABLE IF NOT EXISTS inventory_transfers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  from_branch_id TEXT NOT NULL,
  to_branch_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=3),
  source_movement_id TEXT NOT NULL UNIQUE REFERENCES inventory_movements(id) ON DELETE RESTRICT,
  destination_movement_id TEXT NOT NULL UNIQUE REFERENCES inventory_movements(id) ON DELETE RESTRICT,
  operator_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  mutation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK(from_branch_id<>to_branch_id),
  FOREIGN KEY(tenant_id,from_branch_id) REFERENCES branches(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,to_branch_id) REFERENCES branches(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id) ON DELETE RESTRICT,
  UNIQUE(tenant_id,from_branch_id,mutation_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_transfers_dest
  ON inventory_transfers(tenant_id,to_branch_id,created_at);
CREATE TRIGGER IF NOT EXISTS inventory_transfer_no_update BEFORE UPDATE ON inventory_transfers
BEGIN SELECT RAISE(ABORT,'STOCK_TRANSFER_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS inventory_transfer_no_delete BEFORE DELETE ON inventory_transfers
BEGIN SELECT RAISE(ABORT,'STOCK_TRANSFER_IMMUTABLE'); END;
