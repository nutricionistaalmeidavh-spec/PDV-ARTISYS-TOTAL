-- Optional centralized ArtiSys billing; local/self-hosted core remains free.
CREATE TABLE IF NOT EXISTS saas_billing_orders (
 order_id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 offer_id TEXT NOT NULL,
 plan_key TEXT NOT NULL CHECK(plan_key IN ('monthly','yearly')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 checkout_url TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(tenant_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_saas_billing_tenant ON saas_billing_orders(tenant_id,created_at);
CREATE TABLE IF NOT EXISTS saas_billing_deliveries (
 delivery_id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL REFERENCES saas_billing_orders(order_id) ON DELETE RESTRICT,
 event_kind TEXT NOT NULL CHECK(event_kind IN ('activate','renew','revoke')),
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saas_billing_deliveries_order ON saas_billing_deliveries(order_id);
