'use strict';

const { sanitizeAuditPayload } = require('../audit-log');

function ensureSystemLogsTable(db){
  db.exec(`CREATE TABLE IF NOT EXISTS system_logs(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL CHECK(level IN('debug','info','warn','error')),
    subsystem TEXT NOT NULL,
    message TEXT NOT NULL,
    correlation_id TEXT,
    terminal_id TEXT,
    context_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_system_logs_filter ON system_logs(level,subsystem,terminal_id,created_at);`);
}

function mapRow(row){
  if(!row)return null;let context=null;try{context=row.context_json?JSON.parse(row.context_json):null;}catch{context=null;}
  return{id:row.id,level:row.level,subsystem:row.subsystem,message:row.message,correlationId:row.correlation_id,terminalId:row.terminal_id,context,createdAt:row.created_at};
}

function createSystemLogger({db,now=()=>new Date().toISOString(),retention=5000}={}){
  if(!db)throw new TypeError('Database is required.');ensureSystemLogsTable(db);const limit=Math.max(100,Math.min(Number(retention)||5000,50000));
  function log(entry={}){
    const level=String(entry.level||'info').toLowerCase();if(!['debug','info','warn','error'].includes(level))throw new Error('Nivel de log invalido.');
    const subsystem=String(entry.subsystem||'system').slice(0,80);const message=String(entry.message||'').slice(0,1500);const context=entry.context==null?null:sanitizeAuditPayload(entry.context);
    const createdAt=now();const result=db.prepare(`INSERT INTO system_logs(level,subsystem,message,correlation_id,terminal_id,context_json,created_at) VALUES(?,?,?,?,?,?,?)`).run(level,subsystem,message,entry.correlationId?String(entry.correlationId):null,entry.terminalId?String(entry.terminalId):null,context==null?null:JSON.stringify(context),createdAt);
    db.prepare(`DELETE FROM system_logs WHERE id IN (SELECT id FROM system_logs ORDER BY id DESC LIMIT -1 OFFSET ?)` ).run(limit);
    return mapRow(db.prepare('SELECT * FROM system_logs WHERE id=?').get(Number(result.lastInsertRowid)));
  }
  function list(filters={}){const clauses=[];const params=[];for(const [key,column] of [['level','level'],['subsystem','subsystem'],['terminalId','terminal_id'],['correlationId','correlation_id']])if(filters[key]){clauses.push(`${column}=?`);params.push(String(filters[key]));}if(filters.from){clauses.push('created_at>=?');params.push(String(filters.from));}if(filters.to){clauses.push('created_at<=?');params.push(String(filters.to));}const requested=Math.max(1,Math.min(Number(filters.limit)||200,1000));params.push(requested);return db.prepare(`SELECT * FROM system_logs${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY created_at DESC,id DESC LIMIT ?`).all(...params).map(mapRow);}
  return{log,list};
}

module.exports={createSystemLogger,ensureSystemLogsTable};
