// Private platform browser session. The permanent CLI secret never enters HTML or JS.
import {sha256,newSessionToken} from './password.mjs';
import {platformManagementRoute} from './saas-control.mjs';
const q=(db,text,...params)=>db.prepare(text).bind(...params);
const out=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'private, no-store',...headers}});
const same=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let v=0;for(let i=0;i<a.length;i++)v|=a.charCodeAt(i)^b.charCodeAt(i);return v===0;};
const LOCAL='pdvtotal_platform_local',HOST='__Host-pdvtotal_platform';
const cookieName=req=>new URL(req.url).protocol==='https:'?HOST:LOCAL;
const cookie=(req,value,maxAge)=>cookieName(req)+'='+value+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+maxAge+(new URL(req.url).protocol==='https:'?'; Secure':'');
const tokenFrom=req=>{
 const name=cookieName(req),found=(req.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='));
 return found?found.slice(name.length+1):null;
};
const allowedHttp=req=>new URL(req.url).protocol==='https:'||['localhost','127.0.0.1'].includes(new URL(req.url).hostname);
const allowedManagement=suffix=>suffix==='summary'||suffix==='tenants'||suffix==='audit'||
 /^tenants\/[^/]{1,128}\/(approve|subscription)$/.test(suffix);
export async function platformSessionRoute(req,db,env,now,path){
 if(!['/api/v1/platform/ticket','/api/v1/platform/auth/exchange','/api/v1/platform/auth/logout','/api/v1/platform/ui/me'].includes(path)&&!path.startsWith('/api/v1/platform/ui/'))return null;
 if(!allowedHttp(req))return out({error:'Administração requer HTTPS.'},403);
 const secret=env.PLATFORM_ADMIN_TOKEN;
 if(typeof secret!=='string'||secret.length<32)return out({error:'Administração não configurada.'},503);
 const method=req.method;
 if(path==='/api/v1/platform/ticket'){
  if(method!=='POST')return out({error:'Método não permitido.'},405);
  if(!same(req.headers.get('authorization')||'','Bearer '+secret))return out({error:'Acesso administrativo negado.'},403);
  const token=newSessionToken(),created=now;
  await q(db,'INSERT INTO saas_platform_tickets(token_hash,created_at,expires_at) VALUES(?,?,?)',await sha256(token),created,created+300000).run();
  return out({ticket:token,expiresAt:new Date(created+300000).toISOString()},201);
 }
 if(path==='/api/v1/platform/auth/exchange'){
  if(method!=='POST')return out({error:'Método não permitido.'},405);
  let data;try{
   if(Number(req.headers.get('content-length')||0)>512)return out({error:'Solicitação inválida.'},413);
   const raw=await req.text();if(raw.length>512)return out({error:'Solicitação inválida.'},413);
   data=JSON.parse(raw);
  }catch{return out({error:'Solicitação inválida.'},400);}
  if(typeof data.ticket!=='string'||!/^[a-f0-9]{64}$/.test(data.ticket))return out({error:'Convite inválido ou expirado.'},401);
  const hash=await sha256(data.ticket),valid=await q(db,'SELECT 1 AS ok FROM saas_platform_tickets WHERE token_hash=? AND expires_at>?',hash,now).first();
  if(!valid)return out({error:'Convite inválido ou expirado.'},401);
  const session=newSessionToken(),sessionHash=await sha256(session);
  try{
   const work=await db.batch([
    q(db,'INSERT INTO saas_platform_sessions(token_hash,created_at,expires_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM saas_platform_tickets WHERE token_hash=? AND expires_at>?)',
     sessionHash,now,now+30*60000,hash,now),
    q(db,'DELETE FROM saas_platform_tickets WHERE token_hash=? AND expires_at>?',hash,now)
   ]);
   if(!work[0].meta.changes||!work[1].meta.changes)return out({error:'Convite já utilizado.'},401);
  }catch{return out({error:'Convite inválido ou já utilizado.'},401);}
  return out({authenticated:true,expiresAt:new Date(now+30*60000).toISOString()},200,{'set-cookie':cookie(req,session,1800)});
 }
 const token=tokenFrom(req);
 const valid=token&&/^[a-f0-9]{64}$/.test(token)&&await q(db,'SELECT 1 AS ok FROM saas_platform_sessions WHERE token_hash=? AND expires_at>?',await sha256(token),now).first();
 if(!valid)return out({error:'Sessão administrativa expirada ou inexistente.'},401);
 if(path==='/api/v1/platform/auth/logout'){
  if(method!=='POST')return out({error:'Método inválido.'},405);
  await q(db,'DELETE FROM saas_platform_sessions WHERE token_hash=?',await sha256(token)).run();
  return out({revoked:true},200,{'set-cookie':cookie(req,'',0)});
 }
 if(path==='/api/v1/platform/ui/me'&&method==='GET')return out({authenticated:true});
 const suffix=path.slice('/api/v1/platform/ui/'.length);
 if(!allowedManagement(suffix))return out({error:'Rota administrativa indisponível.'},404);
 if(!['GET','POST','PUT'].includes(method))return out({error:'Método inválido.'},405);
 // Internal authenticated delegation: do not send PLATFORM_ADMIN_TOKEN to clients.
 const headers=new Headers(req.headers);headers.set('authorization','Bearer '+secret);
 const delegate=new Request(req,{headers});
 return platformManagementRoute(delegate,db,env,'/api/v1/platform/'+suffix,now);
}
