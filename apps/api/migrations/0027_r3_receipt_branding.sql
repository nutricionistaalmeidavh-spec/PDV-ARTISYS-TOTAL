-- Hosted SaaS R3: branch-canonical non-fiscal receipt identity and immutable sale-time snapshot.
-- Client browsers are consumers, never the source of truth for sales or branding.
CREATE TABLE r3_receipt_branding(
 tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 address TEXT NOT NULL DEFAULT '' CHECK(length(address)<=160),
 phone TEXT NOT NULL DEFAULT '' CHECK(length(phone)<=60),
 logo_data_url TEXT CHECK(logo_data_url IS NULL OR length(logo_data_url)<=720000),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,branch_id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id) ON DELETE RESTRICT
);
CREATE TABLE r3_sale_branding_snapshots(
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,sale_id TEXT NOT NULL,
 branding_json TEXT NOT NULL CHECK(json_valid(branding_json)),
 created_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,branch_id,sale_id),
 FOREIGN KEY(tenant_id,branch_id,sale_id) REFERENCES sales(tenant_id,branch_id,id) ON DELETE RESTRICT
);
-- Capture at the same SQLite/D1 sale-completion commit, NOT first print.
CREATE TRIGGER r3_sale_branding_freeze AFTER UPDATE OF status ON sales
WHEN NEW.status='COMPLETED' AND OLD.status<>'COMPLETED'
BEGIN
 INSERT INTO r3_sale_branding_snapshots(tenant_id,branch_id,sale_id,branding_json,created_at)
 VALUES(NEW.tenant_id,NEW.branch_id,NEW.id,
  COALESCE((SELECT json_object('name',name,'address',address,'phone',phone,'logoDataUrl',logo_data_url)
    FROM r3_receipt_branding WHERE tenant_id=NEW.tenant_id AND branch_id=NEW.branch_id),
   json_object('name','PDV TOTAL','address','','phone','','logoDataUrl',NULL)),
  COALESCE(NEW.completed_at,NEW.created_at));
END;
CREATE TRIGGER r3_snapshot_immutable_update BEFORE UPDATE ON r3_sale_branding_snapshots
BEGIN SELECT RAISE(ABORT,'RECEIPT_BRANDING_IMMUTABLE'); END;
CREATE TRIGGER r3_snapshot_immutable_delete BEFORE DELETE ON r3_sale_branding_snapshots
BEGIN SELECT RAISE(ABORT,'RECEIPT_BRANDING_IMMUTABLE'); END;
