-- P3.2: single canonical checkout customization definition per tenant/product.
-- No second sale, stock ledger or duplicated product row. Contents are a
-- validated catalog document; prices must always be recalculated server-side.
CREATE TABLE checkout_product_configurations(
 tenant_id TEXT NOT NULL,
 product_id TEXT NOT NULL,
 config_json TEXT NOT NULL CHECK(json_valid(config_json) AND length(config_json)<=24000),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,product_id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id) ON DELETE RESTRICT
);
ALTER TABLE sale_items ADD COLUMN configuration_json TEXT
  CHECK(configuration_json IS NULL OR (json_valid(configuration_json) AND length(configuration_json)<=16000));
-- A sale's historic configuration is immutable once its sale closes through
-- the already installed canonical sale_items_locked_* triggers.
