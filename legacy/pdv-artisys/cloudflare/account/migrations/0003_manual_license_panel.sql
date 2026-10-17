ALTER TABLE password_recovery_tokens ADD COLUMN installation_id TEXT;

CREATE INDEX IF NOT EXISTS idx_password_recovery_installation
  ON password_recovery_tokens(installation_id, email_normalized, expires_at, used_at);
