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
 id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('ARRIVED','RETURNED','REDISPATCHED')),
 courier_name TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',recorded_by TEXT NOT NULL,recorded_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id,order_id) REFERENCES restaurant_orders(tenant_id,branch_id,id),
 FOREIGN KEY(recorded_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_r4_delivery_events_order
 ON r4_delivery_events(tenant_id,branch_id,order_id,recorded_at);
