-- Public, opt-in account requests; isolated from desktop licensing.
CREATE TABLE IF NOT EXISTS public_signup_throttles (
 ip_hash TEXT PRIMARY KEY,
 attempts INTEGER NOT NULL DEFAULT 0,
 window_started INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_public_signup_window ON public_signup_throttles(window_started);
