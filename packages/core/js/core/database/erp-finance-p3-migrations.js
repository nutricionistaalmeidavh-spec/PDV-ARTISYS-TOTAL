'use strict';
function runErpFinanceP3Migrations(db){
  if(!db||typeof db.exec!=='function')throw new TypeError('db is required.');
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_recurring_rules(
      id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('PAYABLE','RECEIVABLE')),description TEXT NOT NULL,
      category_id TEXT,cost_center_id TEXT,account_id TEXT,amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
      start_date TEXT NOT NULL,end_date TEXT,due_day INTEGER NOT NULL CHECK(due_day BETWEEN 1 AND 31),
      interval_months INTEGER NOT NULL DEFAULT 1 CHECK(interval_months BETWEEN 1 AND 12),max_occurrences INTEGER,
      generated_count INTEGER NOT NULL DEFAULT 0,next_due_at TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('ACTIVE','PAUSED','ENDED')),
      notes TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_finance_recurring_rules_due ON finance_recurring_rules(status,next_due_at);
    CREATE TABLE IF NOT EXISTS finance_recurrence_occurrences(
      recurrence_id TEXT NOT NULL REFERENCES finance_recurring_rules(id) ON DELETE CASCADE,
      occurrence_key TEXT NOT NULL,entry_id TEXT NOT NULL REFERENCES financial_entries(id),generated_at TEXT NOT NULL,
      PRIMARY KEY(recurrence_id,occurrence_key)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_finance_recurrence_entry ON finance_recurrence_occurrences(entry_id);
    CREATE TABLE IF NOT EXISTS finance_alert_state(
      alert_key TEXT PRIMARY KEY,read_at TEXT,hidden_at TEXT,updated_at TEXT NOT NULL
    );
  `);
}
module.exports={runErpFinanceP3Migrations};
