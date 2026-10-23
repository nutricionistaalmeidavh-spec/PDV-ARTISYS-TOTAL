-- Outbound-only print relay with tenant/branch isolation.
CREATE TABLE print_relay_agents(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 80),
 credential_hash TEXT NOT NULL UNIQUE CHECK(length(credential_hash)=64),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 last_seen_at INTEGER,created_at INTEGER NOT NULL,
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_print_relay_agents_branch ON print_relay_agents(tenant_id,branch_id,active);
CREATE TABLE print_relay_jobs(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 agent_id TEXT NOT NULL,sale_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,receipt_text TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('PENDING','LEASED','SUBMITTED','FAILED','UNCERTAIN')),
 lease_hash TEXT,lease_until INTEGER,attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 last_error TEXT,created_by TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 UNIQUE(tenant_id,branch_id,idempotency_key),
 FOREIGN KEY(agent_id) REFERENCES print_relay_agents(id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,branch_id,sale_id) REFERENCES sales(tenant_id,branch_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_print_relay_pending ON print_relay_jobs(agent_id,status,created_at,id);
CREATE INDEX idx_print_relay_history ON print_relay_jobs(tenant_id,branch_id,created_at DESC);
