-- P4 additive financial operations: typed wallets and canonical due-date indexes.
-- Existing bank accounts remain BANK. Never replace the underlying finance ledger.
ALTER TABLE finance_bank_accounts
 ADD COLUMN wallet_kind TEXT NOT NULL DEFAULT 'BANK'
 CHECK(wallet_kind IN ('BANK','CASH','OTHER'));
CREATE INDEX IF NOT EXISTS idx_p4_finance_due
 ON finance_entries(tenant_id,branch_id,due_date,cancelled_at);
CREATE INDEX IF NOT EXISTS idx_p4_finance_recurrence_lookup
 ON finance_entries(tenant_id,branch_id,source_recurrence_id,due_date);
