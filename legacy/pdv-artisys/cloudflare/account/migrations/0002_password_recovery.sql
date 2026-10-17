CREATE TABLE IF NOT EXISTS password_recovery_tokens (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  token_digest TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_password_recovery_email_created
  ON password_recovery_tokens(email_normalized, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_password_recovery_expiry
  ON password_recovery_tokens(expires_at, used_at);