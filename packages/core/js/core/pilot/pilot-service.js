'use strict';
const {principalFromActor}=require('../auth/principal-resolver');

const { writeAudit }=require('../audit-log');

const PILOT_STATES=Object.freeze(['NOT_STARTED','IN_PROGRESS','READY','BLOCKED','BLOCKED_EXTERNAL','NOT_APPLICABLE']);
const PILOT_CHECKS=Object.freeze([
  {key:'identify-server',title:'Identificar servidor',category:'deployment'},
  {key:'store-config',title:'Configurar loja',category:'configuration'},
  {key:'terminal-register',title:'Cadastrar e parear terminal',category:'lan'},
  {key:'lan-test',title:'Testar comunicação LAN',category:'lan'},
  {key:'printer-test',title:'Testar impressora',category:'hardware'},
  {key:'drawer-test',title:'Testar gaveta quando aplicável',category:'hardware',optional:true},
  {key:'scale-test',title:'Testar balança quando aplicável',category:'hardware',optional:true},
  {key:'backup-manual',title:'Executar backup manual',category:'recovery'},
  {key:'restore-test',title:'Validar restore controlado',category:'recovery'},
  {key:'sale-test',title:'Executar venda teste',category:'operations'},
  {key:'return-test',title:'Executar cancelamento/devolução teste',category:'operations'},
  {key:'cash-close-test',title:'Executar fechamento de caixa teste',category:'operations'},
  {key:'import-test',title:'Validar importação inicial quando aplicável',category:'migration',optional:true},
  {key:'diagnostics',title:'Gerar pacote de diagnóstico',category:'support'}
]);

function ensurePilotTable(db){
  const schema=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='pilot_checks'").get();
  if(schema&&!schema.sql.includes("'NOT_APPLICABLE'")){
    // SQLite cannot alter CHECK constraints. Copy all persisted evidence atomically.
    db.exec('BEGIN IMMEDIATE');
    try{
      db.exec('ALTER TABLE pilot_checks RENAME TO pilot_checks_previous; DROP INDEX IF EXISTS idx_pilot_checks_status;');
      ensurePilotTable(db);
      db.exec('INSERT INTO pilot_checks SELECT * FROM pilot_checks_previous; DROP TABLE pilot_checks_previous; COMMIT;');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return;
  }
  db.exec(`CREATE TABLE IF NOT EXISTS pilot_checks(
    check_key TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    optional INTEGER NOT NULL DEFAULT 0 CHECK(optional IN(0,1)),
    status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK(status IN('NOT_STARTED','IN_PROGRESS','READY','BLOCKED','BLOCKED_EXTERNAL','NOT_APPLICABLE')),
    note TEXT,
    evidence_json TEXT,
    updated_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pilot_checks_status ON pilot_checks(status,category);`);
}
function mapRow(row){if(!row)return null;let evidence=null;try{evidence=row.evidence_json?JSON.parse(row.evidence_json):null;}catch{evidence=null;}return{key:row.check_key,title:row.title,category:row.category,optional:Boolean(row.optional),status:row.status,note:row.note,evidence,updatedBy:row.updated_by,createdAt:row.created_at,updatedAt:row.updated_at};}
function assertActor(actor,authorization){if(authorization)authorization.require({principal:principalFromActor(actor),capability:'settings.manage'});}
function sanitizeEvidence(value){if(value==null)return null;if(typeof value!=='object'||Array.isArray(value))throw new Error('Evidencia do piloto deve ser um objeto.');const text=JSON.stringify(value);if(text.length>12000)throw new Error('Evidencia do piloto excede o limite.');return value;}

function createPilotService({db,authorization=null,now=()=>new Date().toISOString()}={}){
  if(!db)throw new TypeError('Database is required.');ensurePilotTable(db);
  const insert=db.prepare(`INSERT OR IGNORE INTO pilot_checks(check_key,title,category,optional,status,created_at,updated_at) VALUES(?,?,?,?, 'NOT_STARTED',?,?)`);
  const seededAt=now();for(const item of PILOT_CHECKS)insert.run(item.key,item.title,item.category,item.optional?1:0,seededAt,seededAt);
  for(const item of PILOT_CHECKS)db.prepare('UPDATE pilot_checks SET title=?,optional=? WHERE check_key=?').run(item.title,item.optional?1:0,item.key);

  function refreshDiagnostics(){
    // Only objective configuration is inferred. Presence of sales or devices is not
    // evidence of a successful supervised equipment/recovery test.
    for(const [key,action,label] of [['import-test','import.commit','Importacao concluida.'],['diagnostics','diagnostics.create','Pacote de diagnostico gerado.']]){
      const current=getCheck(key);if(current.status!=='NOT_STARTED')continue;
      const event=db.prepare('SELECT id,created_at FROM audit_log WHERE action=? ORDER BY id DESC LIMIT 1').get(action);
      if(!event)continue;
      const evidence={source:'audit',action,auditId:event.id,performedAt:event.created_at};
      db.prepare('UPDATE pilot_checks SET status=?,note=?,evidence_json=?,updated_by=?,updated_at=? WHERE check_key=?').run('READY',label+' Verificado automaticamente.',JSON.stringify(evidence),'system',now(),key);
      writeAudit(db,{action:'pilot.check.diagnostic',entity:'pilot-check',entityId:key,actor:{userId:'system'},context:{from:current.status,to:'READY',evidence}},now);
    }
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='app_settings'").get())return;
    const row=db.prepare("SELECT value_json FROM app_settings WHERE scope='global' AND setting_key='store.name'").get();
    let name=null;try{name=row?JSON.parse(row.value_json):null;}catch{}
    const existing=getCheck('store-config');
    const automatic=existing.evidence?.source==='configuration';
    if(typeof name==='string'&&name.trim()){
      if(existing.status==='NOT_STARTED'||automatic&&existing.status!=='READY'){
        const evidence={source:'configuration',setting:'store.name'};
        db.prepare('UPDATE pilot_checks SET status=?,note=?,evidence_json=?,updated_by=?,updated_at=? WHERE check_key=?').run('READY','Nome da loja configurado. Verificado automaticamente.',JSON.stringify(evidence),'system',now(),'store-config');
        writeAudit(db,{action:'pilot.check.diagnostic',entity:'pilot-check',entityId:'store-config',actor:{userId:'system'},context:{from:existing.status,to:'READY',evidence}},now);
      }
    }else if(automatic&&existing.status==='READY'){
      db.prepare('UPDATE pilot_checks SET status=?,note=?,updated_at=? WHERE check_key=?').run('NOT_STARTED','Configure o nome da loja.',now(),'store-config');
      writeAudit(db,{action:'pilot.check.diagnostic',entity:'pilot-check',entityId:'store-config',actor:{userId:'system'},context:{from:'READY',to:'NOT_STARTED'}},now);
    }
  }

  function setDeploymentContext({mode,selected=false}={}){
    if(!['local','lan-host','lan-client','own-server'].includes(mode))return;
    const updates=[['identify-server',selected?'READY':'NOT_STARTED',selected?'Papel deste computador configurado.':'Escolha o papel deste computador.']];
    for(const key of ['terminal-register','lan-test'])updates.push([key,selected&&mode==='local'?'NOT_APPLICABLE':'NOT_STARTED',selected&&mode==='local'?'Operacao somente neste computador; rede e pareamento nao se aplicam.':'Confirme o pareamento/comunicacao apos testar a rede.']);
    for(const [key,status,note] of updates){
      const check=getCheck(key);const automatic=check.evidence?.source==='deployment';
      if(check.status!=='NOT_STARTED'&&!automatic)continue;
      if(check.status===status&&check.evidence?.mode===mode)continue;
      const evidence={source:'deployment',mode,selected:Boolean(selected)};
      db.prepare('UPDATE pilot_checks SET status=?,note=?,evidence_json=?,updated_by=?,updated_at=? WHERE check_key=?').run(status,note,JSON.stringify(evidence),'system',now(),key);
      writeAudit(db,{action:'pilot.check.diagnostic',entity:'pilot-check',entityId:key,actor:{userId:'system'},context:{from:check.status,to:status,evidence}},now);
    }
  }

  function listChecks(){refreshDiagnostics();return db.prepare('SELECT * FROM pilot_checks ORDER BY rowid').all().map(mapRow);}
  function getCheck(key){return mapRow(db.prepare('SELECT * FROM pilot_checks WHERE check_key=?').get(String(key)));}
  function updateCheck(key,{status,note=null,evidence=null,actor={}}={}){
    assertActor(actor,authorization);const normalizedStatus=String(status||'').toUpperCase();if(!PILOT_STATES.includes(normalizedStatus))throw new Error('Estado de piloto invalido.');const existing=getCheck(key);if(!existing)throw new Error('Item do checklist de piloto nao encontrado.');
    if(normalizedStatus==='NOT_APPLICABLE'&&!existing.optional)throw new Error('Esta verificacao e obrigatoria.');
    const safeEvidence=sanitizeEvidence(evidence);const safeNote=note==null?null:String(note).trim().slice(0,2000)||null;const timestamp=now();
    db.prepare('UPDATE pilot_checks SET status=?,note=?,evidence_json=?,updated_by=?,updated_at=? WHERE check_key=?').run(normalizedStatus,safeNote,safeEvidence==null?null:JSON.stringify(safeEvidence),actor.userId||null,timestamp,existing.key);
    writeAudit(db,{action:'pilot.check.update',entity:'pilot-check',entityId:existing.key,actor,context:{from:existing.status,to:normalizedStatus,note:safeNote,evidence:safeEvidence}},now);
    return getCheck(existing.key);
  }
  function readiness(){
    const checks=listChecks();const blockers=checks.filter(item=>item.status==='BLOCKED');const externalBlockers=checks.filter(item=>item.status==='BLOCKED_EXTERNAL');const incomplete=checks.filter(item=>!['READY','NOT_APPLICABLE','BLOCKED','BLOCKED_EXTERNAL'].includes(item.status));
    let status='NOT_STARTED';if(blockers.length)status='BLOCKED';else if(externalBlockers.length)status='BLOCKED_EXTERNAL';else if(checks.length&&checks.every(item=>['READY','NOT_APPLICABLE'].includes(item.status)))status='READY';else if(checks.some(item=>item.status!=='NOT_STARTED'))status='IN_PROGRESS';
    return{status,ready:status==='READY',total:checks.length,readyCount:checks.filter(item=>item.status==='READY').length,notApplicableCount:checks.filter(item=>item.status==='NOT_APPLICABLE').length,blockedCount:blockers.length,externalBlockedCount:externalBlockers.length,incompleteCount:incomplete.length,blockers,externalBlockers,incomplete,updatedAt:checks.reduce((latest,item)=>!latest||item.updatedAt>latest?item.updatedAt:latest,null)};
  }
  return{listChecks,getCheck,updateCheck,readiness,setDeploymentContext};
}

module.exports={PILOT_STATES,PILOT_CHECKS,createPilotService,ensurePilotTable};
