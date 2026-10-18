-- P2 incremental lot receipt provenance. These entries are immutable annotations
-- of the SINGLE canonical inventory_movements ledger. This is NOT a second
-- stock position or a claim that consumption/returns are traced per batch.
CREATE TABLE inventory_lot_receipts(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  movement_id TEXT NOT NULL UNIQUE REFERENCES inventory_movements(id) ON DELETE RESTRICT,
  lot_code TEXT NOT NULL CHECK(length(lot_code) BETWEEN 1 AND 64),
  manufactured_at TEXT,
  expires_at TEXT,
  quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
  created_at TEXT NOT NULL,
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_inventory_lot_receipts
  ON inventory_lot_receipts(tenant_id,branch_id,product_id,expires_at,created_at);
CREATE TRIGGER inventory_lot_receipt_verify BEFORE INSERT ON inventory_lot_receipts
WHEN NOT EXISTS(
  SELECT 1 FROM inventory_movements m
  WHERE m.id=NEW.movement_id AND m.tenant_id=NEW.tenant_id
    AND m.branch_id=NEW.branch_id AND m.product_id=NEW.product_id
    AND m.delta_milli=NEW.quantity_milli
    AND m.type IN ('opening','purchase')
)
BEGIN SELECT RAISE(ABORT,'LOT_RECEIPT_LEDGER_MISMATCH'); END;
CREATE TRIGGER inventory_lot_receipt_no_update BEFORE UPDATE ON inventory_lot_receipts
BEGIN SELECT RAISE(ABORT,'LOT_RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER inventory_lot_receipt_no_delete BEFORE DELETE ON inventory_lot_receipts
BEGIN SELECT RAISE(ABORT,'LOT_RECEIPT_IMMUTABLE'); END;
