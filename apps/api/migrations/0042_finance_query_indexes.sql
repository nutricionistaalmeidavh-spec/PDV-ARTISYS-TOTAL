-- Query-shape indexes for paginated bank reconciliation.
-- The original OFX/CSV document is never persisted; only normalized movements
-- required for reconciliation and its immutable audit trail are stored.
CREATE INDEX IF NOT EXISTS idx_bank_transactions_branch_date
 ON finance_bank_transactions(tenant_id,branch_id,tx_date,id);

CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_decision
 ON finance_bank_reconciliations(tenant_id,branch_id,decision,transaction_id);
