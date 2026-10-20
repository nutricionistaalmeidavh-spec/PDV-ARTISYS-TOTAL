-- Central only administrative access: bounded nonce store for replay protection.
CREATE TABLE IF NOT EXISTS saas_platform_bridge_nonces (
 nonce TEXT PRIMARY KEY CHECK(length(nonce)=36),
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_platform_bridge_nonce_expiry ON saas_platform_bridge_nonces(created_at);
