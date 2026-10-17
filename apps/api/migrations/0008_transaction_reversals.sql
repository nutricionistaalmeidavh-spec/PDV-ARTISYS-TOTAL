-- P1: append-only sale refunds, stock restoration, commission/credit reversal,
-- and finance settlement compensation. Deployed schemas 0001-0007 stay untouched.
CREATE TABLE sale_returns (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,sale_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('CANCEL','RETURN')),
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 240),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
 original_cash_session_id TEXT,operator_id TEXT NOT NULL REFERENCES users(id),
 mutation_id TEXT NOT NULL,created_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,branch_id,sale_id) REFERENCES sales(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id,original_cash_session_id) REFERENCES cash_sessions(tenant_id,branch_id,id),
 UNIQUE(tenant_id,branch_id,sale_id,mutation_id),
 UNIQUE(tenant_id,branch_id,id,sale_id)
);
CREATE UNIQUE INDEX sale_cancellation_once ON sale_returns(tenant_id,branch_id,sale_id) WHERE kind='CANCEL';
CREATE INDEX idx_sale_returns_sale ON sale_returns(tenant_id,branch_id,sale_id,created_at);
CREATE TABLE sale_return_items (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,return_id TEXT NOT NULL,
 sale_id TEXT NOT NULL,sale_item_id TEXT NOT NULL REFERENCES sale_items(id),
 quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 net_cents INTEGER NOT NULL CHECK(net_cents>=0),
 FOREIGN KEY(tenant_id,branch_id,return_id,sale_id) REFERENCES sale_returns(tenant_id,branch_id,id,sale_id),
 UNIQUE(tenant_id,branch_id,return_id,sale_item_id)
);
CREATE TRIGGER return_item_not_over_quantity BEFORE INSERT ON sale_return_items
WHEN NEW.quantity_milli + COALESCE((SELECT SUM(ri.quantity_milli)
 FROM sale_return_items ri WHERE ri.tenant_id=NEW.tenant_id AND ri.branch_id=NEW.branch_id
 AND ri.sale_item_id=NEW.sale_item_id),0) >
 COALESCE((SELECT i.quantity_milli FROM sale_items i WHERE i.id=NEW.sale_item_id
 AND i.sale_id=NEW.sale_id AND i.tenant_id=NEW.tenant_id AND i.branch_id=NEW.branch_id),0)
BEGIN SELECT RAISE(ABORT,'RETURN_QUANTITY_EXCEEDED'); END;
CREATE TABLE sale_refund_movements (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 return_id TEXT NOT NULL REFERENCES sale_returns(id),
 sale_id TEXT NOT NULL,method TEXT NOT NULL
 CHECK(method IN('CASH','PIX','DEBIT_CARD','CREDIT_CARD','OTHER','STORE_CREDIT')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 cash_session_id TEXT,original_cash_session_id TEXT,
 operator_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,branch_id,sale_id) REFERENCES sales(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id,cash_session_id) REFERENCES cash_sessions(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id,original_cash_session_id) REFERENCES cash_sessions(tenant_id,branch_id,id),
 CHECK ((method='CASH' AND cash_session_id IS NOT NULL) OR (method<>'CASH' AND cash_session_id IS NULL)),
 UNIQUE(tenant_id,branch_id,return_id,method)
);
CREATE INDEX idx_sale_refunds_cash ON sale_refund_movements(tenant_id,branch_id,cash_session_id,created_at);
CREATE TRIGGER refund_requires_open_cash BEFORE INSERT ON sale_refund_movements
WHEN NEW.method='CASH' AND NOT EXISTS(SELECT 1 FROM cash_sessions s
 WHERE s.tenant_id=NEW.tenant_id AND s.branch_id=NEW.branch_id
 AND s.id=NEW.cash_session_id AND s.status='OPEN')
BEGIN SELECT RAISE(ABORT,'CASH_SESSION_NOT_OPEN'); END;
CREATE TRIGGER refund_must_not_overpay_tender BEFORE INSERT ON sale_refund_movements
WHEN NEW.amount_cents > (
 CASE WHEN NEW.method='STORE_CREDIT' THEN
   COALESCE((SELECT SUM(c.amount_cents) FROM customer_credit_ledger c
    WHERE c.tenant_id=NEW.tenant_id AND c.branch_id=NEW.branch_id AND c.sale_id=NEW.sale_id AND c.type='CHARGE'),0)
 ELSE
   COALESCE((SELECT SUM(CASE WHEN sp.method='CASH' THEN sp.amount_cents-s.change_cents ELSE sp.amount_cents END)
     FROM sale_payments sp JOIN sales s ON s.id=sp.sale_id
     WHERE sp.tenant_id=NEW.tenant_id AND sp.branch_id=NEW.branch_id
       AND sp.sale_id=NEW.sale_id AND sp.method=NEW.method),0)
 END - COALESCE((SELECT SUM(r.amount_cents) FROM sale_refund_movements r
    WHERE r.tenant_id=NEW.tenant_id AND r.branch_id=NEW.branch_id
      AND r.sale_id=NEW.sale_id AND r.method=NEW.method),0)
)
BEGIN SELECT RAISE(ABORT,'REFUND_TENDER_EXCEEDED'); END;
CREATE TRIGGER sale_returns_no_update BEFORE UPDATE ON sale_returns BEGIN SELECT RAISE(ABORT,'RETURN_IMMUTABLE'); END;
CREATE TRIGGER sale_returns_no_delete BEFORE DELETE ON sale_returns BEGIN SELECT RAISE(ABORT,'RETURN_IMMUTABLE'); END;
CREATE TRIGGER sale_return_items_no_update BEFORE UPDATE ON sale_return_items BEGIN SELECT RAISE(ABORT,'RETURN_IMMUTABLE'); END;
CREATE TRIGGER sale_return_items_no_delete BEFORE DELETE ON sale_return_items BEGIN SELECT RAISE(ABORT,'RETURN_IMMUTABLE'); END;
CREATE TRIGGER sale_refund_no_update BEFORE UPDATE ON sale_refund_movements BEGIN SELECT RAISE(ABORT,'REFUND_IMMUTABLE'); END;
CREATE TRIGGER sale_refund_no_delete BEFORE DELETE ON sale_refund_movements BEGIN SELECT RAISE(ABORT,'REFUND_IMMUTABLE'); END;

-- Finalized sales are immutable except the fully-returned COMPLETED -> CANCELLED transition.
DROP TRIGGER IF EXISTS completed_sales_immutable;
CREATE TRIGGER completed_sales_immutable BEFORE UPDATE ON sales WHEN OLD.status IN('COMPLETED','CANCELLED') AND NOT (
 OLD.status='COMPLETED' AND NEW.status='CANCELLED' AND NEW.id=OLD.id
 AND NEW.tenant_id=OLD.tenant_id AND NEW.branch_id=OLD.branch_id
 AND NEW.operator_id=OLD.operator_id AND NEW.sale_number=OLD.sale_number
 AND NEW.discount_cents=OLD.discount_cents AND NEW.subtotal_cents=OLD.subtotal_cents
 AND NEW.total_cents=OLD.total_cents AND NEW.change_cents=OLD.change_cents
 AND NEW.cash_session_id IS OLD.cash_session_id AND NEW.created_at=OLD.created_at
 AND NEW.completed_at IS OLD.completed_at AND NEW.customer_id IS OLD.customer_id
 AND NEW.seller_id IS OLD.seller_id
 AND EXISTS(SELECT 1 FROM sale_returns r WHERE r.tenant_id=OLD.tenant_id AND r.branch_id=OLD.branch_id
  AND r.sale_id=OLD.id AND r.kind='CANCEL')
 AND NOT EXISTS(SELECT 1 FROM sale_items i WHERE i.sale_id=OLD.id AND
  COALESCE((SELECT SUM(ri.quantity_milli) FROM sale_return_items ri
   WHERE ri.sale_id=OLD.id AND ri.sale_item_id=i.id),0)<>i.quantity_milli)
 AND (SELECT COALESCE(SUM(amount_cents),0) FROM sale_returns r
   WHERE r.tenant_id=OLD.tenant_id AND r.branch_id=OLD.branch_id AND r.sale_id=OLD.id)=OLD.total_cents
)
BEGIN SELECT RAISE(ABORT,'FINAL_SALE_IMMUTABLE'); END;

-- Guard credit reversal balance under concurrent settlements and returns.
CREATE TRIGGER credit_reversal_guard BEFORE INSERT ON customer_credit_ledger
WHEN NEW.type='REVERSAL' AND
 (SELECT COALESCE(SUM(l.amount_cents),0) FROM customer_credit_ledger l
 WHERE l.tenant_id=NEW.tenant_id AND l.customer_id=NEW.customer_id)+NEW.amount_cents<0
BEGIN SELECT RAISE(ABORT,'CREDIT_REVERSAL_OVERPAYMENT'); END;

CREATE TABLE finance_settlement_reversals (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 entry_id TEXT NOT NULL,settlement_id TEXT NOT NULL REFERENCES finance_settlements(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 operator_id TEXT NOT NULL REFERENCES users(id),reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 240),
 mutation_id TEXT NOT NULL,occurred_at TEXT NOT NULL,
 FOREIGN KEY(tenant_id,branch_id,entry_id) REFERENCES finance_entries(tenant_id,branch_id,id),
 UNIQUE(tenant_id,branch_id,settlement_id),
 UNIQUE(tenant_id,branch_id,entry_id,mutation_id)
);
CREATE TRIGGER finance_reversal_valid BEFORE INSERT ON finance_settlement_reversals
WHEN NOT EXISTS (SELECT 1 FROM finance_settlements fs JOIN finance_entries fe ON fe.id=fs.entry_id
 WHERE fs.tenant_id=NEW.tenant_id AND fs.branch_id=NEW.branch_id AND
 fs.id=NEW.settlement_id AND fs.entry_id=NEW.entry_id AND fs.amount_cents=NEW.amount_cents
 AND fe.tenant_id=NEW.tenant_id AND fe.branch_id=NEW.branch_id AND fe.cancelled_at IS NULL)
 OR EXISTS (SELECT 1 FROM finance_bank_reconciliations b
    WHERE b.tenant_id=NEW.tenant_id AND b.branch_id=NEW.branch_id AND b.settlement_id=NEW.settlement_id)
BEGIN SELECT RAISE(ABORT,'FINANCE_REVERSAL_INVALID'); END;
CREATE TRIGGER finance_reversal_no_update BEFORE UPDATE ON finance_settlement_reversals BEGIN SELECT RAISE(ABORT,'FINANCE_REVERSAL_IMMUTABLE'); END;
CREATE TRIGGER finance_reversal_no_delete BEFORE DELETE ON finance_settlement_reversals BEGIN SELECT RAISE(ABORT,'FINANCE_REVERSAL_IMMUTABLE'); END;

-- Replace cash guards: refunds debit only an OPEN active session; original
-- closed sessions remain historical and immutable. Physical money can never go negative.
DROP TRIGGER IF EXISTS cash_withdraw_cannot_overdraw;
CREATE TRIGGER cash_withdraw_cannot_overdraw BEFORE INSERT ON cash_adjustments
WHEN NEW.type='WITHDRAWAL' AND NEW.amount_cents > (
 SELECT s.opening_cents
 +COALESCE((SELECT SUM(cm.amount_cents) FROM cash_movements cm WHERE cm.cash_session_id=s.id AND cm.method='CASH'),0)
 +COALESCE((SELECT SUM(cr.amount_cents) FROM customer_credit_receipts cr WHERE cr.cash_session_id=s.id AND cr.method='CASH'),0)
 +COALESCE((SELECT SUM(CASE WHEN a.type='SUPPLY' THEN a.amount_cents ELSE -a.amount_cents END)
  FROM cash_adjustments a WHERE a.cash_session_id=s.id),0)
 -COALESCE((SELECT SUM(r.amount_cents) FROM sale_refund_movements r WHERE r.cash_session_id=s.id AND r.method='CASH'),0)
 FROM cash_sessions s WHERE s.id=NEW.cash_session_id AND s.tenant_id=NEW.tenant_id AND s.branch_id=NEW.branch_id
)
BEGIN SELECT RAISE(ABORT,'CASH_INSUFFICIENT'); END;
CREATE TRIGGER refund_cannot_overdraw BEFORE INSERT ON sale_refund_movements
WHEN NEW.method='CASH' AND NEW.amount_cents > (
 SELECT s.opening_cents
 +COALESCE((SELECT SUM(cm.amount_cents) FROM cash_movements cm WHERE cm.cash_session_id=s.id AND cm.method='CASH'),0)
 +COALESCE((SELECT SUM(cr.amount_cents) FROM customer_credit_receipts cr WHERE cr.cash_session_id=s.id AND cr.method='CASH'),0)
 +COALESCE((SELECT SUM(CASE WHEN a.type='SUPPLY' THEN a.amount_cents ELSE -a.amount_cents END)
  FROM cash_adjustments a WHERE a.cash_session_id=s.id),0)
 -COALESCE((SELECT SUM(r.amount_cents) FROM sale_refund_movements r WHERE r.cash_session_id=s.id AND r.method='CASH'),0)
 FROM cash_sessions s WHERE s.id=NEW.cash_session_id AND s.tenant_id=NEW.tenant_id AND s.branch_id=NEW.branch_id
)
BEGIN SELECT RAISE(ABORT,'CASH_INSUFFICIENT'); END;
DROP TRIGGER IF EXISTS cash_close_reconciliation_guard;
CREATE TRIGGER cash_close_reconciliation_guard BEFORE UPDATE OF status ON cash_sessions
WHEN NEW.status='CLOSED' AND OLD.status='OPEN' AND (
 NEW.counted_cash_cents IS NULL OR NEW.counted_cash_cents<0 OR
 NEW.expected_cash_cents IS NULL OR
 NEW.expected_cash_cents <> (
 OLD.opening_cents
 +COALESCE((SELECT SUM(cm.amount_cents) FROM cash_movements cm WHERE cm.cash_session_id=OLD.id AND cm.method='CASH'),0)
 +COALESCE((SELECT SUM(cr.amount_cents) FROM customer_credit_receipts cr WHERE cr.cash_session_id=OLD.id AND cr.method='CASH'),0)
 +COALESCE((SELECT SUM(CASE WHEN a.type='SUPPLY' THEN a.amount_cents ELSE -a.amount_cents END)
 FROM cash_adjustments a WHERE a.cash_session_id=OLD.id),0)
 -COALESCE((SELECT SUM(r.amount_cents) FROM sale_refund_movements r WHERE r.cash_session_id=OLD.id AND r.method='CASH'),0)
 )
)
BEGIN SELECT RAISE(ABORT,'CASH_CLOSING_STALE'); END;
