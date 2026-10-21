-- Operational balances for non-bank wallets; never duplicate canonical sales,
-- bank imports, settlements or the POS cash register. All values are centavos.
CREATE TABLE finance_wallet_movements(
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,account_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('OPENING','CREDIT','DEBIT','TRANSFER_IN','TRANSFER_OUT')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents <> 0),
 counterpart_account_id TEXT,
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 240),
 mutation_id TEXT NOT NULL,
 operator_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 UNIQUE(tenant_id,branch_id,account_id,mutation_id),
 FOREIGN KEY(tenant_id,branch_id,account_id)
 REFERENCES finance_bank_accounts(tenant_id,branch_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,branch_id,counterpart_account_id)
 REFERENCES finance_bank_accounts(tenant_id,branch_id,id) ON DELETE RESTRICT,
 CHECK((kind IN('OPENING','CREDIT','TRANSFER_IN') AND amount_cents > 0)
   OR (kind IN('DEBIT','TRANSFER_OUT') AND amount_cents < 0)),
 CHECK((kind IN('TRANSFER_IN','TRANSFER_OUT') AND counterpart_account_id IS NOT NULL)
   OR (kind IN('OPENING','CREDIT','DEBIT') AND counterpart_account_id IS NULL))
);
CREATE INDEX idx_wallet_movement_history
 ON finance_wallet_movements(tenant_id,branch_id,account_id,created_at,id);
CREATE TRIGGER wallet_non_bank_guard BEFORE INSERT ON finance_wallet_movements
WHEN NOT EXISTS (
 SELECT 1 FROM finance_bank_accounts a
 WHERE a.id=NEW.account_id AND a.tenant_id=NEW.tenant_id AND a.branch_id=NEW.branch_id
   AND a.active=1 AND a.wallet_kind IN('CASH','OTHER')
) BEGIN SELECT RAISE(ABORT,'WALLET_NOT_ACTIVE_NON_BANK'); END;
CREATE TRIGGER wallet_no_overdraft BEFORE INSERT ON finance_wallet_movements
WHEN NEW.amount_cents < 0 AND (
 COALESCE((SELECT SUM(amount_cents) FROM finance_wallet_movements
  WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id AND account_id=NEW.account_id),0)
 + NEW.amount_cents < 0
) BEGIN SELECT RAISE(ABORT,'WALLET_INSUFFICIENT_FUNDS'); END;
CREATE TRIGGER wallet_no_update BEFORE UPDATE ON finance_wallet_movements
BEGIN SELECT RAISE(ABORT,'WALLET_MOVEMENT_IMMUTABLE'); END;
CREATE TRIGGER wallet_no_delete BEFORE DELETE ON finance_wallet_movements
BEGIN SELECT RAISE(ABORT,'WALLET_MOVEMENT_IMMUTABLE'); END;

CREATE UNIQUE INDEX idx_wallet_single_opening
 ON finance_wallet_movements(tenant_id,branch_id,account_id) WHERE kind='OPENING';
CREATE TRIGGER wallet_opening_first BEFORE INSERT ON finance_wallet_movements
WHEN NEW.kind='OPENING' AND EXISTS (
 SELECT 1 FROM finance_wallet_movements w WHERE w.tenant_id=NEW.tenant_id
  AND w.branch_id=NEW.branch_id AND w.account_id=NEW.account_id
) BEGIN SELECT RAISE(ABORT,'WALLET_OPENING_NOT_FIRST'); END;
