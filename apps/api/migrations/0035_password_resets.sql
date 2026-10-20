-- SaaS password reset proofs: no plaintext tokens; user-scoped, one use.
CREATE TABLE IF NOT EXISTS saas_password_resets (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
 token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at)
);
CREATE INDEX IF NOT EXISTS idx_saas_reset_expiry ON saas_password_resets(expires_at);
-- Each bucket is SHA-256(email or edge IP + 15 minute window); never store raw IP.
CREATE TABLE IF NOT EXISTS saas_password_reset_throttles (
 bucket_hash TEXT PRIMARY KEY CHECK(length(bucket_hash)=64),
 attempts INTEGER NOT NULL CHECK(attempts>=0),
 window_started INTEGER NOT NULL
);
