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
