-- Cloud-only advanced finance; extends the canonical D1 finance/sales ledger.
-- Never mutate a previously applied migration. All amounts remain integer centavos.
ALTER TABLE finance_entries ADD COLUMN competence_date TEXT;
UPDATE finance_entries SET competence_date=due_date WHERE competence_date IS NULL;
ALTER TABLE finance_entries ADD COLUMN source_recurrence_id TEXT;
CREATE UNIQUE INDEX idx_finance_recurrence_occurrence
 ON finance_entries(tenant_id,branch_id,source_recurrence_id,due_date)
 WHERE source_recurrence_id IS NOT NULL;

CREATE TABLE finance_bank_accounts(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 100),
 bank_code TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_bank_accounts_branch ON finance_bank_accounts(tenant_id,branch_id,active);
CREATE TABLE finance_statement_batches(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 account_id TEXT NOT NULL,source_name TEXT NOT NULL,content_hash TEXT NOT NULL,
 imported_at TEXT NOT NULL,imported_by TEXT NOT NULL REFERENCES users(id),
 UNIQUE(tenant_id,branch_id,account_id,content_hash),
 FOREIGN KEY(tenant_id,branch_id,account_id) REFERENCES finance_bank_accounts(tenant_id,branch_id,id) ON DELETE RESTRICT
);
CREATE TABLE finance_bank_transactions(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 account_id TEXT NOT NULL,batch_id TEXT NOT NULL,transaction_key TEXT NOT NULL,
 tx_date TEXT NOT NULL CHECK(length(tx_date)=10),
 amount_cents INTEGER NOT NULL CHECK(amount_cents<>0),
 description TEXT NOT NULL,fit_id TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,
 UNIQUE(tenant_id,branch_id,account_id,transaction_key),
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id,account_id) REFERENCES finance_bank_accounts(tenant_id,branch_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(batch_id) REFERENCES finance_statement_batches(id) ON DELETE RESTRICT
);
CREATE INDEX idx_bank_transactions_account ON finance_bank_transactions(tenant_id,branch_id,account_id,tx_date);
CREATE TABLE finance_bank_reconciliations(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 transaction_id TEXT NOT NULL,decision TEXT NOT NULL CHECK(decision IN ('MATCH','IGNORE','TRANSFER')),
 entry_id TEXT,settlement_id TEXT,paired_transaction_id TEXT,
 operator_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
 UNIQUE(tenant_id,branch_id,transaction_id),
 FOREIGN KEY(tenant_id,branch_id,transaction_id) REFERENCES finance_bank_transactions(tenant_id,branch_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,branch_id,entry_id) REFERENCES finance_entries(tenant_id,branch_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,branch_id,paired_transaction_id) REFERENCES finance_bank_transactions(tenant_id,branch_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(settlement_id) REFERENCES finance_settlements(id) ON DELETE RESTRICT,
 CHECK ((decision='MATCH' AND entry_id IS NOT NULL AND settlement_id IS NOT NULL AND paired_transaction_id IS NULL)
    OR (decision='TRANSFER' AND entry_id IS NULL AND settlement_id IS NULL AND paired_transaction_id IS NOT NULL)
    OR (decision='IGNORE' AND entry_id IS NULL AND settlement_id IS NULL AND paired_transaction_id IS NULL))
);
CREATE UNIQUE INDEX idx_bank_settlement_once ON finance_bank_reconciliations(settlement_id) WHERE settlement_id IS NOT NULL;
CREATE TRIGGER finance_bank_tx_no_update BEFORE UPDATE ON finance_bank_transactions BEGIN SELECT RAISE(ABORT,'BANK_TRANSACTION_IMMUTABLE'); END;
CREATE TRIGGER finance_bank_tx_no_delete BEFORE DELETE ON finance_bank_transactions BEGIN SELECT RAISE(ABORT,'BANK_TRANSACTION_IMMUTABLE'); END;
CREATE TRIGGER finance_bank_recon_no_update BEFORE UPDATE ON finance_bank_reconciliations BEGIN SELECT RAISE(ABORT,'BANK_RECONCILIATION_IMMUTABLE'); END;
CREATE TRIGGER finance_bank_recon_no_delete BEFORE DELETE ON finance_bank_reconciliations BEGIN SELECT RAISE(ABORT,'BANK_RECONCILIATION_IMMUTABLE'); END;

CREATE TABLE finance_recurrences(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 description TEXT NOT NULL CHECK(length(description) BETWEEN 2 AND 180),
 kind TEXT NOT NULL CHECK(kind IN('PAYABLE','RECEIVABLE')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 frequency TEXT NOT NULL CHECK(frequency IN('DAILY','WEEKLY','MONTHLY','YEARLY')),
 anchor_day INTEGER NOT NULL CHECK(anchor_day BETWEEN 1 AND 31),
 anchor_month INTEGER NOT NULL CHECK(anchor_month BETWEEN 1 AND 12),
 next_due_date TEXT NOT NULL CHECK(length(next_due_date)=10),
 end_date TEXT,
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','PAUSED','CANCELLED')),
 created_at TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_recurrences_due ON finance_recurrences(tenant_id,branch_id,status,next_due_date);

CREATE TABLE finance_dre_groups(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 100),
 nature TEXT NOT NULL CHECK(nature IN('REVENUE','COST','EXPENSE','OTHER')),
 sort_order INTEGER NOT NULL DEFAULT 50,
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE finance_cost_centers(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 100),
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE finance_categories(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 100),
 kind TEXT NOT NULL CHECK(kind IN('INCOME','EXPENSE','BOTH')),
 dre_group_id TEXT,
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,branch_id,dre_group_id) REFERENCES finance_dre_groups(tenant_id,branch_id,id) ON DELETE RESTRICT
);
CREATE TABLE finance_entry_dimensions(
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,entry_id TEXT NOT NULL,
 dre_group_id TEXT,cost_center_id TEXT,category_id TEXT,
 PRIMARY KEY(tenant_id,branch_id,entry_id),
 FOREIGN KEY(tenant_id,branch_id,entry_id) REFERENCES finance_entries(tenant_id,branch_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,branch_id,dre_group_id) REFERENCES finance_dre_groups(tenant_id,branch_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,branch_id,cost_center_id) REFERENCES finance_cost_centers(tenant_id,branch_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,branch_id,category_id) REFERENCES finance_categories(tenant_id,branch_id,id) ON DELETE RESTRICT
);