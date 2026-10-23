-- Optional first-party telemetry. Separate from commercial ledgers and mandatory audit.
-- Do not store customer PII, request bodies, emails, or raw paths.
CREATE TABLE IF NOT EXISTS saas_telemetry_preferences (
 tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 diagnostics INTEGER NOT NULL DEFAULT 0 CHECK(diagnostics IN (0,1)),
 accepted_at TEXT,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS saas_telemetry_events (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 branch_id TEXT NOT NULL,
 event_name TEXT NOT NULL,
 route TEXT NOT NULL DEFAULT '',
 module TEXT NOT NULL DEFAULT '',
 outcome TEXT NOT NULL DEFAULT '',
 duration_ms INTEGER NOT NULL DEFAULT 0,
 occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saas_telemetry_tenant_time ON saas_telemetry_events(tenant_id,occurred_at);
CREATE INDEX IF NOT EXISTS idx_saas_telemetry_time_event ON saas_telemetry_events(occurred_at,event_name);
