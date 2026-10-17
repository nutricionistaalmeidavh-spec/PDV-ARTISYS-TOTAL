-- P3/P4: operations belong to the same authoritative sales/cash/finance D1 ledger.
-- Never modify previous deployed migration files. All money values are integer cents.
ALTER TABLE cash_sessions ADD COLUMN expected_cash_cents INTEGER;
ALTER TABLE cash_sessions ADD COLUMN counted_cash_cents INTEGER;
ALTER TABLE cash_sessions ADD COLUMN divergence_cents INTEGER;
ALTER TABLE cash_sessions ADD COLUMN closed_by_user_id TEXT;

-- Immutable signed operational cash adjustments; never overwrite sale payments.
CREATE TABLE cash_adjustments (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 branch_id TEXT NOT NULL,
 cash_session_id TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('SUPPLY','WITHDRAWAL')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 note TEXT NOT NULL DEFAULT '',
 mutation_id TEXT NOT NULL,
 operator_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,branch_id,cash_session_id) REFERENCES cash_sessions(tenant_id,branch_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,branch_id,cash_session_id,mutation_id)
);
CREATE INDEX idx_cash_adjustments_session ON cash_adjustments(tenant_id,branch_id,cash_session_id,created_at);
CREATE TRIGGER cash_adjustment_requires_open BEFORE INSERT ON cash_adjustments
WHEN NOT EXISTS (SELECT 1 FROM cash_sessions s WHERE s.tenant_id=NEW.tenant_id
 AND s.branch_id=NEW.branch_id AND s.id=NEW.cash_session_id AND s.status='OPEN')
BEGIN SELECT RAISE(ABORT,'CASH_SESSION_NOT_OPEN'); END;
CREATE TRIGGER cash_adjustment_immutable_update BEFORE UPDATE ON cash_adjustments
BEGIN SELECT RAISE(ABORT,'CASH_ADJUSTMENT_IMMUTABLE'); END;
CREATE TRIGGER cash_adjustment_immutable_delete BEFORE DELETE ON cash_adjustments
BEGIN SELECT RAISE(ABORT,'CASH_ADJUSTMENT_IMMUTABLE'); END;

-- Separate manual accounts payable/receivable from sales revenue: no double posting.
-- Settlements are append-only; balance is derived from immutable settlement rows.
CREATE TABLE finance_entries (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 branch_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('PAYABLE','RECEIVABLE')),
 description TEXT NOT NULL CHECK(length(description) BETWEEN 2 AND 180),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 due_date TEXT NOT NULL CHECK(length(due_date)=10),
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 cancelled_at TEXT,
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,branch_id,id)
);
CREATE INDEX idx_finance_due ON finance_entries(tenant_id,branch_id,kind,due_date);
CREATE TABLE finance_settlements (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 branch_id TEXT NOT NULL,
 entry_id TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 method TEXT NOT NULL CHECK(method IN ('PIX','BANK_TRANSFER','CASH','DEBIT_CARD','CREDIT_CARD','OTHER')),
 occurred_at TEXT NOT NULL,
 operator_id TEXT NOT NULL REFERENCES users(id),
 mutation_id TEXT NOT NULL,
 FOREIGN KEY(tenant_id,branch_id,entry_id) REFERENCES finance_entries(tenant_id,branch_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,branch_id,entry_id,mutation_id)
);
CREATE INDEX idx_finance_settlements ON finance_settlements(tenant_id,branch_id,entry_id);
CREATE TRIGGER finance_entry_immutable_values BEFORE UPDATE ON finance_entries
WHEN NEW.tenant_id<>OLD.tenant_id OR NEW.branch_id<>OLD.branch_id
 OR NEW.kind<>OLD.kind OR NEW.amount_cents<>OLD.amount_cents
 OR NEW.description<>OLD.description OR NEW.due_date<>OLD.due_date
BEGIN SELECT RAISE(ABORT,'FINANCE_ENTRY_IMMUTABLE'); END;
CREATE TRIGGER finance_settlement_immutable_update BEFORE UPDATE ON finance_settlements
BEGIN SELECT RAISE(ABORT,'FINANCE_SETTLEMENT_IMMUTABLE'); END;
CREATE TRIGGER finance_settlement_immutable_delete BEFORE DELETE ON finance_settlements
BEGIN SELECT RAISE(ABORT,'FINANCE_SETTLEMENT_IMMUTABLE'); END;
CREATE TRIGGER finance_settlement_cannot_overpay BEFORE INSERT ON finance_settlements
WHEN (SELECT e.cancelled_at IS NOT NULL
    OR (COALESCE((SELECT SUM(fs.amount_cents) FROM finance_settlements fs WHERE fs.entry_id=e.id),0)+NEW.amount_cents)>e.amount_cents
      FROM finance_entries e WHERE e.tenant_id=NEW.tenant_id AND e.branch_id=NEW.branch_id AND e.id=NEW.entry_id)
BEGIN SELECT RAISE(ABORT,'FINANCE_OVERPAY_OR_CANCELLED'); END;

-- These checks execute inside D1's serialized write transaction.
-- They stop a concurrent cash sale or withdrawal from invalidating a close.
CREATE TRIGGER cash_withdraw_cannot_overdraw BEFORE INSERT ON cash_adjustments
WHEN NEW.type='WITHDRAWAL' AND NEW.amount_cents > (
  SELECT s.opening_cents +
    COALESCE((SELECT SUM(cm.amount_cents) FROM cash_movements cm
      WHERE cm.tenant_id=s.tenant_id AND cm.branch_id=s.branch_id
        AND cm.cash_session_id=s.id AND cm.method='CASH'),0) +
    COALESCE((SELECT SUM(CASE WHEN a.type='SUPPLY' THEN a.amount_cents ELSE -a.amount_cents END)
      FROM cash_adjustments a WHERE a.tenant_id=s.tenant_id AND a.branch_id=s.branch_id
        AND a.cash_session_id=s.id),0)
  FROM cash_sessions s WHERE s.tenant_id=NEW.tenant_id
    AND s.branch_id=NEW.branch_id AND s.id=NEW.cash_session_id
)
BEGIN SELECT RAISE(ABORT,'CASH_INSUFFICIENT'); END;

CREATE TRIGGER cash_close_reconciliation_guard BEFORE UPDATE OF status ON cash_sessions
WHEN NEW.status='CLOSED' AND OLD.status='OPEN' AND (
  NEW.counted_cash_cents IS NULL OR NEW.counted_cash_cents<0 OR
  NEW.expected_cash_cents IS NULL OR
  NEW.expected_cash_cents <> (
    OLD.opening_cents +
    COALESCE((SELECT SUM(cm.amount_cents) FROM cash_movements cm
      WHERE cm.tenant_id=OLD.tenant_id AND cm.branch_id=OLD.branch_id
        AND cm.cash_session_id=OLD.id AND cm.method='CASH'),0) +
    COALESCE((SELECT SUM(CASE WHEN a.type='SUPPLY' THEN a.amount_cents ELSE -a.amount_cents END)
      FROM cash_adjustments a WHERE a.tenant_id=OLD.tenant_id AND a.branch_id=OLD.branch_id
        AND a.cash_session_id=OLD.id),0)
  )
)
BEGIN SELECT RAISE(ABORT,'CASH_CLOSING_STALE'); END;
