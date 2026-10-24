-- Additive opt-in offline authority and transactional ledger outbox. Safe with existing tenant tables.
CREATE TABLE offline_branch_authority (
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,gateway_id TEXT NOT NULL,
 epoch INTEGER NOT NULL DEFAULT 1 CHECK(epoch>0),
 mode TEXT NOT NULL CHECK(mode IN('LOCAL','RECONCILING','CLOUD')),
 activated_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,branch_id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
 FOREIGN KEY(gateway_id) REFERENCES offline_gateways(id)
);
CREATE TABLE offline_replay_grants(
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,mutation_id TEXT NOT NULL,
 gateway_id TEXT NOT NULL,epoch INTEGER NOT NULL,payload_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,branch_id,mutation_id)
);
CREATE TABLE offline_replay_receipts(
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 epoch INTEGER NOT NULL CHECK(epoch>0),sequence INTEGER NOT NULL CHECK(sequence>0),
 mutation_id TEXT NOT NULL,payload_hash TEXT NOT NULL,
 result_json TEXT NOT NULL,acked_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,branch_id,epoch,sequence),
 UNIQUE(tenant_id,branch_id,mutation_id)
);
-- The local-only intent is persisted BEFORE executing the canonical transaction.
CREATE TABLE offline_pending_requests(
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,mutation_id TEXT NOT NULL,
 operator_id TEXT NOT NULL,method TEXT NOT NULL,path TEXT NOT NULL,
 body_json TEXT NOT NULL,payload_hash TEXT NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,mutation_id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE TABLE offline_local_authority(
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,gateway_id TEXT NOT NULL,
 epoch INTEGER NOT NULL,mode TEXT NOT NULL CHECK(mode IN('LOCAL','CLOUD','RECONCILING')),
 refreshed_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,branch_id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE TABLE offline_outbox(
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,gateway_id TEXT NOT NULL,
 epoch INTEGER NOT NULL,mutation_id TEXT NOT NULL,
 operator_id TEXT NOT NULL,method TEXT NOT NULL,path TEXT NOT NULL,
 body_json TEXT NOT NULL,payload_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','ACKED','CONFLICT')),
 created_at INTEGER NOT NULL,acked_at INTEGER,
 UNIQUE(tenant_id,mutation_id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE INDEX idx_offline_outbox_pending ON offline_outbox(status,sequence);
-- The audit record and its outbox event commit in the SAME SQLite transaction.
-- No risk of completing stock movements while silently losing the replay intent.
CREATE TRIGGER offline_outbox_committed_mutation
AFTER INSERT ON commerce_mutations
WHEN EXISTS(
 SELECT 1 FROM offline_pending_requests p JOIN offline_local_authority a
 ON a.tenant_id=p.tenant_id AND a.branch_id=p.branch_id
 WHERE p.tenant_id=NEW.tenant_id AND p.mutation_id=NEW.mutation_id
 AND a.mode='LOCAL' AND NEW.scope IN('inventory.receipt:'||p.branch_id,'inventory.adjust:'||p.branch_id)
)
BEGIN
 INSERT INTO offline_outbox(tenant_id,branch_id,gateway_id,epoch,mutation_id,
 operator_id,method,path,body_json,payload_hash,created_at)
 SELECT p.tenant_id,p.branch_id,a.gateway_id,a.epoch,p.mutation_id,
 p.operator_id,p.method,p.path,p.body_json,p.payload_hash,p.created_at
 FROM offline_pending_requests p JOIN offline_local_authority a
 ON a.tenant_id=p.tenant_id AND a.branch_id=p.branch_id
 WHERE p.tenant_id=NEW.tenant_id AND p.mutation_id=NEW.mutation_id;
END;
-- Physically fence stock mutation commits in D1, even if an in-flight cloud
-- request already passed the HTTP-level LOCAL mode check before activation.
CREATE TRIGGER offline_fence_inventory
BEFORE INSERT ON inventory_movements
WHEN EXISTS (
 SELECT 1 FROM offline_branch_authority a WHERE a.tenant_id=NEW.tenant_id
 AND a.branch_id=NEW.branch_id AND a.mode IN('LOCAL','RECONCILING')
)
AND NOT EXISTS (
 SELECT 1 FROM offline_replay_grants g JOIN offline_branch_authority a
 ON a.tenant_id=g.tenant_id AND a.branch_id=g.branch_id
 WHERE g.tenant_id=NEW.tenant_id AND g.branch_id=NEW.branch_id
 AND g.mutation_id=NEW.mutation_id AND g.gateway_id=a.gateway_id AND g.epoch=a.epoch
)
BEGIN SELECT RAISE(ABORT,'OFFLINE_BRANCH_FENCED'); END;
-- Other ledger writes do not have a replay path yet. Block them in D1 while
-- this branch is under local authority (fail closed rather than split-brain).
CREATE TRIGGER offline_fence_sales
BEFORE INSERT ON sales
WHEN EXISTS(SELECT 1 FROM offline_branch_authority a
 WHERE a.tenant_id=NEW.tenant_id AND a.branch_id=NEW.branch_id AND a.mode IN('LOCAL','RECONCILING'))
BEGIN SELECT RAISE(ABORT,'OFFLINE_BRANCH_FENCED'); END;
