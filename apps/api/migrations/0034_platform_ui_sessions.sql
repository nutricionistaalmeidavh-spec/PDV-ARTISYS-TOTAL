-- Platform web sessions: never expose permanent PLATFORM_ADMIN_TOKEN in browser.
CREATE TABLE IF NOT EXISTS saas_platform_tickets (
 token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_platform_tickets_expiry ON saas_platform_tickets(expires_at);
CREATE TABLE IF NOT EXISTS saas_platform_sessions (
 token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_platform_sessions_expiry ON saas_platform_sessions(expires_at);
