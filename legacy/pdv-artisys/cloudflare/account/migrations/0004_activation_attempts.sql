ALTER TABLE activation_tokens ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_activation_tokens_attempts
  ON activation_tokens(account_id, expires_at, used_at, attempts);
