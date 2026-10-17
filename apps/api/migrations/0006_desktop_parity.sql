-- Additive parity improvements; never rewrite 0001-0003 on a live D1.
-- Preserve each original unit price snapshot, every authorized price override
-- and an immutable reason attached to signed physical inventory adjustments.
ALTER TABLE sale_items ADD COLUMN catalog_unit_price_cents INTEGER CHECK(catalog_unit_price_cents>=0);
ALTER TABLE inventory_movements ADD COLUMN reason TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS sale_item_price_overrides(
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  sale_item_id TEXT NOT NULL REFERENCES sale_items(id) ON DELETE RESTRICT,
  old_price_cents INTEGER NOT NULL CHECK(old_price_cents>=0),
  new_price_cents INTEGER NOT NULL CHECK(new_price_cents>=0),
  reason TEXT NOT NULL CHECK(length(trim(reason))>=3),
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  mutation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(tenant_id,branch_id,sale_id) REFERENCES sales(tenant_id,branch_id,id) ON DELETE RESTRICT,
  UNIQUE(tenant_id,branch_id,sale_id,mutation_id)
);
CREATE INDEX IF NOT EXISTS idx_price_override_sale
ON sale_item_price_overrides(tenant_id,branch_id,sale_id,sale_item_id,created_at);

CREATE TRIGGER IF NOT EXISTS sale_price_override_immutable_update
BEFORE UPDATE ON sale_item_price_overrides
BEGIN SELECT RAISE(ABORT,'PRICE_OVERRIDE_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS sale_price_override_immutable_delete
BEFORE DELETE ON sale_item_price_overrides
BEGIN SELECT RAISE(ABORT,'PRICE_OVERRIDE_AUDIT_IMMUTABLE'); END;
-- Defense in depth: overrides on completed/cancelled/suspended sales are forbidden.
CREATE TRIGGER IF NOT EXISTS sale_price_override_only_open
BEFORE INSERT ON sale_item_price_overrides
WHEN NOT EXISTS(
  SELECT 1 FROM sales s JOIN sale_items i ON i.sale_id=s.id
  WHERE s.id=NEW.sale_id AND s.tenant_id=NEW.tenant_id
    AND s.branch_id=NEW.branch_id AND s.status='OPEN'
    AND i.id=NEW.sale_item_id AND i.tenant_id=NEW.tenant_id
    AND i.branch_id=NEW.branch_id
)
BEGIN SELECT RAISE(ABORT,'PRICE_OVERRIDE_SALE_NOT_OPEN'); END;
