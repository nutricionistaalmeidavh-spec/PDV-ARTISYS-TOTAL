-- Optional P2 account hardening. Secrets only encrypted at rest with a private key.
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
CREATE TABLE IF NOT EXISTS saas_email_verifications (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
 token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS saas_mfa_totp (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
 cipher TEXT NOT NULL,
 iv TEXT NOT NULL,
 enrolled_at INTEGER,
 pending_expires_at INTEGER,
 last_counter INTEGER NOT NULL DEFAULT -1
);
CREATE TABLE IF NOT EXISTS saas_mfa_login_challenges (
 token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 expires_at INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_saas_mfa_expiry ON saas_mfa_login_challenges(expires_at);
CREATE TABLE IF NOT EXISTS saas_mfa_recovery (
 code_hash TEXT PRIMARY KEY CHECK(length(code_hash)=64),
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_saas_mfa_recovery_user ON saas_mfa_recovery(user_id,used_at);
