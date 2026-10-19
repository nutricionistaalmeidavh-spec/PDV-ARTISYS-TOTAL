-- Explicit per-item split assignment is metadata of the one canonical sale, never a separate payment ledger.
ALTER TABLE r4_split_plans ADD COLUMN item_allocations_json TEXT CHECK(item_allocations_json IS NULL OR json_valid(item_allocations_json));

-- R4 SaaS: a stale concurrent transfer must never be recorded as completed.
-- commerce_mutations and the table update are in one atomic SQLite/D1 db.batch.
CREATE TRIGGER IF NOT EXISTS r4_transfer_requires_committed_destination
BEFORE INSERT ON commerce_mutations
WHEN NEW.scope LIKE 'restaurant.transfer:%'
AND NOT EXISTS (
 SELECT 1 FROM restaurant_table_sessions s
 WHERE s.tenant_id=NEW.tenant_id
   AND s.id=substr(NEW.scope,length('restaurant.transfer:')+1)
   AND s.status='OPEN'
   AND s.table_id=json_extract(NEW.result_json,'$.tableId')
)
BEGIN SELECT RAISE(ABORT,'RESTAURANT_TRANSFER_STALE'); END;

-- One active request of each type per table: double clicks or simultaneous waiters
-- may not create two live calls for the same session.
CREATE UNIQUE INDEX IF NOT EXISTS ux_r4_service_request_live
ON restaurant_service_requests(tenant_id,branch_id,table_session_id,request_type)
WHERE status IN ('OPEN','ACKNOWLEDGED');

-- A conditionally updated row with zero changes must not be acknowledged as
-- a successful second service transition under another idempotency key.
CREATE TRIGGER IF NOT EXISTS r4_service_transition_requires_winner
BEFORE INSERT ON commerce_mutations
WHEN NEW.scope LIKE 'restaurant.service.update:%'
AND (
 NOT EXISTS (
  SELECT 1 FROM restaurant_service_requests r WHERE r.tenant_id=NEW.tenant_id
   AND r.id=substr(NEW.scope,length('restaurant.service.update:')+1)
   AND r.status=json_extract(NEW.result_json,'$.status')
 )
 OR EXISTS (
  SELECT 1 FROM commerce_mutations prev WHERE prev.tenant_id=NEW.tenant_id
   AND prev.scope=NEW.scope
   AND json_extract(prev.result_json,'$.status')=json_extract(NEW.result_json,'$.status')
 )
)
BEGIN SELECT RAISE(ABORT,'RESTAURANT_SERVICE_STALE'); END;

-- Advance tenders belong to the canonical table session until a sale completes;
-- they are never a new sale or a duplicated stock/finance record.
CREATE TABLE IF NOT EXISTS r4_table_prepayments(
 id TEXT NOT NULL,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,table_session_id TEXT NOT NULL,
 cash_session_id TEXT NOT NULL,method TEXT NOT NULL CHECK(method IN('CASH','PIX','DEBIT_CARD','CREDIT_CARD')),
 payer_index INTEGER CHECK(payer_index BETWEEN 1 AND 50),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),mutation_id TEXT NOT NULL,
 received_by TEXT NOT NULL,received_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,branch_id,id),
 UNIQUE(tenant_id,branch_id,table_session_id,mutation_id),
 FOREIGN KEY(tenant_id,branch_id,table_session_id) REFERENCES restaurant_table_sessions(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id,cash_session_id) REFERENCES cash_sessions(tenant_id,branch_id,id),
 FOREIGN KEY(received_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_r4_table_prepayment_session ON r4_table_prepayments(tenant_id,branch_id,table_session_id,received_at);
CREATE INDEX IF NOT EXISTS idx_r4_table_prepayment_cash ON r4_table_prepayments(tenant_id,branch_id,cash_session_id,received_at);
CREATE TRIGGER IF NOT EXISTS r4_table_prepayment_no_update BEFORE UPDATE ON r4_table_prepayments
BEGIN SELECT RAISE(ABORT,'TABLE_PREPAYMENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS r4_table_prepayment_no_delete BEFORE DELETE ON r4_table_prepayments
BEGIN SELECT RAISE(ABORT,'TABLE_PREPAYMENT_IMMUTABLE'); END;
-- Concurrent prepayments cannot exceed the value of already delivered items.
-- The guard is inside the atomic insert transaction, not only the API read.
CREATE TRIGGER IF NOT EXISTS r4_prepayment_balance_guard BEFORE INSERT ON r4_table_prepayments
WHEN NEW.amount_cents+
 (SELECT COALESCE(SUM(amount_cents),0) FROM r4_table_prepayments p
  WHERE p.tenant_id=NEW.tenant_id AND p.branch_id=NEW.branch_id AND p.table_session_id=NEW.table_session_id)
 >
 (SELECT COALESCE(SUM(ROUND(oi.quantity_milli*oi.unit_price_cents/1000.0)),0)
  FROM restaurant_order_items oi JOIN restaurant_orders o
   ON o.tenant_id=oi.tenant_id AND o.branch_id=oi.branch_id AND o.id=oi.order_id
  WHERE o.tenant_id=NEW.tenant_id AND o.branch_id=NEW.branch_id AND o.table_session_id=NEW.table_session_id
    AND o.status='DELIVERED')
BEGIN SELECT RAISE(ABORT,'TABLE_PREPAYMENT_EXCEEDS_DELIVERED'); END;
CREATE TRIGGER IF NOT EXISTS r4_prepayment_session_guard BEFORE INSERT ON r4_table_prepayments
WHEN NOT EXISTS(SELECT 1 FROM restaurant_table_sessions s WHERE s.tenant_id=NEW.tenant_id AND s.branch_id=NEW.branch_id
 AND s.id=NEW.table_session_id AND s.status='OPEN')
 OR EXISTS(SELECT 1 FROM restaurant_sale_links l WHERE l.tenant_id=NEW.tenant_id
  AND l.branch_id=NEW.branch_id AND l.table_session_id=NEW.table_session_id)
 OR NOT EXISTS(SELECT 1 FROM cash_sessions c WHERE c.tenant_id=NEW.tenant_id AND c.branch_id=NEW.branch_id
  AND c.id=NEW.cash_session_id AND c.status='OPEN')
BEGIN SELECT RAISE(ABORT,'TABLE_PREPAYMENT_SESSION_CONFLICT'); END;

-- A paid table cannot move delivered line value to another session without refund.
CREATE TRIGGER IF NOT EXISTS r4_prepaid_item_transfer_guard BEFORE INSERT ON r4_item_transfers
WHEN EXISTS(SELECT 1 FROM r4_table_prepayments p WHERE p.tenant_id=NEW.tenant_id AND p.branch_id=NEW.branch_id
 AND p.table_session_id IN(NEW.source_session_id,NEW.target_session_id))
BEGIN SELECT RAISE(ABORT,'TABLE_PREPAYMENT_TRANSFER_CONFLICT'); END;

-- A split payer can receive advances in independent steps, but never more
-- than that payer owes. Check in the INSERT transaction to close race windows.
CREATE TRIGGER IF NOT EXISTS r4_prepayment_payer_limit BEFORE INSERT ON r4_table_prepayments
WHEN EXISTS(SELECT 1 FROM r4_split_plans s
 WHERE s.tenant_id=NEW.tenant_id AND s.branch_id=NEW.branch_id
 AND s.table_session_id=NEW.table_session_id)
AND (
 NEW.payer_index IS NULL OR
 NEW.amount_cents+(
   SELECT COALESCE(SUM(p.amount_cents),0) FROM r4_table_prepayments p
   WHERE p.tenant_id=NEW.tenant_id AND p.branch_id=NEW.branch_id
   AND p.table_session_id=NEW.table_session_id AND p.payer_index=NEW.payer_index
 ) > COALESCE((SELECT json_extract(s.shares_json,'$['||(NEW.payer_index-1)||']')
   FROM r4_split_plans s WHERE s.tenant_id=NEW.tenant_id AND s.branch_id=NEW.branch_id
     AND s.table_session_id=NEW.table_session_id),0)
)
BEGIN SELECT RAISE(ABORT,'TABLE_PREPAYMENT_PAYER_EXCEEDED'); END;
