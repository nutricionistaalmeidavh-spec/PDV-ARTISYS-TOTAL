-- Batch recipe metadata augments the existing immutable recipe versions.
-- No new stock ledger: checkout still writes the canonical sale allocations.
CREATE TABLE IF NOT EXISTS r4_recipe_details (
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,product_id TEXT NOT NULL,version INTEGER NOT NULL,
 yield_quantity REAL NOT NULL CHECK(yield_quantity>0),yield_unit TEXT NOT NULL,
 portion_quantity REAL NOT NULL CHECK(portion_quantity>0 AND portion_quantity<=yield_quantity),
 prep_time_minutes INTEGER NOT NULL CHECK(prep_time_minutes>=0),
 preparation_notes TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(tenant_id,branch_id,product_id,version),
 FOREIGN KEY(tenant_id,branch_id,product_id,version) REFERENCES r4_recipe_versions(tenant_id,branch_id,product_id,version)
);
CREATE TABLE IF NOT EXISTS r4_recipe_component_details (
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,product_id TEXT NOT NULL,version INTEGER NOT NULL,
 ingredient_id TEXT NOT NULL,quantity REAL NOT NULL CHECK(quantity>0),unit TEXT NOT NULL,
 conversion_factor REAL NOT NULL CHECK(conversion_factor>0),loss_percent REAL NOT NULL CHECK(loss_percent>=0 AND loss_percent<100),
 PRIMARY KEY(tenant_id,branch_id,product_id,version,ingredient_id),
 FOREIGN KEY(tenant_id,branch_id,product_id,version,ingredient_id) REFERENCES r4_recipe_ingredients(tenant_id,branch_id,product_id,version,ingredient_id)
);
CREATE TRIGGER IF NOT EXISTS r4_recipe_details_immutable_update BEFORE UPDATE ON r4_recipe_details
BEGIN SELECT RAISE(ABORT,'RECIPE_DETAILS_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS r4_recipe_details_immutable_delete BEFORE DELETE ON r4_recipe_details
BEGIN SELECT RAISE(ABORT,'RECIPE_DETAILS_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS r4_recipe_component_details_immutable_update BEFORE UPDATE ON r4_recipe_component_details
BEGIN SELECT RAISE(ABORT,'RECIPE_COMPONENT_DETAILS_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS r4_recipe_component_details_immutable_delete BEFORE DELETE ON r4_recipe_component_details
BEGIN SELECT RAISE(ABORT,'RECIPE_COMPONENT_DETAILS_IMMUTABLE'); END;
