import { sha256, verifyPassword, newSessionToken } from './password.mjs';
import {commerceRoute} from './commerce-router.mjs';
import {productMediaRoute} from './product-media.mjs';
import {advancedFinanceRoute} from './advanced-finance-router.mjs';
import {verticalRoute} from './vertical-router.mjs';
import {r2LanRoute} from './r2-lan-router.mjs';
import legacyAuthorization from '../../../packages/core/js/core/auth/authorization-service.js';
import legacyProfiles from '../../../packages/core/js/core/auth/default-profiles.js';
import legacyPrincipals from '../../../packages/core/js/core/auth/principal-resolver.js';

const {createAuthorizationService} = legacyAuthorization;
const {DEFAULT_PROFILE_PERMISSIONS} = legacyProfiles;
const {principalFromSession} = legacyPrincipals;
const HOST_COOKIE='__Host-pdvtotal_session';
const LOCAL_COOKIE='pdvtotal_local_session';
function cookieName(env) { return env.COOKIE_SECURE==='false'?LOCAL_COOKIE:HOST_COOKIE; }
const MAX_SESSION_MS=12*60*60*1000;

function response(body,status=200,extra={}) {
  return new Response(JSON.stringify(body),{status,headers:{
    'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff','referrer-policy':'no-referrer',...extra}});
}
function failure(status,message){return response({error:message},status);}
function findCookie(request,env){
  const value=request.headers.get('cookie')||'';
  const name=cookieName(env);
  const match=value.split(';').map(p=>p.trim()).find(p=>p.startsWith(name+'='));
  return match?match.slice(name.length+1):null;
}
function cookieHeader(token,request,env,maxAge=43200){
  const secure=env.COOKIE_SECURE!=='false';
  if(!secure&&!['localhost','127.0.0.1'].includes(new URL(request.url).hostname))
    throw new Error('Cookies inseguros só são permitidos no localhost.');
  return `${cookieName(env)}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`;
}
function safeEmail(input){return String(input||'').trim().toLowerCase();}
function authzFor(profileKey){
  const profile=profileKey==='OWNER'?'ADMINISTRATOR':profileKey;
  const permissions=DEFAULT_PROFILE_PERMISSIONS[profile]||[];
  return createAuthorizationService({resolvePermissions:()=>permissions});
}
async function sessionFor(request,db,now,env){
  const raw=findCookie(request,env);
  if(!raw||!/^[a-f0-9]{64}$/.test(raw))return null;
  const tokenHash=await sha256(raw);
  const entry=await db.prepare(`SELECT s.user_id AS userId,s.expires_at AS expiresAt,
    u.email_norm AS email,u.display_name AS displayName
    FROM auth_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).bind(tokenHash,now).first();
  if(!entry)return null;
  return {userId:entry.userId,email:entry.email,displayName:entry.displayName,tokenHash,expiresAt:entry.expiresAt};
}
async function membershipsFor(db,userId) {
  const {results}=await db.prepare(`SELECT m.tenant_id AS tenantId,t.slug,t.name,
    m.profile_key AS profileKey FROM tenant_memberships m
    JOIN tenants t ON t.id=m.tenant_id
    WHERE m.user_id=? AND m.active=1 AND t.active=1 ORDER BY t.name,t.id`).bind(userId).all();
  return results;
}
async function requireMembership(db,userId,tenantId){
  if(!tenantId||tenantId.length>128)return null;
  const member=await db.prepare(`SELECT m.tenant_id AS tenantId,m.profile_key AS profileKey,t.name AS tenantName
    FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id
    WHERE m.user_id=? AND m.tenant_id=? AND m.active=1 AND t.active=1`).bind(userId,tenantId).first();
  return member||null;
}
function originAllowed(request) {
  const origin=request.headers.get('origin');
  return Boolean(origin && origin===new URL(request.url).origin);
}
async function parseCredentials(request) {
  if(Number(request.headers.get('content-length')||0)>4096) return null;
  const text=await request.text();
  if(text.length>4096)return null;
  try {
    const data=JSON.parse(text);
    if(!data||typeof data!=='object')return null;
    const email=safeEmail(data.email),password=data.password;
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||typeof password!=='string'||password.length>256)return null;
    return {email,password};
  }catch{return null;}
}
async function login(request,env,db,now){
  const data=await parseCredentials(request);
  if(!data)return failure(400,'Informe e-mail e senha válidos.');
  const key=await sha256(data.email);
  const locked=await db.prepare('SELECT failed_count AS failedCount,locked_until AS lockedUntil FROM login_throttles WHERE email_hash=?').bind(key).first();
  if(locked&&locked.lockedUntil>now)return failure(429,'Muitas tentativas. Tente novamente mais tarde.');
  const user=await db.prepare('SELECT id,email_norm AS email,display_name AS displayName,password_hash AS passwordHash FROM users WHERE email_norm=? AND active=1').bind(data.email).first();
  const valid=user?await verifyPassword(data.password,user.passwordHash):false;
  if(!valid){
    // Contagem persistente; se não existir conta a resposta continua genérica.
    await db.prepare(`INSERT INTO login_throttles(email_hash,failed_count,locked_until,updated_at)
      VALUES(?,1,0,?) ON CONFLICT(email_hash) DO UPDATE SET
      failed_count=CASE WHEN login_throttles.updated_at<? THEN 1 ELSE login_throttles.failed_count+1 END,
      locked_until=CASE WHEN login_throttles.updated_at<? THEN 0
        WHEN login_throttles.failed_count+1>=5 THEN ? ELSE login_throttles.locked_until END,
      updated_at=?`).bind(key,now,now-15*60*1000,now-15*60*1000,now+15*60*1000,now).run();
    return failure(401,'Credenciais inválidas.');
  }
  const memberships=await membershipsFor(db,user.id);
  if(!memberships.length)return failure(403,'Usuário sem estabelecimento ativo.');
  await db.prepare('DELETE FROM login_throttles WHERE email_hash=?').bind(key).run();
  const token=newSessionToken(),tokenHash=await sha256(token);
  await db.prepare('INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)')
    .bind(tokenHash,user.id,now,now+MAX_SESSION_MS).run();
  return response({sessionId:tokenHash.slice(0,12),user:{id:user.id,email:user.email,displayName:user.displayName},memberships,expiresAt:new Date(now+MAX_SESSION_MS).toISOString()},200,
    {'set-cookie':cookieHeader(token,request,env)});
}
function identity(session,memberships) {
  return {
    user:{id:session.userId,email:session.email,displayName:session.displayName},
    principal:principalFromSession({userId:session.userId}),
    memberships,
    expiresAt:new Date(session.expiresAt).toISOString()
  };
}

export function createApi(env,{now=()=>Date.now()}={}){
  if(!env?.DB)throw new Error('DB binding required; never reuse the desktop licensing database.');
  const db=env.DB;
  return { async fetch(request){
    try{
      const url=new URL(request.url),path=url.pathname,method=request.method;
      if(method==='GET'&&path==='/api/v1/health') {
        // D1 can be auto-provisioned on deploy but still require the initial migration.
        try {
          await db.prepare('SELECT id FROM tenants LIMIT 1').bind().first();
          return response({ok:true,service:'pdv-artisys-total',status:'identity-ready'});
        } catch {
          return response({ok:false,service:'pdv-artisys-total',status:'setup-required'},503);
        }
      }
      // A new Cloudflare Git deployment must not accept credentials or write D1
      // before schema, anti-abuse protections and customer onboarding are ready.
      if(env.AUTH_ENABLED==='false')return failure(503,'Acesso ainda não habilitado para clientes.');
      if(method==='OPTIONS')return failure(405,'Método não permitido.');
      if(!['GET','HEAD'].includes(method)&&!originAllowed(request))return failure(403,'Origem da solicitação inválida.');
      if(method==='POST'&&path==='/api/v1/auth/login')return await login(request,env,db,now());
      const session=await sessionFor(request,db,now(),env);
      if(!session)return failure(401,'Sessão inválida ou expirada.');
      if(method==='DELETE'&&path==='/api/v1/auth/session'){
        await db.prepare('DELETE FROM auth_sessions WHERE token_hash=? AND user_id=?').bind(session.tokenHash,session.userId).run();
        return response({revoked:true},200,{'set-cookie':cookieHeader('',request,env,0)});
      }
      if(method==='GET'&&path==='/api/v1/auth/session')
        return response(identity(session,await membershipsFor(db,session.userId)));
      if(method==='GET'&&path==='/api/v1/tenants')
        return response({tenants:await membershipsFor(db,session.userId)});
      const match=path.match(/^\/api\/v1\/tenants\/([^/]+)\/(context|branches|members)$/);
      if(match&&method==='GET'){
        const tenantId=decodeURIComponent(match[1]);
        const membership=await requireMembership(db,session.userId,tenantId);
        if(!membership)return failure(404,'Estabelecimento não encontrado ou sem acesso.');
        if(match[2]==='context')
          return response({tenantId:membership.tenantId,name:membership.tenantName,profileKey:membership.profileKey,
            principal:principalFromSession({userId:session.userId}),capabilities:DEFAULT_PROFILE_PERMISSIONS[membership.profileKey==='OWNER'?'ADMINISTRATOR':membership.profileKey]||[]});
        if(match[2]==='branches'){
          const {results}=await db.prepare('SELECT id,code,name FROM branches WHERE tenant_id=? AND active=1 ORDER BY name,id').bind(membership.tenantId).all();
          return response({tenantId:membership.tenantId,branches:results});
        }
        const allowed=authzFor(membership.profileKey).can({principal:principalFromSession({userId:session.userId}),capability:'users.view'});
        if(!allowed)return failure(403,'Permissão insuficiente.');
        const {results}=await db.prepare(`SELECT u.id,u.display_name AS displayName,m.profile_key AS profileKey
          FROM tenant_memberships m JOIN users u ON u.id=m.user_id
          WHERE m.tenant_id=? AND m.active=1 AND u.active=1 ORDER BY u.display_name,u.id`).bind(membership.tenantId).all();
        return response({tenantId:membership.tenantId,members:results});
      }
      // Commerce belongs to the only canonical PDV core and its D1 transaction adapter.
      const commerceMatch=path.match(/^\/api\/v1\/tenants\/([^/]+)\/(.+)$/);
      if(commerceMatch){
        const tenantId=decodeURIComponent(commerceMatch[1]);
        const membership=await requireMembership(db,session.userId,tenantId);
        if(!membership)return failure(404,'Estabelecimento não encontrado ou sem acesso.');
        if(env.LAN_MODE==='true'){
          const lan=await r2LanRoute(request,db,session,membership,tenantId,commerceMatch[2],{now});
          if(lan)return lan;
        }
        const media=await productMediaRoute(request,db,env.FILES,env.LOCAL_MEDIA_ENABLED==='true',session,membership,tenantId,commerceMatch[2]);
        if(media)return media;
        const advanced=await advancedFinanceRoute(request,db,session,membership,tenantId,commerceMatch[2]);
        if(advanced)return advanced;
        const commerce=await commerceRoute(request,db,session,membership,tenantId,commerceMatch[2],{
          now:()=>new Date(now()).toISOString()
        });
        if(commerce)return commerce;
        const vertical=await verticalRoute(request,db,session,membership,tenantId,commerceMatch[2]);
        if(vertical)return vertical;
      }
      return failure(404,'Rota não disponível neste estágio da migração.');
    }catch(error){
      if(env.LOG_ERRORS==='true')console.error('pdv-total request failed',error?.name||'Error');
      return failure(500,'Erro interno.');
    }
  }};
}
export default {fetch(request,env){return createApi(env).fetch(request);}};
