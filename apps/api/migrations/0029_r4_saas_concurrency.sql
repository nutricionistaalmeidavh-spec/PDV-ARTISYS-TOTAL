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
