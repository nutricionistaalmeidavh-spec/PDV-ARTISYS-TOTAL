import { validateRegistration, validateBatch, ERROR_EVENTS } from './schema.js';
import { createCredential, hashCredential, authenticateRequest } from './auth.js';
import { registerInstallation, updateInstallationSeen, recordError, purgeReceipts, purgeInactiveControlState } from './storage.js';

const MAX_BODY_BYTES=128*1024;
function json(status,payload){return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function httpError(statusCode,message){return Object.assign(new Error(message),{statusCode});}
async function readJson(request){
  const type=String(request.headers.get('content-type')||'').toLowerCase();if(!type.startsWith('application/json'))throw httpError(415,'Content-Type application/json obrigatorio.');
  const length=Number(request.headers.get('content-length')||0);if(Number.isFinite(length)&&length>MAX_BODY_BYTES)throw httpError(413,'Corpo excede o limite permitido.');
  const text=await request.text();if(new TextEncoder().encode(text).byteLength>MAX_BODY_BYTES)throw httpError(413,'Corpo excede o limite permitido.');
  try{return text?JSON.parse(text):{};}catch{throw httpError(400,'JSON invalido.');}
}
function validateAsClient(fn,input){try{return fn(input);}catch(error){if(error?.statusCode)throw error;throw httpError(422,String(error?.message||'Payload invalido.'));}}
function analyticsPoint(event){const d=event.dimensions||{};const m=event.measurements||{};return{
  indexes:[event.installation_id],
  blobs:[event.event_name,event.terminal_id,event.app_version,event.release_id,d.module||'',d.operation||'',d.subsystem||'',d.result||'',d.state||'',d.fingerprint||'',d.route||'',d.error_class||''],
  doubles:[Number(event.database_schema_version||0),Number(m.duration_ms||0),Number(m.items_count||0),Number(m.payment_methods_count||0),Number(m.attempt||0)]
};}
async function handleRegistration(request,env){const input=validateAsClient(validateRegistration,await readJson(request));const credential=createCredential(32);const hash=await hashCredential(credential);const now=new Date().toISOString();await registerInstallation(env.DB,input,hash,now);return json(201,{installation_id:input.installation_id,credential});}
async function handleEvents(request,env){const auth=await authenticateRequest(request,env.DB);if(!auth)return json(401,{error:'Credencial de telemetria invalida.'});const batch=validateAsClient(validateBatch,await readJson(request));const now=new Date().toISOString();
  for(const event of batch.events){if(event.installation_id!==auth.installation_id)throw httpError(403,'installation_id divergente da credencial.');env.ANALYTICS?.writeDataPoint?.(analyticsPoint(event));if(ERROR_EVENTS.has(event.event_name))await recordError(env.DB,event,now);}
  const last=batch.events.at(-1);if(last)await updateInstallationSeen(env.DB,{installationId:auth.installation_id,appVersion:last.app_version,releaseId:last.release_id},now);try{await purgeReceipts(env.DB,now,30);await purgeInactiveControlState(env.DB,now,180);}catch{/* maintenance must not fail ingestion */}
  return json(202,{accepted:batch.events.length});
}
async function handleRequest(request,env){
  try{const url=new URL(request.url);if(request.method==='GET'&&url.pathname==='/health')return json(200,{ok:true,schemaVersion:1});if(request.method==='POST'&&url.pathname==='/v1/installations/register')return await handleRegistration(request,env);if(request.method==='POST'&&url.pathname==='/v1/events')return await handleEvents(request,env);return json(404,{error:'Not found.'});}
  catch(error){const status=Number(error?.statusCode)||500;if(status>=500)return json(500,{error:'Internal server error.'});return json(status,{error:String(error?.message||'Request failed.').slice(0,180)});}
}
export{MAX_BODY_BYTES,analyticsPoint,handleRequest};
export default{fetch:handleRequest};
