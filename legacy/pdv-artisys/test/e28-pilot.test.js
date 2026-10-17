'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {createPilotService,PILOT_STATES}=require('../js/core/pilot/pilot-service');

function fixture(){
 const db=openDatabase(':memory:');runMigrations(db);let seq=0;const now=()=>new Date(1789004400000+seq++*1000).toISOString();
 const authorization={require({principal,capability}){assert.equal(capability,'settings.manage');if(principal?.id==='cash'){const error=new Error('Permissao insuficiente.');error.statusCode=403;throw error;}return true;}};
 return{db,pilot:createPilotService({db,authorization,now})};
}

test('pilot seeds required field checks idempotently with explicit states',()=>{const {db,pilot}=fixture();try{
 const first=pilot.listChecks();const second=pilot.listChecks();assert.equal(first.length,second.length);assert.ok(first.length>=12);assert.equal(new Set(first.map(x=>x.key)).size,first.length);
 for(const key of ['identify-server','store-config','terminal-register','lan-test','printer-test','drawer-test','backup-manual','sale-test','return-test','cash-close-test','diagnostics'])assert.ok(first.some(x=>x.key===key),key);
 assert.deepEqual(PILOT_STATES,['NOT_STARTED','IN_PROGRESS','READY','BLOCKED','BLOCKED_EXTERNAL','NOT_APPLICABLE']);assert.equal(first.every(x=>x.status==='NOT_STARTED'),true);
}finally{db.close();}});

test('pilot updates persist evidence and enforce settings.manage capability',()=>{const {db,pilot}=fixture();try{
 const updated=pilot.updateCheck('lan-test',{status:'READY',note:'Ping e handshake OK',evidence:{terminalId:'PDV-02',latencyMs:5},actor:{userId:'mgr',profileId:'profile-manager'}});assert.equal(updated.status,'READY');assert.equal(updated.note,'Ping e handshake OK');assert.equal(updated.evidence.terminalId,'PDV-02');assert.equal(updated.updatedBy,'mgr');
 assert.throws(()=>pilot.updateCheck('sale-test',{status:'READY',actor:{userId:'cash',profileId:'profile-cashier'}}),/permiss/i);assert.throws(()=>pilot.updateCheck('sale-test',{status:'FAKE',actor:{userId:'admin',profileId:'profile-administrator'}}),/estado/i);
 const audit=db.prepare("SELECT action,entity_id FROM audit_log WHERE action='pilot.check.update' ORDER BY id DESC LIMIT 1").get();assert.equal(audit.entity_id,'lan-test');
}finally{db.close();}});

test('BLOCKED_EXTERNAL is reported as external blocker and never as READY',()=>{const {db,pilot}=fixture();try{
 for(const item of pilot.listChecks())pilot.updateCheck(item.key,{status:'READY',actor:{userId:'admin',profileId:'profile-administrator'}});
 assert.equal(pilot.readiness().status,'READY');
 pilot.updateCheck('scale-test',{status:'BLOCKED_EXTERNAL',note:'BalanÃƒÂ§a fÃƒÂ­sica ainda nÃƒÂ£o disponÃƒÂ­vel para validaÃƒÂ§ÃƒÂ£o.',actor:{userId:'admin',profileId:'profile-administrator'}});
 const readiness=pilot.readiness();assert.equal(readiness.status,'BLOCKED_EXTERNAL');assert.equal(readiness.ready,false);assert.deepEqual(readiness.externalBlockers.map(x=>x.key),['scale-test']);
}finally{db.close();}});

test('internal BLOCKED has precedence and incomplete checklist is not release-ready',()=>{const {db,pilot}=fixture();try{
 let state=pilot.readiness();assert.equal(state.status,'NOT_STARTED');assert.equal(state.ready,false);
 pilot.updateCheck('identify-server',{status:'READY',actor:{userId:'admin',profileId:'profile-administrator'}});state=pilot.readiness();assert.equal(state.status,'IN_PROGRESS');
 pilot.updateCheck('lan-test',{status:'BLOCKED',note:'Falha interna',actor:{userId:'admin',profileId:'profile-administrator'}});state=pilot.readiness();assert.equal(state.status,'BLOCKED');assert.equal(state.ready,false);assert.equal(state.blockers[0].key,'lan-test');
}finally{db.close();}});


test('optional checks can be not applicable without blocking readiness',()=>{const {db,pilot}=fixture();try{
 for(const item of pilot.listChecks())pilot.updateCheck(item.key,{status:item.optional?'NOT_APPLICABLE':'READY',actor:{userId:'admin'}});
 assert.equal(pilot.readiness().ready,true);assert.equal(pilot.readiness().notApplicableCount,3);assert.equal(pilot.readiness().incompleteCount,0);
 assert.throws(()=>pilot.updateCheck('store-config',{status:'NOT_APPLICABLE'}),/obrigatoria/);
 assert.throws(()=>pilot.updateCheck('scale-test',{status:'NOT_APPLICABLE',actor:{userId:'cash'}}),/permiss/i);
}finally{db.close();}});

test('legacy checklist CHECK migration retains notes evidence and audit',()=>{const db=openDatabase(':memory:');runMigrations(db);try{
 db.exec(`CREATE TABLE pilot_checks(check_key TEXT PRIMARY KEY,title TEXT NOT NULL,category TEXT NOT NULL,optional INTEGER NOT NULL DEFAULT 0 CHECK(optional IN(0,1)),status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK(status IN('NOT_STARTED','IN_PROGRESS','READY','BLOCKED','BLOCKED_EXTERNAL')),note TEXT,evidence_json TEXT,updated_by TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`);
 db.prepare('INSERT INTO pilot_checks VALUES(?,?,?,?,?,?,?,?,?,?)').run('scale-test','Scale','hardware',1,'BLOCKED','Keep note','{"port":"COM1"}','manager','2026-01-01','2026-01-02');
 const pilot=createPilotService({db});const original=pilot.getCheck('scale-test');assert.equal(original.note,'Keep note');assert.deepEqual(original.evidence,{port:'COM1'});assert.equal(original.updatedBy,'manager');
 pilot.updateCheck('scale-test',{status:'NOT_APPLICABLE',note:'No scale',actor:{userId:'admin'}});
 createPilotService({db});assert.equal(pilot.getCheck('scale-test').status,'NOT_APPLICABLE');assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='pilot.check.update'").get().n,1);
}finally{db.close();}});

test('objective store diagnostic detects config removal and respects manual blockers',()=>{const {db,pilot}=fixture();try{
 require('../js/core/settings/settings-service').ensureSettingsTable(db);
 db.prepare("INSERT INTO app_settings(scope,setting_key,value_json,value_type,created_at,updated_at) VALUES('global','store.name',?,'string',?,?)").run('"Minha loja"','2026-01-01','2026-01-01');
 assert.equal(pilot.listChecks().find(x=>x.key==='store-config').status,'READY');assert.equal(pilot.getCheck('store-config').evidence.source,'configuration');
 assert.equal(pilot.getCheck('scale-test').status,'NOT_STARTED');
 const auditCount=db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='pilot.check.diagnostic'").get().n;pilot.listChecks();assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='pilot.check.diagnostic'").get().n,auditCount);
 db.prepare("DELETE FROM app_settings WHERE setting_key='store.name'").run();pilot.listChecks();assert.equal(pilot.getCheck('store-config').status,'NOT_STARTED');
 pilot.updateCheck('store-config',{status:'BLOCKED',note:'Review required'});
 db.prepare("INSERT INTO app_settings(scope,setting_key,value_json,value_type,created_at,updated_at) VALUES('global','store.name',?,'string',?,?)").run('"Configured"','2026-01-01','2026-01-01');pilot.listChecks();assert.equal(pilot.getCheck('store-config').status,'BLOCKED');
}finally{db.close();}});


test('audited import and diagnostic actions complete only their objective checks',()=>{const {db,pilot}=fixture();try{
 const {writeAudit}=require('../js/core/audit-log');
 for(const action of ['import.commit','diagnostics.create'])writeAudit(db,{action,entity:'operation',entityId:'test',actor:{userId:'admin'},context:{}});
 pilot.listChecks();assert.equal(pilot.getCheck('import-test').status,'READY');assert.equal(pilot.getCheck('diagnostics').status,'READY');assert.equal(pilot.getCheck('restore-test').status,'NOT_STARTED');assert.equal(pilot.getCheck('scale-test').status,'NOT_STARTED');
}finally{db.close();}});


test('local deployment skips network checks and hosting never claims connectivity',()=>{const {db,pilot}=fixture();try{
 pilot.setDeploymentContext({mode:'local',selected:true});assert.equal(pilot.getCheck('identify-server').status,'READY');assert.equal(pilot.getCheck('terminal-register').status,'NOT_APPLICABLE');assert.equal(pilot.getCheck('lan-test').status,'NOT_APPLICABLE');
 pilot.setDeploymentContext({mode:'lan-host',selected:true});assert.equal(pilot.getCheck('lan-test').status,'NOT_STARTED');assert.equal(pilot.getCheck('terminal-register').status,'NOT_STARTED');
 pilot.updateCheck('lan-test',{status:'BLOCKED',note:'Firewall'});pilot.setDeploymentContext({mode:'local',selected:true});assert.equal(pilot.getCheck('lan-test').status,'BLOCKED');
 assert.equal(pilot.getCheck('scale-test').status,'NOT_STARTED');
}finally{db.close();}});
