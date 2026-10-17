-- P4 monthly commercial goals are administrative targets, never a financial ledger.
-- Monthly results are always derived from canonical sales, returns and commissions.
CREATE TABLE seller_sales_targets(
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  month_key TEXT NOT NULL CHECK(length(month_key)=7 AND substr(month_key,5,1)='-'),
  target_cents INTEGER NOT NULL CHECK(target_cents>0 AND target_cents<=10000000000),
  updated_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,branch_id,seller_id,month_key),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,seller_id) REFERENCES tenant_memberships(tenant_id,user_id)
);
CREATE INDEX idx_seller_sales_targets_period ON seller_sales_targets(tenant_id,branch_id,month_key);
