PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','SUSPENDED','CANCELLED','EXPIRED')),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  metadata_json TEXT,
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);
CREATE INDEX IF NOT EXISTS idx_licenses_account_status ON licenses(account_id,status,created_at);

CREATE TABLE IF NOT EXISTS activation_tokens (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  license_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  token_digest TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id),
  FOREIGN KEY(license_id) REFERENCES licenses(id)
);
CREATE INDEX IF NOT EXISTS idx_activation_tokens_lookup ON activation_tokens(account_id,token_digest,expires_at,used_at);
CREATE INDEX IF NOT EXISTS idx_activation_tokens_installation ON activation_tokens(installation_id,created_at);

CREATE TABLE IF NOT EXISTS installations (
  installation_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  license_id TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id),
  FOREIGN KEY(license_id) REFERENCES licenses(id)
);
CREATE INDEX IF NOT EXISTS idx_installations_license ON installations(license_id);

CREATE TABLE IF NOT EXISTS email_delivery_log (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  email_normalized TEXT NOT NULL,
  template TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('SENT','FAILED')),
  error TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id)
);
CREATE INDEX IF NOT EXISTS idx_email_delivery_log_email_created ON email_delivery_log(email_normalized,created_at);
