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

-- Race-safe catalog guards. Keep sale snapshots and stock units meaningful even
-- if a concurrent checkout/stock operation changes the row during an edit.
CREATE TRIGGER IF NOT EXISTS product_unit_history_guard BEFORE UPDATE OF unit ON products
WHEN NEW.unit<>OLD.unit AND (
  EXISTS(SELECT 1 FROM sale_items WHERE tenant_id=OLD.tenant_id AND product_id=OLD.id)
  OR EXISTS(SELECT 1 FROM inventory_movements WHERE tenant_id=OLD.tenant_id AND product_id=OLD.id)
)
BEGIN SELECT RAISE(ABORT,'PRODUCT_UNIT_WITH_HISTORY'); END;

CREATE TRIGGER IF NOT EXISTS product_deactivation_pending_sale_guard BEFORE UPDATE OF active ON products
WHEN NEW.active=0 AND OLD.active=1 AND EXISTS(
  SELECT 1 FROM sale_items i JOIN sales s ON s.id=i.sale_id
  WHERE i.tenant_id=OLD.tenant_id AND i.product_id=OLD.id
    AND s.status IN ('OPEN','SUSPENDED')
)
BEGIN SELECT RAISE(ABORT,'PRODUCT_HAS_PENDING_SALE'); END;
