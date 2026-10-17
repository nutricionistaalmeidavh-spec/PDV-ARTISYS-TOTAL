'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {createSystemLogger}=require('../js/core/observability/system-logger');
const {createSystemHealth}=require('../js/core/observability/system-health');

function fixture(){const db=openDatabase(':memory:');let seq=0;const now=()=>new Date(1789000800000+seq++*1000).toISOString();runMigrations(db,now);return{db,now};}

test('structured logger sanitizes secret fields before persistence and supports filters',()=>{const f=fixture();try{
 const logger=createSystemLogger({db:f.db,now:f.now});
 logger.log({level:'error',subsystem:'fiscal',message:'Falha de provider',correlationId:'mut-1',terminalId:'PDV-01',context:{saleId:'s1',token:'never-store',password:'never',nested:{authorization:'Bearer x',ok:true}}});
 const rows=logger.list({level:'error',subsystem:'fiscal',terminalId:'PDV-01'});assert.equal(rows.length,1);const raw=JSON.stringify(rows[0]);assert.equal(raw.includes('never-store'),false);assert.equal(raw.includes('Bearer x'),false);assert.equal(rows[0].context.saleId,'s1');assert.equal(rows[0].context.nested.ok,true);
}finally{f.db.close();}});

test('system health reports real schema, queues, terminals, printing and fiscal counts',()=>{const f=fixture();try{
 f.db.prepare("INSERT INTO domain_events(event_id,type,aggregate_type,aggregate_id,source,actor_json,payload_json,occurred_at,last_error) VALUES('e1','x','x','1','server','{}','{}',?,'failed')").run(f.now());
 f.db.exec("CREATE TABLE IF NOT EXISTS backup_records(id TEXT PRIMARY KEY,file_path TEXT,manifest_path TEXT,reason TEXT,app_version TEXT,schema_version INTEGER,sha256 TEXT,size_bytes INTEGER,valid INTEGER,created_at TEXT,validated_at TEXT)");
 const health=createSystemHealth({db:f.db,version:'0.4.0',backupStatus:()=>({count:2,latest:{createdAt:'2026-09-09T00:00:00Z'}})});
 const snapshot=health.snapshot();assert.equal(snapshot.database.ok,true);assert.ok(snapshot.schemaVersion>=3);assert.equal(snapshot.outbox.pending,1);assert.equal(snapshot.outbox.failed,1);assert.equal(snapshot.terminals.total,0);assert.equal(snapshot.printing.pending,0);assert.equal(snapshot.fiscal.failed,0);assert.equal(snapshot.backups.count,2);assert.equal(snapshot.version,'0.4.0');
}finally{f.db.close();}});

test('audit reader filters existing sanitized audit trail without mutation',()=>{const f=fixture();try{
 f.db.prepare("INSERT INTO audit_log(action,entity,entity_id,actor_id,actor_role,context_json,created_at) VALUES('sale.complete','sale','s1','u1','cashier','{\"totalCents\":1000}',?)").run(f.now());
 const health=createSystemHealth({db:f.db});const rows=health.listAudit({actorId:'u1',entity:'sale',action:'sale.complete'});assert.equal(rows.length,1);assert.equal(rows[0].entityId,'s1');assert.deepEqual(rows[0].context,{totalCents:1000});assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n,1);
}finally{f.db.close();}});
