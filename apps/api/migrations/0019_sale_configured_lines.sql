-- 0019: additive, FK-safe configured sale lines; never rebuild sale_items.
-- sale_items stays the physical/financial parent identity referenced by old
-- refunds, commissions and stock allocations. Each configured choice has a
-- separate immutable-after-completion priced line under that same parent.
CREATE TABLE sale_configured_lines(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 sale_id TEXT NOT NULL,sale_item_id TEXT NOT NULL,product_id TEXT NOT NULL,
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0),
 catalog_unit_price_cents INTEGER NOT NULL CHECK(catalog_unit_price_cents>=0),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=240),
 configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json) AND length(configuration_json)<=16000),
 created_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,branch_id,sale_id) REFERENCES sales(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id),
 FOREIGN KEY(sale_item_id) REFERENCES sale_items(id) ON DELETE CASCADE
);
CREATE INDEX idx_configured_line_sale ON sale_configured_lines(tenant_id,branch_id,sale_id,sale_item_id,created_at,id);
CREATE TRIGGER sale_configured_line_validate_insert BEFORE INSERT ON sale_configured_lines
WHEN NOT EXISTS(SELECT 1 FROM sale_items i JOIN sales s ON s.id=i.sale_id
 WHERE i.id=NEW.sale_item_id AND i.sale_id=NEW.sale_id
 AND i.tenant_id=NEW.tenant_id AND i.branch_id=NEW.branch_id
 AND i.product_id=NEW.product_id AND s.status='OPEN')
BEGIN SELECT RAISE(ABORT,'CONFIGURED_LINE_PARENT_OR_SALE_INVALID'); END;
CREATE TRIGGER sale_configured_line_validate_update BEFORE UPDATE ON sale_configured_lines
WHEN NOT EXISTS(SELECT 1 FROM sales s WHERE s.id=OLD.sale_id
 AND s.tenant_id=OLD.tenant_id AND s.branch_id=OLD.branch_id AND s.status='OPEN')
 OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id
 OR NEW.branch_id<>OLD.branch_id OR NEW.sale_id<>OLD.sale_id
 OR NEW.sale_item_id<>OLD.sale_item_id OR NEW.product_id<>OLD.product_id
 OR NEW.catalog_unit_price_cents<>OLD.catalog_unit_price_cents
 OR NEW.configuration_json<>OLD.configuration_json OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'CONFIGURED_LINE_IMMUTABLE'); END;
CREATE TRIGGER sale_configured_line_validate_delete BEFORE DELETE ON sale_configured_lines
WHEN NOT EXISTS(SELECT 1 FROM sales s WHERE s.id=OLD.sale_id
 AND s.tenant_id=OLD.tenant_id AND s.branch_id=OLD.branch_id AND s.status='OPEN')
BEGIN SELECT RAISE(ABORT,'CONFIGURED_LINE_IMMUTABLE'); END;

-- Exact configured-line returns are recorded in addition to the historical
-- sale_return_items parent FK, never instead of it.
CREATE TABLE sale_configured_return_lines(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 return_id TEXT NOT NULL, sale_id TEXT NOT NULL, sale_item_id TEXT NOT NULL,
 configured_line_id TEXT NOT NULL, quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 net_cents INTEGER NOT NULL CHECK(net_cents>=0),
 created_at TEXT NOT NULL,
 FOREIGN KEY(return_id) REFERENCES sale_returns(id),
 FOREIGN KEY(sale_item_id) REFERENCES sale_items(id),
 FOREIGN KEY(configured_line_id) REFERENCES sale_configured_lines(id),
 UNIQUE(return_id,configured_line_id)
);
CREATE INDEX idx_configured_return_line ON sale_configured_return_lines(tenant_id,branch_id,configured_line_id);
CREATE TRIGGER sale_configured_return_guard BEFORE INSERT ON sale_configured_return_lines
WHEN NOT EXISTS(SELECT 1 FROM sale_configured_lines l
 WHERE l.id=NEW.configured_line_id AND l.tenant_id=NEW.tenant_id
  AND l.branch_id=NEW.branch_id AND l.sale_id=NEW.sale_id
  AND l.sale_item_id=NEW.sale_item_id)
BEGIN SELECT RAISE(ABORT,'CONFIGURED_RETURN_WRONG_PARENT'); END;
CREATE TRIGGER sale_configured_return_immutable_update BEFORE UPDATE ON sale_configured_return_lines
BEGIN SELECT RAISE(ABORT,'CONFIGURED_RETURN_IMMUTABLE'); END;
CREATE TRIGGER sale_configured_return_immutable_delete BEFORE DELETE ON sale_configured_return_lines
BEGIN SELECT RAISE(ABORT,'CONFIGURED_RETURN_IMMUTABLE'); END;
