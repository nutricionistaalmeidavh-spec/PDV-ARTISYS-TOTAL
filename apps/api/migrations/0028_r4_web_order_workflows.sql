-- R4 web SaaS: additive, tenant-scoped state; never replace historical accounting rows.
ALTER TABLE r4_split_plans ADD COLUMN shares_json TEXT CHECK(shares_json IS NULL OR json_valid(shares_json));
CREATE TABLE IF NOT EXISTS r4_branch_ticket_clock(
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,time_zone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
 updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,branch_id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
-- One active/open comanda per physical table even if two operators race.
CREATE UNIQUE INDEX IF NOT EXISTS ux_r4_one_active_session_per_table
 ON restaurant_table_sessions(tenant_id,branch_id,table_id)
 WHERE status IN ('OPEN','CHECKOUT');
-- Never mutate the original order or sale when recording courier checkpoints.
CREATE TABLE IF NOT EXISTS r4_delivery_events(
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,order_id TEXT NOT NULL,
 id TEXT NOT NULL,sequence INTEGER NOT NULL CHECK(sequence>0),kind TEXT NOT NULL CHECK(kind IN('ARRIVED','RETURNED','REDISPATCHED')),
 courier_name TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',recorded_by TEXT NOT NULL,recorded_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,branch_id,id),UNIQUE(tenant_id,branch_id,order_id,sequence),
 FOREIGN KEY(tenant_id,branch_id,order_id) REFERENCES restaurant_orders(tenant_id,branch_id,id),
 FOREIGN KEY(recorded_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_r4_delivery_events_order
 ON r4_delivery_events(tenant_id,branch_id,order_id,recorded_at);

-- Addons are catalog prices, not client-supplied adjustments.
CREATE TABLE IF NOT EXISTS r4_pizza_addons(
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,product_id TEXT NOT NULL,
 code TEXT NOT NULL,name TEXT NOT NULL,price_cents INTEGER NOT NULL CHECK(price_cents BETWEEN 0 AND 1000000000),
 PRIMARY KEY(tenant_id,branch_id,product_id,code),
 FOREIGN KEY(tenant_id,branch_id,product_id) REFERENCES r4_pizza_profiles(tenant_id,branch_id,product_id)
);

-- Immutable per-option recipe versions. Checkout freezes quantities in the single stock ledger.
CREATE TABLE IF NOT EXISTS r4_recipe_option_versions (
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,product_id TEXT NOT NULL,
 option_kind TEXT NOT NULL CHECK(option_kind IN('SIZE','FLAVOR','CRUST','ADDON')),
 option_code TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),
 created_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,branch_id,product_id,option_kind,option_code,version),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS r4_recipe_option_ingredients (
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,product_id TEXT NOT NULL,
 option_kind TEXT NOT NULL,option_code TEXT NOT NULL,version INTEGER NOT NULL,
 ingredient_id TEXT NOT NULL,quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 PRIMARY KEY(tenant_id,branch_id,product_id,option_kind,option_code,version,ingredient_id),
 FOREIGN KEY(tenant_id,branch_id,product_id,option_kind,option_code,version)
  REFERENCES r4_recipe_option_versions(tenant_id,branch_id,product_id,option_kind,option_code,version),
 FOREIGN KEY(tenant_id,ingredient_id) REFERENCES products(tenant_id,id)
);
CREATE TRIGGER IF NOT EXISTS r4_option_recipe_version_immutable BEFORE UPDATE ON r4_recipe_option_versions
BEGIN SELECT RAISE(ABORT,'OPTION_RECIPE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS r4_option_recipe_ingredients_immutable BEFORE UPDATE ON r4_recipe_option_ingredients
BEGIN SELECT RAISE(ABORT,'OPTION_RECIPE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS r4_option_recipe_version_no_delete BEFORE DELETE ON r4_recipe_option_versions
BEGIN SELECT RAISE(ABORT,'OPTION_RECIPE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS r4_option_recipe_ingredients_no_delete BEFORE DELETE ON r4_recipe_option_ingredients
BEGIN SELECT RAISE(ABORT,'OPTION_RECIPE_IMMUTABLE'); END;
