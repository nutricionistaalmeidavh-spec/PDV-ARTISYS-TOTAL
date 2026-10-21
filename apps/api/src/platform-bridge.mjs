// Private central admin channel: signed, scoped and one-time.
// The payments ADMIN_TOKEN is never copied into this Worker.
import {platformManagementRoute} from './saas-control.mjs';

const text=new TextEncoder();
const reply=(error,status)=>new Response(JSON.stringify({error}),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
const idOk=id=>typeof id==='string'&&/^[-_a-zA-Z0-9]{1,128}$/.test(id);
const bytes=hex=>new Uint8Array(hex.match(/../g).map(x=>parseInt(x,16)));
const keyFor=secret=>crypto.subtle.importKey('raw',text.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);

export async function platformBridgeRoute(request,db,env,now){
 if(env.ARTISYS_PLATFORM_BRIDGE_ENABLED!=='true' && env.ARTISYS_PLATFORM_CENTRAL_ENABLED!=='true')return reply('not_found',404);
 const secret=env.ARTISYS_PLATFORM_BRIDGE_SECRET;
 if(typeof secret!=='string'||secret.length<32)return reply('platform_bridge_not_configured',503);
 if(request.method!=='POST'||request.headers.has('origin'))return reply('platform_bridge_forbidden',403);
 if(Number(request.headers.get('content-length')||0)>8192)return reply('platform_request_too_large',413);
 const body=await request.text();
 if(body.length>8192)return reply('platform_request_too_large',413);
 const timestamp=request.headers.get('x-artisys-platform-timestamp')||'';
 const nonce=request.headers.get('x-artisys-platform-nonce')||'';
 const signature=request.headers.get('x-artisys-platform-signature')||'';
 if(!/^\d{13}$/.test(timestamp)||Math.abs(now-Number(timestamp))>300000||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(nonce)||
    !/^sha256=[a-f0-9]{64}$/.test(signature))
   return reply('invalid_platform_signature',403);
 const key=await keyFor(secret);
 const valid=await crypto.subtle.verify('HMAC',key,bytes(signature.slice(7)),text.encode(timestamp+'.'+nonce+'.'+body));
 if(!valid)return reply('invalid_platform_signature',403);
 let payload;try{payload=JSON.parse(body);}catch{return reply('invalid_platform_payload',400);}
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return reply('invalid_platform_payload',400);
 const method=['bootstrap','approve','owner-license','revoke-license'].includes(payload.action)?'POST':'GET';
 let target;
 switch(payload.action){
  case 'summary':case 'tenants':case 'audit':
   target='/api/v1/platform/'+payload.action;break;
  case 'approve':
   if(!idOk(payload.tenantId))return reply('invalid_tenant_id',400);
   target='/api/v1/platform/tenants/'+encodeURIComponent(payload.tenantId)+'/approve';break;
  case 'bootstrap':
   if(!payload.data||typeof payload.data!=='object'||Array.isArray(payload.data))
    return reply('invalid_bootstrap',400);
   target='/api/v1/platform/bootstrap';break;
  case 'owner-license':
   if(!payload.data||typeof payload.data!=='object'||Array.isArray(payload.data))
    return reply('invalid_owner_license',400);
   target='/api/v1/platform/owner-license';break;
  case 'revoke-license':
   if(!idOk(payload.tenantId))return reply('invalid_tenant_id',400);
   target='/api/v1/platform/tenants/'+encodeURIComponent(payload.tenantId)+'/manual-license/revoke';break;
  default:return reply('platform_action_forbidden',403);
 }
 // A signature proves the caller; the primary key prevents replay across Worker instances.
 try{
  const reserved=await db.prepare('INSERT OR IGNORE INTO saas_platform_bridge_nonces(nonce,created_at) VALUES(?,?)').bind(nonce,now).run();
  if(reserved.meta?.changes!==1)return reply('platform_request_replayed',409);
  await db.prepare('DELETE FROM saas_platform_bridge_nonces WHERE created_at<?').bind(now-86400000).run();
 }catch{return reply('platform_bridge_schema_unavailable',503);}
 const proxy=new Request(new URL(target,request.url),{
  method,headers:method==='POST'?{'content-type':'application/json'}:{},
  ...(method==='POST'?{body:JSON.stringify(['bootstrap','owner-license'].includes(payload.action)?payload.data:{})}:{})
 });
 return platformManagementRoute(proxy,db,env,target,now,{centralVerified:true});
}
