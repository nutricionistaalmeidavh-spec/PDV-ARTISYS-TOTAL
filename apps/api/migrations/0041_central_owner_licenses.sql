-- Manual owner access is distinct from paid Asaas subscriptions.
CREATE TABLE IF NOT EXISTS saas_admin_licenses (
 tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 expires_at TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 8 AND 240),
 updated_at TEXT NOT NULL,
 updated_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saas_admin_license_expiry ON saas_admin_licenses(active,expires_at);
