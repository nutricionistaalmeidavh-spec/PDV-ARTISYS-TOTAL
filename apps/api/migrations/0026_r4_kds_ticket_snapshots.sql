-- Frozen item-to-station assignments. Never derive an issued production ticket
-- from mutable r4_product_kitchen_routes again.
CREATE TABLE r4_station_ticket_items (
 tenant_id TEXT NOT NULL,
 branch_id TEXT NOT NULL,
 station_ticket_id TEXT NOT NULL,
 item_index INTEGER NOT NULL CHECK(item_index BETWEEN 0 AND 79),
 product_id TEXT NOT NULL,
 product_name TEXT NOT NULL,
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 configuration_json TEXT,
 origin TEXT NOT NULL DEFAULT 'ORDER' CHECK(origin IN('ORDER','MIGRATED')),
 PRIMARY KEY(tenant_id,branch_id,station_ticket_id,item_index),
 FOREIGN KEY(tenant_id,branch_id,station_ticket_id) REFERENCES r4_station_tickets(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id),
 CHECK(configuration_json IS NULL OR (json_valid(configuration_json) AND length(configuration_json)<=16000))
);
CREATE INDEX idx_r4_station_item_origin ON r4_station_ticket_items(tenant_id,branch_id,station_ticket_id);
CREATE TRIGGER r4_station_item_no_update BEFORE UPDATE ON r4_station_ticket_items
BEGIN SELECT RAISE(ABORT,'KDS_ITEM_ASSIGNMENT_IMMUTABLE'); END;
CREATE TRIGGER r4_station_item_no_delete BEFORE DELETE ON r4_station_ticket_items
BEGIN SELECT RAISE(ABORT,'KDS_ITEM_ASSIGNMENT_IMMUTABLE'); END;
-- One-time upgrade backfill can only recover items where the recorded route
-- still points at the original station. Do not invent assignments otherwise.
INSERT INTO r4_station_ticket_items(
 tenant_id,branch_id,station_ticket_id,item_index,product_id,
 product_name,quantity_milli,configuration_json,origin)
SELECT k.tenant_id,k.branch_id,k.id,
 ROW_NUMBER() OVER (PARTITION BY k.tenant_id,k.branch_id,k.id ORDER BY oi.rowid)-1,
 oi.product_id,oi.product_name,oi.quantity_milli,oi.configuration_json,'MIGRATED'
FROM r4_station_tickets k
JOIN restaurant_order_items oi ON oi.tenant_id=k.tenant_id AND oi.branch_id=k.branch_id AND oi.order_id=k.order_id
JOIN r4_product_kitchen_routes route ON route.tenant_id=oi.tenant_id AND route.branch_id=oi.branch_id
 AND route.product_id=oi.product_id AND route.station_id=k.station_id
WHERE NOT EXISTS (
 SELECT 1 FROM r4_station_ticket_items x WHERE x.tenant_id=k.tenant_id AND x.branch_id=k.branch_id AND x.station_ticket_id=k.id
);
