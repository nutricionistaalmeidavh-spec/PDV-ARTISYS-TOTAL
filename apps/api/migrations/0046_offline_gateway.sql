-- Optional SaaS -> SQLite read-only replica. Never replaces business ledgers.
-- No public SaaS route or local commercial fallback is activated by this migration.
CREATE TABLE IF NOT EXISTS offline_gateways (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 branch_id TEXT NOT NULL,
 label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 80),
 credential_hash TEXT NOT NULL UNIQUE CHECK(length(credential_hash)=64),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_by TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 revoked_at INTEGER,
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
 FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_offline_gateways_tenant ON offline_gateways(tenant_id,branch_id,active);
CREATE TABLE IF NOT EXISTS offline_replica_state (
 tenant_id TEXT NOT NULL,
 branch_id TEXT NOT NULL,
 gateway_id TEXT NOT NULL,
 last_pull_at TEXT,
 state TEXT NOT NULL DEFAULT 'BASELINE_ONLY' CHECK(state IN('BASELINE_ONLY','STALE','ERROR','PENDING_RECONCILIATION')),
 PRIMARY KEY(tenant_id,branch_id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
