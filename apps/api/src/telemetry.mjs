// SaaS telemetry adapter. Commercial transactions never depend on telemetry delivery.
// D1/SQLite is the free/local canonical fallback; Analytics Engine is an optional sink.
const EVENTS=new Set(['screen_opened','return_started','sale_completed','return_completed','request_finished','ui_error']);
const ROUTES=new Set(['home','checkout','products','customers','inventory','finance','reports','management','sellers','cash','sales','returns','settings','restaurant','tables','kitchen','menu']);
const MODULES=new Set(['','auth','sales','returns','cash','products','customers','inventory','finance','reports','restaurant','printing','settings','network','other']);
const OUTCOMES=new Set(['','success','failed','slow','offline']);
const KEYS=new Set(['id','eventName','branchId','route','module','outcome','durationMs']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json=(payload,status=200)=>new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const reject=(msg,status=422)=>json({error:msg},status);
const asObject=value=>value&&typeof value==='object'&&!Array.isArray(value);
async function readBody(request){
 const raw=await request.text();
 if(raw.length>4096)throw new Error('payload_too_large');
 try{const data=JSON.parse(raw);if(!asObject(data))throw Error();return data;}
 catch{throw new Error('invalid_json');}
}
function validate(data){
 if(Object.keys(data).some(key=>!KEYS.has(key)))return null;
 if(!UUID.test(data.id)||!EVENTS.has(data.eventName)||!ROUTES.has(data.route)||!MODULES.has(data.module||'')||!OUTCOMES.has(data.outcome||'')||
  typeof data.branchId!=='string'||data.branchId.length>128||!/^[-_a-zA-Z0-9]+$/.test(data.branchId))return null;
 const duration=data.durationMs===undefined?0:data.durationMs;
 if(!Number.isInteger(duration)||duration<0||duration>1200000)return null;
 if(data.eventName==='screen_opened'&&data.outcome)return null;
 if(data.eventName==='ui_error'&&data.outcome!=='failed')return null;
 return {id:data.id,eventName:data.eventName,branchId:data.branchId,route:data.route,module:data.module||'',outcome:data.outcome||'',durationMs:duration};
}
export async function tenantTelemetryRoute(request,db,env,membership,tenantId,part,now=Date.now()){
 if(part==='preferences'&&request.method==='GET'){
  const item=await db.prepare('SELECT enabled,diagnostics FROM saas_telemetry_preferences WHERE tenant_id=?').bind(tenantId).first();
  return json({enabled:item?.enabled===1,diagnostics:item?.diagnostics===1});
 }
 if(part==='preferences'&&request.method==='PUT'){
  if(!['OWNER','ADMINISTRATOR','MANAGER'].includes(membership.profileKey))return reject('permission_denied',403);
  let data;try{data=await readBody(request);}catch(e){return reject(e.message,e.message==='payload_too_large'?413:400);}
  if(Object.keys(data).some(k=>!['enabled','diagnostics'].includes(k))||typeof data.enabled!=='boolean'||typeof data.diagnostics!=='boolean')return reject('invalid_preferences');
  const enabled=data.enabled,diagnostics=enabled&&data.diagnostics,at=new Date(now).toISOString();
  await db.prepare(`INSERT INTO saas_telemetry_preferences(tenant_id,enabled,diagnostics,accepted_at,updated_at)
   VALUES(?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET
   enabled=excluded.enabled,diagnostics=excluded.diagnostics,
   accepted_at=CASE WHEN excluded.enabled=1 THEN excluded.accepted_at ELSE saas_telemetry_preferences.accepted_at END,
   updated_at=excluded.updated_at`).bind(tenantId,Number(enabled),Number(diagnostics),enabled?at:null,at).run();
  return json({enabled,diagnostics});
 }
 if(part==='events'&&request.method==='POST'){
  let data;try{data=await readBody(request);}catch(e){return reject(e.message,e.message==='payload_too_large'?413:400);}
  const event=validate(data);if(!event)return reject('invalid_telemetry_event');
  const pref=await db.prepare('SELECT enabled,diagnostics FROM saas_telemetry_preferences WHERE tenant_id=?').bind(tenantId).first();
  if(pref?.enabled!==1||event.eventName==='ui_error'&&pref.diagnostics!==1)return json({accepted:false},202);
  const branch=await db.prepare('SELECT id FROM branches WHERE tenant_id=? AND id=? AND active=1').bind(tenantId,event.branchId).first();
  if(!branch)return reject('invalid_branch');
  const stamp=new Date(now).toISOString();
  const result=await db.prepare(`INSERT OR IGNORE INTO saas_telemetry_events(id,tenant_id,branch_id,event_name,route,module,outcome,duration_ms,occurred_at)
   VALUES(?,?,?,?,?,?,?,?,?)`).bind(event.id,tenantId,event.branchId,event.eventName,event.route,event.module,event.outcome,event.durationMs,stamp).run();
  if(Number(result.meta?.changes||0)>0&&env.TELEMETRY_ANALYTICS_ENABLED==='true'&&env.PDV_TELEMETRY_ANALYTICS?.writeDataPoint){
   try{env.PDV_TELEMETRY_ANALYTICS.writeDataPoint({
    indexes:[tenantId],
    blobs:[event.eventName,event.route,event.module,event.outcome,event.branchId],
    doubles:[1,event.durationMs]
   });}catch{/* local telemetry remains authoritative on sink failure */}
  }
  return json({accepted:true},202);
 }
 return reject('method_not_allowed',405);
}
export async function platformTelemetrySummary(db,now=Date.now()){
 const since=new Date(now-7*86400000).toISOString();
 const [all,byEvents,byTenants,byRoutes,enabled]=await Promise.all([
  db.prepare('SELECT COUNT(*) AS total FROM saas_telemetry_events WHERE occurred_at>=?').bind(since).first(),
  db.prepare(`SELECT event_name AS eventName,outcome,COUNT(*) AS count,CAST(AVG(duration_ms) AS INTEGER) AS avgDurationMs
   FROM saas_telemetry_events WHERE occurred_at>=? GROUP BY event_name,outcome ORDER BY count DESC LIMIT 40`).bind(since).all(),
  db.prepare(`SELECT e.tenant_id AS tenantId,t.name AS name,COUNT(*) AS count
   FROM saas_telemetry_events e JOIN tenants t ON t.id=e.tenant_id
   WHERE e.occurred_at>=? GROUP BY e.tenant_id,t.name ORDER BY count DESC LIMIT 50`).bind(since).all(),
  db.prepare(`SELECT route,COUNT(*) AS count FROM saas_telemetry_events
   WHERE occurred_at>=? AND event_name='screen_opened' GROUP BY route ORDER BY count DESC LIMIT 20`).bind(since).all(),
  db.prepare('SELECT COUNT(*) AS count FROM saas_telemetry_preferences WHERE enabled=1').bind().first()
 ]);
 return {periodDays:7,totalEvents:Number(all?.total||0),enabledTenants:Number(enabled?.count||0),
  events:byEvents.results||[],tenants:byTenants.results||[],routes:byRoutes.results||[]};
}
