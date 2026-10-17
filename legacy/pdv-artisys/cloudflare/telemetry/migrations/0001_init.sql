CREATE TABLE IF NOT EXISTS installations (
  installation_id TEXT PRIMARY KEY,
  credential_hash TEXT NOT NULL UNIQUE,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_app_version TEXT,
  last_release_id TEXT,
  telemetry_schema_version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS error_fingerprints (
  fingerprint TEXT PRIMARY KEY,
  subsystem TEXT NOT NULL,
  operation TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 0,
  affected_installations INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  fixed_version TEXT
);

CREATE TABLE IF NOT EXISTS error_fingerprint_installations (
  fingerprint TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (fingerprint, installation_id),
  FOREIGN KEY (fingerprint) REFERENCES error_fingerprints(fingerprint) ON DELETE CASCADE,
  FOREIGN KEY (installation_id) REFERENCES installations(installation_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS event_receipts (
  event_id TEXT PRIMARY KEY,
  receipt_type TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_installations_last_seen ON installations(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_error_fingerprints_last_seen ON error_fingerprints(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_error_fingerprint_installations_installation ON error_fingerprint_installations(installation_id);
CREATE INDEX IF NOT EXISTS idx_event_receipts_received ON event_receipts(received_at);
