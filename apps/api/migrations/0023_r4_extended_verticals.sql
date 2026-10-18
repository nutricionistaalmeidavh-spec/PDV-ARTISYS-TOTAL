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
ALTER TABLE restaurant_orders ADD COLUMN service_channel TEXT CHECK(service_channel IN('TABLE','DELIVERY','PICKUP','COUNTER'));
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

-- Dispatch attaches to the same food order; it never creates another order or sale.
CREATE TABLE IF NOT EXISTS r4_delivery_dispatches (
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,order_id TEXT NOT NULL,
 courier_name TEXT NOT NULL,dispatched_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,branch_id,order_id),
 FOREIGN KEY(tenant_id,branch_id,order_id) REFERENCES restaurant_orders(tenant_id,branch_id,id)
);

-- An immutable item reassignment ledger keeps the original order and KDS history.
-- Checkout subtracts transferred quantities from the source and adds them to the target.
CREATE TABLE IF NOT EXISTS r4_item_transfers (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 order_item_id TEXT NOT NULL REFERENCES restaurant_order_items(id),
 source_session_id TEXT NOT NULL,target_session_id TEXT NOT NULL,
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,branch_id,source_session_id) REFERENCES restaurant_table_sessions(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id,target_session_id) REFERENCES restaurant_table_sessions(tenant_id,branch_id,id),
 CHECK(source_session_id<>target_session_id)
);
CREATE INDEX IF NOT EXISTS idx_r4_item_transfer_source ON r4_item_transfers(tenant_id,branch_id,order_item_id);
CREATE INDEX IF NOT EXISTS idx_r4_item_transfer_target ON r4_item_transfers(tenant_id,branch_id,target_session_id);
CREATE TRIGGER IF NOT EXISTS r4_item_transfer_limit BEFORE INSERT ON r4_item_transfers
WHEN NOT EXISTS(
  SELECT 1 FROM restaurant_order_items oi JOIN restaurant_orders o
     ON o.tenant_id=oi.tenant_id AND o.branch_id=oi.branch_id AND o.id=oi.order_id
  JOIN restaurant_table_sessions src ON src.tenant_id=o.tenant_id AND src.branch_id=o.branch_id AND src.id=o.table_session_id
  JOIN restaurant_table_sessions dst ON dst.tenant_id=src.tenant_id AND dst.branch_id=src.branch_id AND dst.id=NEW.target_session_id
  WHERE oi.id=NEW.order_item_id AND oi.tenant_id=NEW.tenant_id AND oi.branch_id=NEW.branch_id
  AND o.table_session_id=NEW.source_session_id AND o.status='DELIVERED' AND src.status='OPEN' AND dst.status='OPEN'
) OR
(SELECT COALESCE(SUM(quantity_milli),0) FROM r4_item_transfers
 WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id AND order_item_id=NEW.order_item_id)+NEW.quantity_milli>
 (SELECT quantity_milli FROM restaurant_order_items WHERE id=NEW.order_item_id AND tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id)
BEGIN SELECT RAISE(ABORT,'RESTAURANT_TRANSFER_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS r4_item_transfer_immutable_update BEFORE UPDATE ON r4_item_transfers
BEGIN SELECT RAISE(ABORT,'RESTAURANT_TRANSFER_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS r4_item_transfer_immutable_delete BEFORE DELETE ON r4_item_transfers
BEGIN SELECT RAISE(ABORT,'RESTAURANT_TRANSFER_IMMUTABLE'); END;

CREATE TABLE IF NOT EXISTS r4_split_plans (
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,table_session_id TEXT NOT NULL,
 parts INTEGER NOT NULL CHECK(parts BETWEEN 2 AND 50),
 service_charge_bps INTEGER NOT NULL DEFAULT 0 CHECK(service_charge_bps BETWEEN 0 AND 3000),
 service_charge_product_id TEXT,updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,branch_id,table_session_id),
 FOREIGN KEY(tenant_id,branch_id,table_session_id) REFERENCES restaurant_table_sessions(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,service_charge_product_id) REFERENCES products(tenant_id,id),
 CHECK(service_charge_bps=0 OR service_charge_product_id IS NOT NULL)
);
-- Split tenders are only metadata attached to a completed canonical sale.
CREATE TABLE IF NOT EXISTS r4_split_tenders (
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,sale_id TEXT NOT NULL,
 share_index INTEGER NOT NULL CHECK(share_index BETWEEN 1 AND 50),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 method TEXT NOT NULL CHECK(method IN('CASH','PIX','DEBIT_CARD','CREDIT_CARD')),
 recorded_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,branch_id,sale_id,share_index),
 FOREIGN KEY(tenant_id,branch_id,sale_id) REFERENCES sales(tenant_id,branch_id,id)
);
CREATE TRIGGER IF NOT EXISTS r4_split_tender_immutable_update BEFORE UPDATE ON r4_split_tenders
BEGIN SELECT RAISE(ABORT,'SPLIT_TENDER_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS r4_split_tender_immutable_delete BEFORE DELETE ON r4_split_tenders
BEGIN SELECT RAISE(ABORT,'SPLIT_TENDER_IMMUTABLE'); END;
