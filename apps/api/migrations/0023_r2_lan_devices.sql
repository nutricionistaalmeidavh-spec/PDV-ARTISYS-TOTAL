-- R2: operational LAN device identity and pilot evidence; business data stays canonical.
-- No desktop/license tables and no paid hosted dependency.
CREATE TABLE IF NOT EXISTS r2_pairings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  branch_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('TERMINAL','WAITER','KITCHEN')),
  code_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_r2_pairings_tenant ON r2_pairings(tenant_id,created_at);
CREATE TABLE IF NOT EXISTS r2_devices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  branch_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('TERMINAL','WAITER','KITCHEN')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  pairing_id TEXT NOT NULL UNIQUE REFERENCES r2_pairings(id) ON DELETE RESTRICT,
  credential_hash TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER,
  revoked_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_r2_devices_tenant ON r2_devices(tenant_id,branch_id,active);
CREATE TABLE IF NOT EXISTS r2_readiness (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  check_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('NOT_STARTED','IN_PROGRESS','READY','BLOCKED','NOT_APPLICABLE')),
  note TEXT NOT NULL DEFAULT '',
  evidence_ref TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,check_key)
);
CREATE TABLE IF NOT EXISTS r2_audit (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_r2_audit_tenant ON r2_audit(tenant_id,created_at DESC);
