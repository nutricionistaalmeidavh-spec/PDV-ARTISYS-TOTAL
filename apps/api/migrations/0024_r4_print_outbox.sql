-- R4 print spool: durable local-first outbox. Nothing prints until an authorized local
-- print agent claims a job. Never call a printer directly inside D1 or checkout.
CREATE TABLE r4_kitchen_print_jobs (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 branch_id TEXT NOT NULL,
 station_ticket_id TEXT NOT NULL,
 printer_name TEXT NOT NULL CHECK(length(printer_name) BETWEEN 1 AND 120),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND length(payload_json)<=16000),
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','LEASED','FAILED','PRINTED','CANCELLED')),
 attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 8),
 lease_token TEXT,
 leased_until TEXT,
 last_error TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(tenant_id,branch_id,station_ticket_id),
 FOREIGN KEY(tenant_id,branch_id,station_ticket_id) REFERENCES r4_station_tickets(tenant_id,branch_id,id),
 CHECK ((status='LEASED' AND lease_token IS NOT NULL AND leased_until IS NOT NULL) OR
        (status<>'LEASED' AND lease_token IS NULL AND leased_until IS NULL))
);
CREATE INDEX idx_r4_print_claim ON r4_kitchen_print_jobs(tenant_id,branch_id,status,created_at);
CREATE TRIGGER r4_print_no_mutate_identity BEFORE UPDATE ON r4_kitchen_print_jobs
WHEN NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.branch_id<>OLD.branch_id OR
     NEW.station_ticket_id<>OLD.station_ticket_id OR NEW.printer_name<>OLD.printer_name OR
     NEW.payload_json<>OLD.payload_json OR NEW.created_at<>OLD.created_at OR
     OLD.status='PRINTED' AND NEW.status<>'PRINTED' OR
     OLD.status='CANCELLED' AND NEW.status<>'CANCELLED'
BEGIN SELECT RAISE(ABORT,'R4_PRINT_JOB_IMMUTABLE'); END;
CREATE TRIGGER r4_print_no_delete BEFORE DELETE ON r4_kitchen_print_jobs
BEGIN SELECT RAISE(ABORT,'R4_PRINT_JOB_IMMUTABLE'); END;

-- Desktop-compatible pizza policy is explicit. Existing 0023 absolute-price
-- profiles retain their behavior; new catalogs may opt into base+delta semantics.
ALTER TABLE r4_pizza_profiles ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'ABSOLUTE_OPTIONS'
 CHECK(pricing_mode IN('ABSOLUTE_OPTIONS','DESKTOP_DELTAS'));
