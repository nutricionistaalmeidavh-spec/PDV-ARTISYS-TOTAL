'use strict';
const ERROR_EVENTS=new Set(['sale_failed','return_failed','printer_failed','fiscal_failed','database_failed','network_failed','operation_failed']);
function createTelemetryQueue({db,now=()=>new Date().toISOString(),maxPending=5000}={}){
 if(!db)throw new TypeError('Database is required.');if(!Number.isInteger(maxPending)||maxPending<1)throw new TypeError('maxPending invalido.');
 db.exec(`CREATE TABLE IF NOT EXISTS telemetry_events (id TEXT PRIMARY KEY,event_name TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TEXT,priority INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS idx_telemetry_events_ready ON telemetry_events(next_attempt_at,priority,created_at);`);
 function trim(){const total=count();if(total<=maxPending)return 0;const overflow=total-maxPending;const victims=db.prepare('SELECT id FROM telemetry_events ORDER BY priority ASC, created_at ASC LIMIT ?').all(overflow);for(const row of victims)db.prepare('DELETE FROM telemetry_events WHERE id=?').run(row.id);return victims.length;}
 function enqueue({id,eventName,payload}){db.prepare('INSERT OR IGNORE INTO telemetry_events(id,event_name,payload_json,created_at,attempts,next_attempt_at,priority) VALUES(?,?,?,?,0,NULL,?)').run(String(id),String(eventName),JSON.stringify(payload),now(),ERROR_EVENTS.has(String(eventName))?10:0);trim();return String(id);}
 function listReady(limit=50){const ts=now();return db.prepare('SELECT * FROM telemetry_events WHERE next_attempt_at IS NULL OR next_attempt_at<=? ORDER BY priority DESC,created_at ASC LIMIT ?').all(ts,Number(limit)).map(row=>({id:row.id,eventName:row.event_name,payload:JSON.parse(row.payload_json),createdAt:row.created_at,attempts:Number(row.attempts||0),nextAttemptAt:row.next_attempt_at,priority:Number(row.priority||0)}));}
 function ack(ids=[]){let changed=0;for(const id of ids)changed+=Number(db.prepare('DELETE FROM telemetry_events WHERE id=?').run(String(id)).changes||0);return changed;}
 const discard=ack;
 function reschedule(ids=[],nextAttemptAt){for(const id of ids)db.prepare('UPDATE telemetry_events SET attempts=attempts+1,next_attempt_at=? WHERE id=?').run(nextAttemptAt,String(id));return ids.length;}
 function count(){return Number(db.prepare('SELECT COUNT(*) AS count FROM telemetry_events').get().count||0);}
 function clear(){return Number(db.prepare('DELETE FROM telemetry_events').run().changes||0);}
 function discardEvents(eventNames=[]){const names=[...new Set(eventNames.map(String))];let changed=0;for(const name of names)changed+=Number(db.prepare('DELETE FROM telemetry_events WHERE event_name=?').run(name).changes||0);return changed;}
 function prune(){return trim();}
 return{enqueue,listReady,ack,discard,reschedule,count,clear,discardEvents,prune};
}
module.exports={createTelemetryQueue,ERROR_EVENTS};
