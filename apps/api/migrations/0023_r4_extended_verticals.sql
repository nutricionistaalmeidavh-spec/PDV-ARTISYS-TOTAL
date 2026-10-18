-- R4 extended web parity: all data remain tenant/branch scoped; sale, cash and stock stay canonical.
CREATE TABLE IF NOT EXISTS r4_kitchen_stations (
 id TEXT NOT NULL,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 name TEXT NOT NULL,printer_name TEXT,print_enabled INTEGER NOT NULL DEFAULT 0 CHECK(print_enabled IN(0,1)),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 sort_order INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
 UNIQUE(tenant_id,branch_id,name)
);
CREATE TABLE IF NOT EXISTS r4_product_kitchen_routes (
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,product_id TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN('DIRECT','PRODUCTION')),station_id TEXT,updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,branch_id,product_id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id),
 FOREIGN KEY(tenant_id,branch_id,station_id) REFERENCES r4_kitchen_stations(tenant_id,branch_id,id),
 CHECK((mode='DIRECT' AND station_id IS NULL) OR (mode='PRODUCTION' AND station_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS r4_station_tickets (
 id TEXT NOT NULL,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,order_id TEXT NOT NULL,
 station_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'NEW' CHECK(status IN('NEW','PREPARING','READY','CANCELLED')),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,branch_id,id),
 UNIQUE(tenant_id,branch_id,order_id,station_id),
 FOREIGN KEY(tenant_id,branch_id,order_id) REFERENCES restaurant_orders(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id,station_id) REFERENCES r4_kitchen_stations(tenant_id,branch_id,id)
);
CREATE INDEX IF NOT EXISTS idx_r4_station_queue ON r4_station_tickets(tenant_id,branch_id,status,created_at);
-- A catalog pizza is still a canonical product: option prices are snapshots, not separate sales.
CREATE TABLE IF NOT EXISTS r4_pizza_profiles (
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,product_id TEXT NOT NULL,
 pricing_policy TEXT NOT NULL CHECK(pricing_policy IN('HIGHEST_FLAVOR','PROPORTIONAL_AVERAGE')),
 max_flavors INTEGER NOT NULL DEFAULT 4 CHECK(max_flavors BETWEEN 1 AND 8),
 updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,branch_id,product_id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS r4_pizza_options (
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,product_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('SIZE','FLAVOR','CRUST')),
 code TEXT NOT NULL,name TEXT NOT NULL,price_cents INTEGER NOT NULL CHECK(price_cents BETWEEN 0 AND 1000000000),
 PRIMARY KEY(tenant_id,branch_id,product_id,kind,code),
 FOREIGN KEY(tenant_id,branch_id,product_id) REFERENCES r4_pizza_profiles(tenant_id,branch_id,product_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_r4_pizza_options ON r4_pizza_options(tenant_id,branch_id,product_id,kind);
-- The selected segment only recommends modules; it cannot grant paid/licensed access.
CREATE TABLE IF NOT EXISTS r4_segment_preferences (
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 segment_id TEXT NOT NULL CHECK(segment_id IN('RESTAURANT','PIZZERIA','DELIVERY','BAKERY','MARKET','GENERAL')),
 updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,branch_id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
-- Store optional daily counter on existing order, do not create an order duplicate.
ALTER TABLE restaurant_orders ADD COLUMN ticket_day TEXT;
ALTER TABLE restaurant_orders ADD COLUMN ticket_number INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_r4_daily_food_ticket ON restaurant_orders(tenant_id,branch_id,ticket_day,ticket_number)
 WHERE ticket_day IS NOT NULL AND ticket_number IS NOT NULL;
-- Recipe version history is immutable; checkout consumes components from this canonical version.
CREATE TABLE IF NOT EXISTS r4_recipe_versions (
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,product_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0),created_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,branch_id,product_id,version),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS r4_recipe_ingredients (
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,product_id TEXT NOT NULL,
 version INTEGER NOT NULL,ingredient_id TEXT NOT NULL,
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 PRIMARY KEY(tenant_id,branch_id,product_id,version,ingredient_id),
 FOREIGN KEY(tenant_id,branch_id,product_id,version) REFERENCES r4_recipe_versions(tenant_id,branch_id,product_id,version),
 FOREIGN KEY(tenant_id,ingredient_id) REFERENCES products(tenant_id,id)
);
CREATE TRIGGER IF NOT EXISTS r4_recipe_version_immutable_update BEFORE UPDATE ON r4_recipe_versions
BEGIN SELECT RAISE(ABORT,'RECIPE_VERSION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS r4_recipe_version_immutable_delete BEFORE DELETE ON r4_recipe_versions
BEGIN SELECT RAISE(ABORT,'RECIPE_VERSION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS r4_recipe_ingredients_immutable_update BEFORE UPDATE ON r4_recipe_ingredients
BEGIN SELECT RAISE(ABORT,'RECIPE_INGREDIENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS r4_recipe_ingredients_immutable_delete BEFORE DELETE ON r4_recipe_ingredients
BEGIN SELECT RAISE(ABORT,'RECIPE_INGREDIENT_IMMUTABLE'); END;

CREATE TABLE IF NOT EXISTS r4_sale_recipe_versions (
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,sale_id TEXT NOT NULL,
 sale_item_id TEXT NOT NULL,product_id TEXT NOT NULL,
 version INTEGER NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,branch_id,sale_id,product_id),
 FOREIGN KEY(tenant_id,branch_id,sale_id) REFERENCES sales(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id,product_id,version) REFERENCES r4_recipe_versions(tenant_id,branch_id,product_id,version)
);
CREATE TRIGGER IF NOT EXISTS r4_sale_recipe_versions_no_update BEFORE UPDATE ON r4_sale_recipe_versions
BEGIN SELECT RAISE(ABORT,'RECIPE_SALE_SNAPSHOT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS r4_sale_recipe_versions_no_delete BEFORE DELETE ON r4_sale_recipe_versions
BEGIN SELECT RAISE(ABORT,'RECIPE_SALE_SNAPSHOT_IMMUTABLE'); END;
