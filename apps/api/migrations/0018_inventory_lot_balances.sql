-- 0018: append-only lot allocation beside the ONE canonical stock ledger.
-- Historical 0016 receipt annotations are NOT backfilled: whether earlier lots
-- are still on hand cannot be reconstructed without a physical count.
CREATE TABLE inventory_lot_balances(
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,product_id TEXT NOT NULL,
 lot_receipt_id TEXT NOT NULL,
 balance_milli INTEGER NOT NULL DEFAULT 0 CHECK(balance_milli>=0),
 PRIMARY KEY(tenant_id,branch_id,product_id,lot_receipt_id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id),
 FOREIGN KEY(lot_receipt_id) REFERENCES inventory_lot_receipts(id)
);
CREATE TABLE inventory_lot_entries(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 product_id TEXT NOT NULL,lot_receipt_id TEXT NOT NULL,
 movement_id TEXT NOT NULL, sale_item_id TEXT,
 delta_milli INTEGER NOT NULL CHECK(delta_milli<>0),
 created_at TEXT NOT NULL,
 FOREIGN KEY(lot_receipt_id) REFERENCES inventory_lot_receipts(id),
 FOREIGN KEY(movement_id) REFERENCES inventory_movements(id),
 FOREIGN KEY(sale_item_id) REFERENCES sale_items(id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE INDEX idx_inventory_lot_entry_movement ON inventory_lot_entries(tenant_id,branch_id,movement_id);
CREATE INDEX idx_inventory_lot_entry_sale ON inventory_lot_entries(tenant_id,sale_item_id,delta_milli);
CREATE TRIGGER inventory_lot_entry_validate BEFORE INSERT ON inventory_lot_entries
WHEN NOT EXISTS(SELECT 1 FROM inventory_lot_receipts l WHERE l.id=NEW.lot_receipt_id
 AND l.tenant_id=NEW.tenant_id AND l.product_id=NEW.product_id)
 OR NOT EXISTS(SELECT 1 FROM inventory_movements m WHERE m.id=NEW.movement_id
 AND m.tenant_id=NEW.tenant_id AND m.branch_id=NEW.branch_id
 AND m.product_id=NEW.product_id AND m.delta_milli*NEW.delta_milli>0
 AND ABS(m.delta_milli)>=ABS(NEW.delta_milli)+COALESCE(
    (SELECT SUM(ABS(e.delta_milli)) FROM inventory_lot_entries e
     WHERE e.movement_id=NEW.movement_id),0))
 OR (NEW.sale_item_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM sale_items i WHERE i.id=NEW.sale_item_id
   AND i.tenant_id=NEW.tenant_id AND i.branch_id=NEW.branch_id
   AND (i.product_id=NEW.product_id OR EXISTS(
     SELECT 1 FROM sale_stock_allocations a
     WHERE a.tenant_id=NEW.tenant_id AND a.branch_id=NEW.branch_id
      AND a.sale_item_id=i.id AND a.component_product_id=NEW.product_id))))
BEGIN SELECT RAISE(ABORT,'LOT_ENTRY_LEDGER_MISMATCH'); END;
CREATE TRIGGER inventory_lot_entry_project AFTER INSERT ON inventory_lot_entries
BEGIN
 INSERT OR IGNORE INTO inventory_lot_balances
 (tenant_id,branch_id,product_id,lot_receipt_id,balance_milli)
 VALUES(NEW.tenant_id,NEW.branch_id,NEW.product_id,NEW.lot_receipt_id,0);
 UPDATE inventory_lot_balances SET balance_milli=balance_milli+NEW.delta_milli
 WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id
 AND product_id=NEW.product_id AND lot_receipt_id=NEW.lot_receipt_id;

END;
CREATE TRIGGER inventory_lot_entry_no_update BEFORE UPDATE ON inventory_lot_entries
BEGIN SELECT RAISE(ABORT,'LOT_LEDGER_IMMUTABLE'); END;
CREATE TRIGGER inventory_lot_entry_no_delete BEFORE DELETE ON inventory_lot_entries
BEGIN SELECT RAISE(ABORT,'LOT_LEDGER_IMMUTABLE'); END;

-- A single product stock movement may consume multiple lots. Verify AFTER
-- the last subledger entry in the same atomic D1/SQLite batch, never midway.
CREATE TABLE inventory_lot_integrity_checks(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 product_id TEXT NOT NULL,movement_id TEXT NOT NULL REFERENCES inventory_movements(id),
 created_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE TRIGGER inventory_lot_verify_final BEFORE INSERT ON inventory_lot_integrity_checks
WHEN NOT EXISTS(SELECT 1 FROM inventory_movements m WHERE m.id=NEW.movement_id
 AND m.tenant_id=NEW.tenant_id AND m.branch_id=NEW.branch_id AND m.product_id=NEW.product_id)
 OR (SELECT COALESCE(SUM(balance_milli),0) FROM inventory_lot_balances
  WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id AND product_id=NEW.product_id)
 > COALESCE((SELECT balance_milli FROM stock_positions
  WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id AND product_id=NEW.product_id),0)
BEGIN SELECT RAISE(ABORT,'LOT_BALANCE_EXCEEDS_STOCK'); END;
CREATE TRIGGER inventory_lot_integrity_immutable_update BEFORE UPDATE ON inventory_lot_integrity_checks
BEGIN SELECT RAISE(ABORT,'LOT_CHECK_IMMUTABLE'); END;
CREATE TRIGGER inventory_lot_integrity_immutable_delete BEFORE DELETE ON inventory_lot_integrity_checks
BEGIN SELECT RAISE(ABORT,'LOT_CHECK_IMMUTABLE'); END;
