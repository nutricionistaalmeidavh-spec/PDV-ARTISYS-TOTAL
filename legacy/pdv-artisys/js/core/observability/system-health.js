'use strict';

function tableExists(db,name){return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));}
function count(db,sql,...params){try{return Number(db.prepare(sql).get(...params)?.n||0);}catch{return 0;}}
function parseJson(value){try{return value?JSON.parse(value):null;}catch{return null;}}

function createSystemHealth({db,version='0.0.0',backupStatus=()=>({count:0,latest:null})}={}){
  if(!db)throw new TypeError('Database is required.');
  function snapshot(){
    let database={ok:false,integrity:'unknown'};try{const row=db.prepare('PRAGMA quick_check').get();const integrity=row?.quick_check||Object.values(row||{})[0];database={ok:integrity==='ok',integrity};}catch(error){database={ok:false,integrity:'error',error:error.message};}
    const schemaVersion=tableExists(db,'schema_migrations')?Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get().version):0;
    const backups=(()=>{try{return backupStatus()||{count:0,latest:null};}catch{return{count:0,latest:null,error:true};}})();
    return{
      version,schemaVersion,database,
      outbox:{pending:count(db,'SELECT COUNT(*) AS n FROM domain_events WHERE dispatched_at IS NULL'),failed:count(db,"SELECT COUNT(*) AS n FROM domain_events WHERE dispatched_at IS NULL AND last_error IS NOT NULL AND last_error<>''")},
      effects:{applied:count(db,'SELECT COUNT(*) AS n FROM domain_event_effects')},
      terminals:{total:tableExists(db,'terminals')?count(db,'SELECT COUNT(*) AS n FROM terminals'):0,blocked:tableExists(db,'terminals')?count(db,"SELECT COUNT(*) AS n FROM terminals WHERE status='BLOCKED'"):0},
      printing:{pending:tableExists(db,'print_jobs')?count(db,"SELECT COUNT(*) AS n FROM print_jobs WHERE status='PENDING'"):0,failed:tableExists(db,'print_jobs')?count(db,"SELECT COUNT(*) AS n FROM print_jobs WHERE status='FAILED'"):0},
      fiscal:{pending:tableExists(db,'fiscal_documents')?count(db,"SELECT COUNT(*) AS n FROM fiscal_documents WHERE status='PENDING'"):0,failed:tableExists(db,'fiscal_documents')?count(db,"SELECT COUNT(*) AS n FROM fiscal_documents WHERE status='FAILED'"):0},
      backups
    };
  }
  function listAudit(filters={}){const clauses=[];const params=[];for(const [key,column] of [['actorId','actor_id'],['actorRole','actor_role'],['entity','entity'],['action','action'],['entityId','entity_id']])if(filters[key]){clauses.push(`${column}=?`);params.push(String(filters[key]));}if(filters.from){clauses.push('created_at>=?');params.push(String(filters.from));}if(filters.to){clauses.push('created_at<=?');params.push(String(filters.to));}const limit=Math.max(1,Math.min(Number(filters.limit)||200,1000));params.push(limit);return db.prepare(`SELECT * FROM audit_log${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY created_at DESC,id DESC LIMIT ?`).all(...params).map(row=>({id:row.id,action:row.action,entity:row.entity,entityId:row.entity_id,actorId:row.actor_id,actorRole:row.actor_role,context:parseJson(row.context_json),createdAt:row.created_at}));}
  return{snapshot,listAudit};
}

module.exports={createSystemHealth};
