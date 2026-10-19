-- Security hardening: optional administrator MFA, one-time identity challenges.
-- Existing active accounts remain usable; pending public signups require real proof.
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
UPDATE users SET email_verified_at=created_at
 WHERE NOT EXISTS (
  SELECT 1 FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id
  WHERE m.user_id=users.id AND m.profile_key='OWNER' AND m.active=0 AND t.active=0
 );
CREATE TABLE saas_identity_challenges (
 token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 purpose TEXT NOT NULL CHECK(purpose IN ('EMAIL_VERIFICATION','PASSWORD_RECOVERY')),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
 consumed_at INTEGER
);
CREATE INDEX idx_saas_identity_user ON saas_identity_challenges(user_id,purpose,expires_at);
CREATE TABLE platform_totp_replay (
 counter INTEGER PRIMARY KEY,
 consumed_at INTEGER NOT NULL
);

-- Durable unique consumption proof: concurrent requests cannot replay a challenge.
CREATE TABLE saas_identity_consumptions (
 token_hash TEXT PRIMARY KEY REFERENCES saas_identity_challenges(token_hash) ON DELETE RESTRICT,
 consumed_at INTEGER NOT NULL
);
