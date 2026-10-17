'use strict';

function runErpFinanceMigrations(db, now = () => new Date().toISOString()) {
  if (!db || typeof db.exec !== 'function') throw new TypeError('db is required.');
  const timestamp = String(now());
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_dre_groups(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      nature TEXT NOT NULL CHECK(nature IN ('REVENUE','COST','EXPENSE','OTHER')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS financial_categories(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('INCOME','EXPENSE','BOTH')),
      dre_group_id TEXT REFERENCES finance_dre_groups(id),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_financial_categories_dre_group ON financial_categories(dre_group_id,active);
    CREATE TABLE IF NOT EXISTS cost_centers(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS financial_entry_dimensions(
      entry_id TEXT PRIMARY KEY REFERENCES financial_entries(id) ON DELETE CASCADE,
      category_id TEXT REFERENCES financial_categories(id),
      cost_center_id TEXT REFERENCES cost_centers(id),
      competency_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_financial_entry_dimensions_category ON financial_entry_dimensions(category_id);
    CREATE INDEX IF NOT EXISTS idx_financial_entry_dimensions_cost_center ON financial_entry_dimensions(cost_center_id);
    CREATE INDEX IF NOT EXISTS idx_financial_entry_dimensions_competency ON financial_entry_dimensions(competency_date);

    CREATE TABLE IF NOT EXISTS bank_statement_batches(
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES financial_accounts(id),
      source_name TEXT NOT NULL,
      format TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      inserted_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_statement_batches_account ON bank_statement_batches(account_id,created_at);
    CREATE TABLE IF NOT EXISTS bank_statement_transactions(
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES bank_statement_batches(id),
      account_id TEXT NOT NULL REFERENCES financial_accounts(id),
      posted_date TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('credit','debit')),
      amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
      description TEXT NOT NULL,
      external_id TEXT,
      source_fingerprint TEXT NOT NULL UNIQUE,
      business_fingerprint TEXT NOT NULL,
      classification_json TEXT,
      match_status TEXT NOT NULL DEFAULT 'UNMATCHED',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_statement_transactions_account_date ON bank_statement_transactions(account_id,posted_date);
    CREATE INDEX IF NOT EXISTS idx_statement_transactions_business_fp ON bank_statement_transactions(business_fingerprint);

    CREATE TABLE IF NOT EXISTS finance_reconciliations(
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      transaction_id TEXT NOT NULL REFERENCES bank_statement_transactions(id),
      entry_id TEXT NOT NULL REFERENCES financial_entries(id),
      decision TEXT NOT NULL CHECK(decision IN ('ACCEPTED','REJECTED','MANUAL')),
      amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
      settlement_id TEXT,
      reason TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_finance_reconciliations_transaction ON finance_reconciliations(transaction_id,decision);
    CREATE INDEX IF NOT EXISTS idx_finance_reconciliations_entry ON finance_reconciliations(entry_id,decision);
    CREATE TABLE IF NOT EXISTS financial_transfers(
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      debit_transaction_id TEXT NOT NULL REFERENCES bank_statement_transactions(id),
      credit_transaction_id TEXT NOT NULL REFERENCES bank_statement_transactions(id),
      amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
      status TEXT NOT NULL DEFAULT 'CONFIRMED',
      created_by TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(debit_transaction_id,credit_transaction_id)
    );
  `);

  const insertGroup = db.prepare(`INSERT OR IGNORE INTO finance_dre_groups(id,name,nature,sort_order,active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)`);
  for (const [id,name,nature,sortOrder] of [
    ['REVENUE','Receitas','REVENUE',10],
    ['COGS','Custos das vendas','COST',20],
    ['OPERATING_EXPENSE','Despesas operacionais','EXPENSE',30],
    ['OTHER_RESULT','Outros resultados','OTHER',40]
  ]) insertGroup.run(id,name,nature,sortOrder,timestamp,timestamp);

  const insertCategory = db.prepare(`INSERT OR IGNORE INTO financial_categories(id,name,kind,dre_group_id,active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)`);
  for (const [id,name,kind,dreGroupId] of [
    ['SALES','Vendas','INCOME','REVENUE'],
    ['PURCHASES','Compras e mercadorias','EXPENSE','COGS'],
    ['FEES','Taxas e tarifas','EXPENSE','OPERATING_EXPENSE'],
    ['PAYROLL','Pessoal e folha','EXPENSE','OPERATING_EXPENSE'],
    ['RENT','Aluguel','EXPENSE','OPERATING_EXPENSE'],
    ['UTILITIES','Contas e utilidades','EXPENSE','OPERATING_EXPENSE'],
    ['OTHER','Outros','BOTH','OTHER_RESULT']
  ]) insertCategory.run(id,name,kind,dreGroupId,timestamp,timestamp);
}

module.exports = { runErpFinanceMigrations };
