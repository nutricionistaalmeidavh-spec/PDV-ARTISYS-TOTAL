-- P3 terminal cashier scopes: additive fields preserve all existing sessions
-- under DEFAULT. Replace branch-wide open uniqueness by per-terminal uniqueness.
-- No change to immutable sale/cash/payment ledgers.
ALTER TABLE cash_sessions ADD COLUMN terminal_id TEXT NOT NULL DEFAULT 'DEFAULT'
  CHECK(length(terminal_id) BETWEEN 1 AND 80);
ALTER TABLE sales ADD COLUMN terminal_id TEXT NOT NULL DEFAULT 'DEFAULT'
  CHECK(length(terminal_id) BETWEEN 1 AND 80);
DROP INDEX IF EXISTS idx_open_cash_tenant_branch;
CREATE UNIQUE INDEX idx_open_cash_per_terminal
  ON cash_sessions(tenant_id,branch_id,terminal_id) WHERE status='OPEN';
CREATE INDEX idx_cash_session_terminal_history
  ON cash_sessions(tenant_id,branch_id,terminal_id,opened_at);
CREATE INDEX idx_sale_terminal_history
  ON sales(tenant_id,branch_id,terminal_id,created_at);
CREATE TRIGGER cash_terminal_identity_immutable BEFORE UPDATE OF terminal_id ON cash_sessions
WHEN NEW.terminal_id<>OLD.terminal_id
BEGIN SELECT RAISE(ABORT,'CASH_TERMINAL_IMMUTABLE'); END;
CREATE TRIGGER sale_terminal_identity_immutable BEFORE UPDATE OF terminal_id ON sales
WHEN NEW.terminal_id<>OLD.terminal_id
BEGIN SELECT RAISE(ABORT,'SALE_TERMINAL_IMMUTABLE'); END;
