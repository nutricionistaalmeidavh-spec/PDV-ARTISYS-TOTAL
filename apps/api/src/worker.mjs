import { sha256, verifyPassword, newSessionToken } from './password.mjs';
import {registerPublicAccount} from './public-registration.mjs';
import {platformBridgeRoute} from './platform-bridge.mjs';
import {tenantTelemetryRoute} from './telemetry.mjs';
import {billingConnectorRoute,billingCustomerRoute} from './artisys-billing.mjs';
import {beginMfaLogin,finishMfaLogin,emailVerifyPublic,accountSecurityRoute} from './account-security.mjs';
import {passwordResetRoute} from './password-reset.mjs';
import {platformSessionRoute} from './platform-session.mjs';
import {commerceRoute} from './commerce-router.mjs';
import {checkoutDocumentsRoute} from './checkout-documents.mjs';
import {tenantWriteAllowed,loginIpThrottled,recordLoginIpFailure,
 identityManagementRoute,invitationRegistrationRoute,acceptInvitationRoute,
 tenantManagementRoute,platformManagementRoute,createAdditionalTenant} from './saas-control.mjs';
import {productMediaRoute} from './product-media.mjs';
import {advancedFinanceRoute} from './advanced-finance-router.mjs';
import {verticalRoute} from './vertical-router.mjs';
import {receiptRoute} from './receipt-route.mjs';
import {browserPrintRelayRoute,machinePrintRelayRoute} from './print-relay-route.mjs';
import {r3DocumentRoute} from './r3-document-route.mjs';
import {r2LanRoute,authorizeLanBusinessRequest,authorizeLanModule} from './r2-lan-router.mjs';
import {offlineGatewayAdminRoute,offlineGatewayMachineRoute} from './offline-gateway.mjs';
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
async function verifiedEmailFor(db,userId,env){
  try{return await db.prepare('SELECT email_verified_at AS at FROM users WHERE id=?').bind(userId).first();}
  catch(error){
    if(env.EMAIL_VERIFICATION_REQUIRED==='true')throw error;
    return null; // Older schema fixtures remain usable when the feature is explicitly off.
  }
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
  const verified=await verifiedEmailFor(db,entry.userId,env);
  return {userId:entry.userId,email:entry.email,displayName:entry.displayName,emailVerified:!!verified?.at,tokenHash,expiresAt:entry.expiresAt};
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
  if(await loginIpThrottled(request,db,env,now))return failure(429,'Muitas tentativas. Tente novamente mais tarde.');
  const key=await sha256(data.email);
  const locked=await db.prepare('SELECT failed_count AS failedCount,locked_until AS lockedUntil FROM login_throttles WHERE email_hash=?').bind(key).first();
  if(locked&&locked.lockedUntil>now)return failure(429,'Muitas tentativas. Tente novamente mais tarde.');
  const user=await db.prepare('SELECT id,email_norm AS email,display_name AS displayName,password_hash AS passwordHash FROM users WHERE email_norm=? AND active=1').bind(data.email).first();
  const valid=user?await verifyPassword(data.password,user.passwordHash):false;
  if(!valid){
    await recordLoginIpFailure(request,db,env,now);
    // Contagem persistente; se não existir conta a resposta continua genérica.
    await db.prepare(`INSERT INTO login_throttles(email_hash,failed_count,locked_until,updated_at)
      VALUES(?,1,0,?) ON CONFLICT(email_hash) DO UPDATE SET
      failed_count=CASE WHEN login_throttles.updated_at<? THEN 1 ELSE login_throttles.failed_count+1 END,
      locked_until=CASE WHEN login_throttles.updated_at<? THEN 0
        WHEN login_throttles.failed_count+1>=5 THEN ? ELSE login_throttles.locked_until END,
      updated_at=?`).bind(key,now,now-15*60*1000,now-15*60*1000,now+15*60*1000,now).run();
    return failure(401,'Credenciais inválidas.');
  }
  await db.prepare('DELETE FROM login_throttles WHERE email_hash=?').bind(key).run();
  let challenge;
  try{challenge=await beginMfaLogin(db,env,user.id,now);}
  catch(e){if(e.status===429)return failure(429,e.message);throw e;}
  if(challenge)return response({mfaRequired:true,challengeToken:challenge},202);
  return issueLoginSession(user,request,env,db,now);
}
async function issueLoginSession(user,request,env,db,now){
 const memberships=await membershipsFor(db,user.id);
 if(!memberships.length)return failure(403,'Usuário sem estabelecimento ativo.');
 const token=newSessionToken(),tokenHash=await sha256(token);
 await db.prepare('INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').bind(tokenHash,user.id,now,now+MAX_SESSION_MS).run();
 const verified=await verifiedEmailFor(db,user.id,env);
 return response({sessionId:tokenHash.slice(0,12),
  user:{id:user.id,email:user.email,displayName:user.displayName,emailVerified:!!verified?.at},
  emailVerificationRequired:env.EMAIL_VERIFICATION_REQUIRED==='true'&&!verified?.at,
  memberships,expiresAt:new Date(now+MAX_SESSION_MS).toISOString()},200,
  {'set-cookie':cookieHeader(token,request,env)});
}
function identity(session,memberships) {
  return {
    user:{id:session.userId,email:session.email,displayName:session.displayName,emailVerified:!!session.emailVerified},
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
          return response({ok:true,service:'pdv-artisys-total',status:'identity-ready',lanMode:env.LAN_MODE==='true'});
        } catch {
          return response({ok:false,service:'pdv-artisys-total',status:'setup-required'},503);
        }
      }
      // A new Cloudflare Git deployment must not accept credentials or write D1
      // before schema, anti-abuse protections and customer onboarding are ready.
      // An explicitly authenticated platform bootstrap may run while client logins
      // remain disabled. Browser origins cannot perform cross-site admin mutations.
      if(path==='/api/v1/integrations/artisys/billing')
         return await billingConnectorRoute(request,db,env,now());
       if(path==='/api/v1/integrations/artisys/platform')
         return await platformBridgeRoute(request,db,env,now());
       if(path.startsWith('/api/v1/platform/')){
         if(env.ARTISYS_PLATFORM_CENTRAL_ENABLED==='true')return failure(404,'Administração centralizada no ArtiSys Pagamentos.');
        if(!['GET','HEAD'].includes(method)&&!originAllowed(request))
          return failure(403,'Origem da solicitação inválida.');
        const ui=await platformSessionRoute(request,db,env,now(),path);
        if(ui)return ui;
        return await platformManagementRoute(request,db,env,path,now());
      }
      if(env.AUTH_ENABLED==='false')return failure(503,'Acesso ainda não habilitado para clientes.');
       if(path.startsWith('/api/v1/print-relay/agent/'))return await machinePrintRelayRoute(request,db,now());
      if(path.startsWith('/api/v1/offline/gateway/')){
        if(env.OFFLINE_SYNC_ENABLED!=='true'||env.LAN_MODE==='true')return failure(404,'Sincronização offline não habilitada.');
        return offlineGatewayMachineRoute(request,db,env);
      }
      if(method==='OPTIONS')return failure(405,'Método não permitido.');
      if(!['GET','HEAD'].includes(method)&&!originAllowed(request))return failure(403,'Origem da solicitação inválida.');
      if(method==='POST'&&path==='/api/v1/auth/register')return await registerPublicAccount(request,env,db,now());
      if(method==='POST'&&path==='/api/v1/auth/register-invite')
        return await invitationRegistrationRoute(request,db,now());
      if(method==='POST'&&path==='/api/v1/auth/login')return await login(request,env,db,now());
      if(method==='POST'&&path==='/api/v1/auth/mfa/login'){
        const user=await finishMfaLogin(request,db,env,now());
        if(!user)return failure(401,'Código ou desafio de autenticação inválido.');
        return issueLoginSession(user,request,env,db,now());
      }
      if(method==='POST'&&path==='/api/v1/auth/email/verify')
        return emailVerifyPublic(request,db,now());
      if(method==='POST'&&path.startsWith('/api/v1/auth/password/reset/')){
        const reset=await passwordResetRoute(request,db,env,now());
        if(reset)return reset;
      }
      const session=await sessionFor(request,db,now(),env);
      if(!session)return failure(401,'Sessão inválida ou expirada.');
      const security=await accountSecurityRoute(request,db,env,session,now(),path);
      if(security)return security;
      if(env.EMAIL_VERIFICATION_REQUIRED==='true'&&!session.emailVerified&&path!=='/api/v1/auth/session')
        return failure(403,'Confirme o endereço de e-mail antes de acessar a loja.');
      const sessions=await identityManagementRoute(request,db,session,now(),path);
      if(sessions)return sessions;
      if(method==='POST'&&path==='/api/v1/invitations/accept')
        return await acceptInvitationRoute(request,db,session,now());
      if(method==='POST'&&path==='/api/v1/tenants')
        return await createAdditionalTenant(request,db,env,session,now());
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
      // Optional metrics are independent of paid entitlement and never mutate business ledgers.
      const telemetryMatch=path.match(/^\/api\/v1\/tenants\/([^/]+)\/telemetry\/(preferences|events)$/);
      if(telemetryMatch){
        const tenantId=decodeURIComponent(telemetryMatch[1]);
        const member=await requireMembership(db,session.userId,tenantId);
        if(!member)return failure(404,'Estabelecimento não encontrado ou sem acesso.');
        return tenantTelemetryRoute(request,db,env,member,tenantId,telemetryMatch[2],now());
      }
      const billingMatch=path.match(/^\/api\/v1\/tenants\/([^/]+)\/(billing\/(?:plans|checkout|orders))$/);
      if(billingMatch){
        const tenantId=decodeURIComponent(billingMatch[1]);
        const member=await requireMembership(db,session.userId,tenantId);
        if(!member)return failure(404,'Estabelecimento não encontrado ou sem acesso.');
        return await billingCustomerRoute(request,db,env,session,member,tenantId,billingMatch[2],now());
      }
      // Company administration still checks current membership, owner permission,
      // and tenant entitlement on the server (never UI flags or client tenant claims).
      const adminMatch=path.match(/^\/api\/v1\/tenants\/([^/]+)\/(branches|invitations(?:\/[^/]+\/revoke)?|members\/[^/]+\/(?:role|revoke)|subscription)$/);
      if(adminMatch){
        const tenantId=decodeURIComponent(adminMatch[1]);
        const member=await requireMembership(db,session.userId,tenantId);
        if(!member)return failure(404,'Estabelecimento não encontrado ou sem acesso.');
        if(!['GET','HEAD'].includes(method)&&!await tenantWriteAllowed(db,tenantId,env,now()))
          return failure(402,'Assinatura inativa ou vencida. Operações de escrita suspensas.');
        const managed=await tenantManagementRoute(request,db,env,session,member,tenantId,adminMatch[2],now());
        if(managed)return managed;
      }
      // Commerce belongs to the only canonical PDV core and its D1 transaction adapter.
      const commerceMatch=path.match(/^\/api\/v1\/tenants\/([^/]+)\/(.+)$/);
      if(commerceMatch){
        const tenantId=decodeURIComponent(commerceMatch[1]);
        const membership=await requireMembership(db,session.userId,tenantId);
        if(!membership)return failure(404,'Estabelecimento não encontrado ou sem acesso.');
        if(!['GET','HEAD'].includes(method)&&!await tenantWriteAllowed(db,tenantId,env,now()))
          return failure(402,'Assinatura inativa ou vencida. Operações de escrita suspensas.');
        if(/^offline\/gateways(?:\/[0-9a-zA-Z-]+)?$/.test(commerceMatch[2])){
          if(env.LAN_MODE==='true'||env.OFFLINE_SYNC_ENABLED!=='true')return failure(404,'Integração offline não habilitada.');
          return offlineGatewayAdminRoute(request,db,membership,session,tenantId,commerceMatch[2],now());
        }
        if(env.LAN_MODE==='true'&&!['GET','HEAD'].includes(method) &&
           !commerceMatch[2].startsWith('lan/')){
          const replica=await db.prepare('SELECT state FROM offline_replica_state WHERE tenant_id=? LIMIT 1')
            .bind(tenantId).first();
          if(replica)return failure(503,'Cópia local somente para consulta: reconciliação de vendas, caixa e estoque com D1 ainda não habilitada.');
        }
        // Business areas are available in the hosted app too. Reuse the same
        // tenant-scoped policy without exposing device pairing or LAN controls.
        if(/^modules(?:\/[A-Z_]+)?$/.test(commerceMatch[2])){
          const modules=await r2LanRoute(request,db,session,membership,tenantId,'lan/'+commerceMatch[2],{now});
          if(modules)return modules;
        }
        if(env.LAN_MODE==='true'){
          const lan=await r2LanRoute(request,db,session,membership,tenantId,commerceMatch[2],{now});
          if(lan)return lan;
          const deviceDenied=await authorizeLanBusinessRequest(request,db,membership,tenantId);
          if(deviceDenied)return deviceDenied;
          const moduleDenied=await authorizeLanModule(db,tenantId,commerceMatch[2]);
          if(moduleDenied)return moduleDenied;
        }else if(/^(restaurant|wholesale)\//.test(commerceMatch[2])){
          const moduleDenied=await authorizeLanModule(db,tenantId,commerceMatch[2],{useDefaults:false});
          if(moduleDenied)return moduleDenied;
        }
        const checkoutDocuments=await checkoutDocumentsRoute(request,db,session,membership,tenantId,commerceMatch[2]);
        if(checkoutDocuments)return checkoutDocuments;
        const media=await productMediaRoute(request,db,env.FILES,env.LOCAL_MEDIA_ENABLED==='true',session,membership,tenantId,commerceMatch[2]);
        if(media)return media;
        const advanced=await advancedFinanceRoute(request,db,session,membership,tenantId,commerceMatch[2]);
        if(advanced)return advanced;
        const documents=await r3DocumentRoute(request,db,session,membership,tenantId,commerceMatch[2]);
        if(documents)return documents;
        const relay=await browserPrintRelayRoute(request,db,session,membership,tenantId,commerceMatch[2],now());
        if(relay)return relay;
        const receipts=await receiptRoute(request,db,session,membership,tenantId,commerceMatch[2]);
        if(receipts)return receipts;
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
