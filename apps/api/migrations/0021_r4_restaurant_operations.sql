-- R4: service calls share the existing tenant, branch and table-session authority.
-- Operational documents: never create sales, cash entries or stock movements.
CREATE TABLE IF NOT EXISTS restaurant_service_requests (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 branch_id TEXT NOT NULL,
 table_session_id TEXT NOT NULL,
 request_type TEXT NOT NULL CHECK(request_type IN ('WAITER','BILL')),
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ACKNOWLEDGED','CLOSED')),
 note TEXT NOT NULL DEFAULT '',
 created_by TEXT NOT NULL REFERENCES users(id),
 handled_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,branch_id,table_session_id) REFERENCES restaurant_table_sessions(tenant_id,branch_id,id),
 UNIQUE(tenant_id,branch_id,id)
);
CREATE INDEX IF NOT EXISTS idx_r4_service_queue
 ON restaurant_service_requests(tenant_id,branch_id,status,created_at);
