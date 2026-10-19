-- Hosted SaaS control plane: isolated tables; never duplicate sales, cash or stock.
-- Tenant data is scoped by tenant_id and authorized in the Worker before any operation.
CREATE TABLE IF NOT EXISTS saas_invitations (
 id TEXT NOT NULL PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
 email_norm TEXT NOT NULL,
 profile_key TEXT NOT NULL CHECK(profile_key IN ('ADMINISTRATOR','MANAGER','SUPERVISOR','CASHIER','OPERATOR','WAITER','KITCHEN','STOCKKEEPER','PURCHASING','FINANCE','DELIVERY','READ_ONLY')),
 invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 accepted_at INTEGER,
 revoked_at INTEGER,
 CHECK(expires_at>created_at),
 CHECK(accepted_at IS NULL OR revoked_at IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_saas_invites_tenant ON saas_invitations(tenant_id,created_at);
CREATE INDEX IF NOT EXISTS idx_saas_invites_email ON saas_invitations(email_norm,expires_at);
CREATE TABLE IF NOT EXISTS saas_subscriptions (
 tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
 plan_key TEXT NOT NULL CHECK(length(plan_key) BETWEEN 2 AND 48),
 status TEXT NOT NULL CHECK(status IN ('TRIAL','ACTIVE','PAST_DUE','SUSPENDED','CANCELLED')),
 ends_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 updated_by TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0)
);
CREATE TABLE IF NOT EXISTS saas_audit_events (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 actor_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 subject_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 detail_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detail_json))
);
CREATE INDEX IF NOT EXISTS idx_saas_audit_tenant ON saas_audit_events(tenant_id,created_at);
-- Short-lived bucket IDs are hashes; never persist source IP.
CREATE TABLE IF NOT EXISTS saas_auth_rate_limits (
 bucket_hash TEXT PRIMARY KEY CHECK(length(bucket_hash)=64),
 failures INTEGER NOT NULL CHECK(failures>=0),
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saas_auth_limits_expire ON saas_auth_rate_limits(expires_at);
