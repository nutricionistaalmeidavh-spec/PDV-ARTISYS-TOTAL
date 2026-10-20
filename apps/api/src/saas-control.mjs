// SaaS control plane. Never duplicates sales, inventory or cash ledgers.
import {sha256,hashPassword,newSessionToken} from './password.mjs';
import {emailTransportPresent,sendTransactionalEmail} from './transactional-email.mjs';
const fail=(status,msg)=>Object.assign(new Error(msg),{status});
const output=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff'}});
const err=e=>output({error:e.status?e.message:'Falha na operação.'},e.status||500);
const q=(db,s,...args)=>db.prepare(s).bind(...args);
const newId=()=>crypto.randomUUID();
const stamp=ms=>new Date(ms).toISOString();
const roles=new Set(['ADMINISTRATOR','MANAGER','SUPERVISOR','CASHIER','OPERATOR','WAITER','KITCHEN','STOCKKEEPER','PURCHASING','FINANCE','DELIVERY','READ_ONLY']);
const statusList=new Set(['TRIAL','ACTIVE','PAST_DUE','SUSPENDED','CANCELLED']);
const isOwner=member=>member?.profileKey==='OWNER';
const ownerOnly=member=>{if(!isOwner(member))throw fail(403,'Operação exclusiva do proprietário.');};
const validText=(s,max=120)=>typeof s==='string'&&s.trim().length>0&&s.trim().length<=max?s.trim():null;
const validEmail=v=>{const s=typeof v==='string'?v.trim().toLowerCase():'';return s.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)?s:null;};
async function bodyOf(request){
 if(Number(request.headers.get('content-length')||0)>8192)throw fail(413,'Pedido muito grande.');
 if(!request.headers.get('content-type')?.includes('application/json'))throw fail(415,'JSON obrigatório.');
 const raw=await request.text();if(raw.length>8192)throw fail(413,'Pedido muito grande.');
 let data;try{data=JSON.parse(raw);}catch{throw fail(400,'JSON inválido.');}
 if(!data||typeof data!=='object'||Array.isArray(data))throw fail(400,'Dados inválidos.');
 return data;
}
function audit(db,t,actor,kind,subject,now,detail={}){
 return q(db,'INSERT INTO saas_audit_events(id,tenant_id,actor_id,kind,subject_id,created_at,detail_json) VALUES(?,?,?,?,?,?,?)',
  newId(),t,actor,kind,subject,stamp(now),JSON.stringify(detail));
}
export async function tenantWriteAllowed(db,tenantId,env,now){
 if(env.SAAS_ENTITLEMENTS_ENABLED!=='true')return true;
 const s=await q(db,'SELECT status,ends_at AS endsAt FROM saas_subscriptions WHERE tenant_id=?',tenantId).first();
 return Boolean(s&&['TRIAL','ACTIVE'].includes(s.status)&&Date.parse(s.endsAt)>now);
}
async function ipBucket(request,env,now){
 // Cloudflare overwrites this header at the Workers edge. Never trust X-Forwarded-For.
 if(env.TRUST_CF_CONNECTING_IP!=='true')return null;
 const ip=request.headers.get('cf-connecting-ip')||'';
 if(!/^[a-fA-F0-9:.]{3,64}$/.test(ip))return null;
 const window=Math.floor(now/900000);
 return {hash:await sha256('pdv-saas-auth:'+window+':'+(env.AUTH_IP_SALT||'')+':'+ip),expiresAt:(window+1)*900000};
}
export async function loginIpThrottled(request,db,env,now){
 const key=await ipBucket(request,env,now);if(!key)return false;
 const row=await q(db,'SELECT failures FROM saas_auth_rate_limits WHERE bucket_hash=? AND expires_at>?',key.hash,now).first();
 return (row?.failures||0)>=15;
}
export async function recordLoginIpFailure(request,db,env,now){
 const key=await ipBucket(request,env,now);if(!key)return;
 await q(db,'INSERT INTO saas_auth_rate_limits(bucket_hash,failures,expires_at) VALUES(?,1,?) ON CONFLICT(bucket_hash) DO UPDATE SET failures=saas_auth_rate_limits.failures+1,expires_at=excluded.expires_at',key.hash,key.expiresAt).run();
}
export async function identityManagementRoute(request,db,session,now,path){
 try{
  if(path==='/api/v1/auth/sessions'&&request.method==='GET'){
   const data=await q(db,'SELECT token_hash AS hash,created_at AS createdAt,expires_at AS expiresAt FROM auth_sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC LIMIT 50',session.userId,now).all();
   return output({sessions:data.results.map(r=>({id:r.hash.slice(0,24),current:r.hash===session.tokenHash,createdAt:r.createdAt,expiresAt:r.expiresAt}))});
  }
  const m=path.match(/^\/api\/v1\/auth\/sessions\/([a-f0-9]{24})$/);
  if(m&&request.method==='DELETE'){
   const found=await q(db,'SELECT token_hash AS hash FROM auth_sessions WHERE user_id=? AND substr(token_hash,1,24)=?',session.userId,m[1]).first();
   if(!found)return output({error:'Sessão não encontrada.'},404);
   await q(db,'DELETE FROM auth_sessions WHERE user_id=? AND token_hash=?',session.userId,found.hash).run();
   return output({revoked:true});
  }
  return null;
 }catch(e){return err(e);}
}
export async function invitationRegistrationRoute(request,db,now){
 if(request.method!=='POST')return null;
 try{
  const data=await bodyOf(request),email=validEmail(data.email),name=validText(data.displayName,100);
  if(!email||!name||typeof data.password!=='string'||data.password.length<12||data.password.length>256||
     typeof data.token!=='string'||!/^[a-f0-9]{64}$/.test(data.token))throw fail(400,'Convite ou cadastro inválido.');
  const hash=await sha256(data.token);
  const invite=await q(db,'SELECT id,tenant_id AS tenantId,email_norm AS email,profile_key AS profileKey FROM saas_invitations WHERE token_hash=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?',hash,now).first();
  if(!invite||invite.email!==email)throw fail(409,'Convite inválido ou expirado.');
  if(await q(db,'SELECT id FROM users WHERE email_norm=?',email).first())throw fail(409,'Conta já existente: faça login para aceitar.');
  const id=newId(),password=await hashPassword(data.password);
  await db.batch([
   q(db,'INSERT INTO users(id,email_norm,display_name,password_hash,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM saas_invitations WHERE id=? AND token_hash=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?)',id,email,name,password,stamp(now),invite.id,hash,now),
   q(db,'INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)',invite.tenantId,id,invite.profileKey,stamp(now)),
   q(db,'UPDATE saas_invitations SET accepted_at=? WHERE id=? AND token_hash=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?',now,invite.id,hash,now),
   audit(db,invite.tenantId,id,'INVITE_REGISTERED',id,now)
  ]);
  return output({created:true},201);
 }catch(e){return e.status?err(e):output({error:'Convite já usado ou inválido.'},409);}
}
export async function acceptInvitationRoute(request,db,session,now){
 try{
  const data=await bodyOf(request);
  if(typeof data.token!=='string'||!/^[a-f0-9]{64}$/.test(data.token))throw fail(400,'Convite inválido.');
  const hash=await sha256(data.token);
  const invite=await q(db,'SELECT id,tenant_id AS tenantId,email_norm AS email,profile_key AS profileKey FROM saas_invitations WHERE token_hash=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?',hash,now).first();
  if(!invite)throw fail(409,'Convite expirado ou usado.');
  if(invite.email!==session.email)throw fail(403,'Este convite pertence a outro e-mail.');
  await db.batch([
   q(db,'INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)',invite.tenantId,session.userId,invite.profileKey,stamp(now)),
   q(db,'UPDATE saas_invitations SET accepted_at=? WHERE id=? AND token_hash=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?',now,invite.id,hash,now),
   audit(db,invite.tenantId,session.userId,'INVITE_ACCEPTED',session.userId,now)
  ]);
  return output({accepted:true,tenantId:invite.tenantId});
 }catch(e){return e.status?err(e):output({error:'Convite já usado ou conta associada.'},409);}
}
export async function tenantManagementRoute(request,db,env,session,member,tenantId,path,now){
 try{
  const method=request.method,body=['POST','PATCH','PUT'].includes(method)?await bodyOf(request):{};
  if(path==='branches'&&method==='POST'){
   ownerOnly(member);
   const code=validText(body.code,24)?.toUpperCase(),name=validText(body.name,100);
   if(!code||!name||!/^[A-Z0-9][A-Z0-9_-]{1,23}$/.test(code))throw fail(400,'Código/nome de filial inválido.');
   const id=newId();
   try{await db.batch([
    q(db,'INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)',id,tenantId,code,name,stamp(now)),
    audit(db,tenantId,session.userId,'BRANCH_CREATED',id,now,{code})
   ]);}catch{return output({error:'Filial já cadastrada.'},409);}
   return output({branch:{id,tenantId,code,name}},201);
  }
  if(path==='invitations'&&method==='POST'){
   ownerOnly(member);
   const email=validEmail(body.email),role=body.profileKey;
   if(!email||!roles.has(role))throw fail(400,'E-mail ou perfil inválido.');
   const count=await q(db,'SELECT COUNT(*) AS n FROM saas_invitations WHERE tenant_id=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?',tenantId,now).first();
   if(count.n>=30)throw fail(429,'Limite de convites pendentes.');
   const already=await q(db,'SELECT 1 FROM users u JOIN tenant_memberships m ON m.user_id=u.id WHERE m.tenant_id=? AND m.active=1 AND u.email_norm=?',tenantId,email).first();
   if(already)throw fail(409,'Usuário já associado.');
   const token=newSessionToken(),id=newId(),expiresAt=now+48*3600000;
   await db.batch([
    q(db,'INSERT INTO saas_invitations(id,tenant_id,token_hash,email_norm,profile_key,invited_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)',id,tenantId,await sha256(token),email,role,session.userId,now,expiresAt),
    audit(db,tenantId,session.userId,'INVITE_ISSUED',id,now,{role})
   ]);
   // With Email Service, deliver the one-time code privately to the invited
   // mailbox and do not expose the bearer token to the requesting browser.
   // On a free self-hosted install without email, manual code delivery survives.
   if(emailTransportPresent(env)){
    try{
     const shop=await q(db,'SELECT name FROM tenants WHERE id=?',tenantId).first();
     await sendTransactionalEmail(env,{
      to:email,subject:'Convite para '+(shop?.name||'sua empresa')+' | PDV Total',
      text:'Você foi convidado para acessar '+(shop?.name||'uma empresa')+
       ' no PDV Total da ArtiSys.\n\nAcesse '+new URL('/app/',new URL(request.url).origin).href+
       ' e selecione "Recebi um convite".\n\nCódigo individual (válido por 48 horas):\n'+
       token+'\n\nSe você não reconhece o convite, ignore esta mensagem.'
     });
     return output({invitationId:id,emailSent:true,expiresAt},201);
    }catch{
     await q(db,'UPDATE saas_invitations SET revoked_at=? WHERE id=? AND tenant_id=? AND accepted_at IS NULL',now,id,tenantId).run();
     return output({error:'Não foi possível enviar o convite por e-mail. Nenhum convite ativo foi criado.'},503);
    }
   }
   return output({invitationId:id,emailSent:false,invitationToken:token,expiresAt},201);
  }
  if(path==='invitations'&&method==='GET'){
   ownerOnly(member);
   const data=await q(db,'SELECT id,email_norm AS email,profile_key AS profileKey,created_at AS createdAt,expires_at AS expiresAt,accepted_at AS acceptedAt,revoked_at AS revokedAt FROM saas_invitations WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100',tenantId).all();
   return output({invitations:data.results});
  }
  const revokeInvite=path.match(/^invitations\/([a-f0-9-]{36})\/revoke$/);
  if(revokeInvite&&method==='POST'){
   ownerOnly(member);
   const r=await q(db,'UPDATE saas_invitations SET revoked_at=? WHERE id=? AND tenant_id=? AND accepted_at IS NULL AND revoked_at IS NULL',now,revokeInvite[1],tenantId).run();
   if(!r.meta.changes)throw fail(404,'Convite não encontrado.');
   await audit(db,tenantId,session.userId,'INVITE_REVOKED',revokeInvite[1],now).run();
   return output({revoked:true});
  }
  const role=path.match(/^members\/([^/]{1,128})\/role$/);
  if(role&&method==='PATCH'){
   ownerOnly(member);
   if(!roles.has(body.profileKey))throw fail(400,'Perfil inválido ou OWNER protegido.');
   if(role[1]===session.userId)throw fail(403,'Não altere seu próprio perfil.');
   const target=await q(db,'SELECT profile_key AS role FROM tenant_memberships WHERE tenant_id=? AND user_id=? AND active=1',tenantId,role[1]).first();
   if(!target)throw fail(404,'Funcionário não encontrado.');
   if(target.role==='OWNER')throw fail(403,'Proprietário protegido.');
   await db.batch([
    q(db,"UPDATE tenant_memberships SET profile_key=? WHERE tenant_id=? AND user_id=? AND active=1 AND profile_key!='OWNER'",body.profileKey,tenantId,role[1]),
    audit(db,tenantId,session.userId,'ROLE_CHANGED',role[1],now,{from:target.role,to:body.profileKey})
   ]);
   return output({changed:true});
  }
  const revoke=path.match(/^members\/([^/]{1,128})\/revoke$/);
  if(revoke&&method==='POST'){
   ownerOnly(member);
   if(revoke[1]===session.userId)throw fail(403,'Não remova seu próprio acesso.');
   const target=await q(db,'SELECT profile_key AS role FROM tenant_memberships WHERE tenant_id=? AND user_id=? AND active=1',tenantId,revoke[1]).first();
   if(!target)throw fail(404,'Funcionário não encontrado.');
   if(target.role==='OWNER')throw fail(403,'Proprietário protegido.');
   await db.batch([
    q(db,"UPDATE tenant_memberships SET active=0 WHERE tenant_id=? AND user_id=? AND active=1 AND profile_key!='OWNER'",tenantId,revoke[1]),
    audit(db,tenantId,session.userId,'MEMBER_REVOKED',revoke[1],now)
   ]);
   return output({revoked:true});
  }
  if(path==='subscription'&&method==='GET'){
   const subscription=await q(db,'SELECT plan_key AS planKey,status,ends_at AS endsAt,version FROM saas_subscriptions WHERE tenant_id=?',tenantId).first();
   return output({subscription:subscription||null,writeEnabled:await tenantWriteAllowed(db,tenantId,env,now)});
  }
  return null;
 }catch(e){return err(e);}
}
export async function platformManagementRoute(request,db,env,path,now,{centralVerified=false}={}){
 if(!path.startsWith('/api/v1/platform/'))return null;
 if(!centralVerified){
  const secret=env.PLATFORM_ADMIN_TOKEN,header=request.headers.get('authorization')||'';
  if(typeof secret!=='string'||secret.length<32||!header.startsWith('Bearer ')||header.length!==secret.length+7)
   return output({error:'Acesso administrativo negado.'},403);
  let diff=0;for(let i=0;i<secret.length;i++)diff|=secret.charCodeAt(i)^header.charCodeAt(i+7);
  if(diff)return output({error:'Acesso administrativo negado.'},403);
 }
 if(path==='/api/v1/platform/bootstrap'&&request.method==='POST'){
  try{
   const data=await bodyOf(request);
   const email=validEmail(data.email),name=validText(data.name,100),ownerName=validText(data.ownerName,100);
   if(!name)throw fail(400,'Informe o nome do estabelecimento (até 100 caracteres).');
   if(!ownerName)throw fail(400,'Informe o nome do proprietário (até 100 caracteres).');
   if(!email)throw fail(400,'Informe um e-mail completo, como nome@gmail.com.');
   if(typeof data.password!=='string'||data.password.length<12||data.password.length>256)
    throw fail(400,'A senha inicial deve ter entre 12 e 256 caracteres.');
   const generated=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64).replace(/-+$/g,'');
   const slug=data.slug===undefined?(generated.length>=3?generated:'empresa-'+newId().slice(0,8)):validText(data.slug,64)?.toLowerCase();
   if(!slug||!/^[a-z0-9][a-z0-9-]{2,63}$/.test(slug))throw fail(400,'O identificador da empresa deve ter de 3 a 64 letras minúsculas, números ou hífens.');
   const exists=await q(db,'SELECT id FROM tenants WHERE active=1 LIMIT 1').first();
   if(exists)throw fail(409,'Bootstrap bloqueado: já existe empresa no banco.');
   const id=newId(),userId=newId(),branchId=newId(),when=stamp(now),endsAt=stamp(now+14*86400000);
   const hashed=await hashPassword(data.password);
   // Atomic one-time bootstrap. Concurrent requests cannot create another tenant:
   // a no-op tenant INSERT makes later FK-bound inserts fail and roll back.
   await db.batch([
    q(db,'INSERT INTO tenants(id,slug,name,created_at) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM tenants WHERE active=1)',id,slug,name,when),
    q(db,'INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)',userId,email,ownerName,hashed,when),
    q(db,'INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)',id,userId,'OWNER',when),
    q(db,'INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)',branchId,id,'MAIN','Matriz',when),
    q(db,'INSERT INTO saas_subscriptions(tenant_id,plan_key,status,ends_at,updated_at,updated_by) VALUES(?,?,?,?,?,?)',id,'trial','TRIAL',endsAt,when,'PLATFORM'),
    audit(db,id,'PLATFORM','INITIAL_BOOTSTRAP',id,now)
   ]);
   return output({created:true,tenantId:id,branchId,subscription:{status:'TRIAL',endsAt}},201);
  }catch(e){return e.status?err(e):output({error:'Bootstrap já executado ou conflito de dados.'},409);}
 }
 if(path==='/api/v1/platform/summary'&&request.method==='GET'){
  try{
   const summary=await q(db,`SELECT
      COUNT(*) AS totalTenants,
      SUM(CASE WHEN active=0 THEN 1 ELSE 0 END) AS pendingTenants,
      SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) AS approvedTenants
     FROM tenants`).first();
   const subs=await q(db,`SELECT status,COUNT(*) AS total FROM saas_subscriptions GROUP BY status ORDER BY status`).all();
   return output({summary:{totalTenants:summary.totalTenants,pendingTenants:summary.pendingTenants||0,
    approvedTenants:summary.approvedTenants||0,subscriptions:subs.results}});
  }catch(e){return err(e);}
 }
 if(path==='/api/v1/platform/audit'&&request.method==='GET'){
  try{
   const data=await q(db,`SELECT kind,tenant_id AS tenantId,actor_id AS actorId,subject_id AS subjectId,
     created_at AS createdAt FROM saas_audit_events ORDER BY created_at DESC LIMIT 100`).all();
   return output({events:data.results});
  }catch(e){return err(e);}
 }
 if(path==='/api/v1/platform/tenants'&&request.method==='GET'){
  try{
   const pending=await q(db,`SELECT t.id,t.slug,t.name,t.created_at AS createdAt,u.email_norm AS ownerEmail
     FROM tenants t JOIN tenant_memberships m ON m.tenant_id=t.id AND m.profile_key='OWNER'
     JOIN users u ON u.id=m.user_id
     WHERE t.active=0 AND m.active=0 ORDER BY t.created_at DESC,t.id LIMIT 100`).all();
   const all=await q(db,`SELECT t.id,t.slug,t.name,t.active,t.created_at AS createdAt,
    s.status AS subscriptionStatus,s.plan_key AS planKey,s.ends_at AS endsAt,
    u.email_norm AS ownerEmail
    FROM tenants t LEFT JOIN saas_subscriptions s ON s.tenant_id=t.id
    LEFT JOIN tenant_memberships m ON m.tenant_id=t.id AND m.profile_key='OWNER'
    LEFT JOIN users u ON u.id=m.user_id
    ORDER BY t.created_at DESC,t.id LIMIT 250`).all();
   return output({pendingTenants:pending.results,tenants:all.results});
  }catch(e){return err(e);}
 }
 const approve=path.match(/^\/api\/v1\/platform\/tenants\/([^/]{1,128})\/approve$/);
 if(approve&&request.method==='POST'){
  try{
   const tenantId=decodeURIComponent(approve[1]);
   const tenant=await q(db,'SELECT active FROM tenants WHERE id=?',tenantId).first();
   if(!tenant)throw fail(404,'Empresa não encontrada.');
   if(tenant.active!==0)throw fail(409,'Empresa já avaliada.');
   const membership=await q(db,"SELECT user_id AS ownerId FROM tenant_memberships WHERE tenant_id=? AND profile_key='OWNER' AND active=0",tenantId).first();
   if(!membership)throw fail(409,'Cadastro incompleto: proprietário não encontrado.');
   const approvedAt=stamp(now),endsAt=stamp(now+14*86400000);
   await db.batch([
    q(db,"INSERT INTO saas_subscriptions(tenant_id,plan_key,status,ends_at,updated_at,updated_by) VALUES(?,?,'TRIAL',?,?,?)",
     tenantId,'trial',endsAt,approvedAt,'PLATFORM'),
    q(db,'UPDATE tenants SET active=1 WHERE id=? AND active=0',tenantId),
    q(db,"UPDATE tenant_memberships SET active=1 WHERE tenant_id=? AND user_id=? AND profile_key='OWNER' AND active=0",tenantId,membership.ownerId),
    audit(db,tenantId,'PLATFORM','PUBLIC_TENANT_APPROVED',membership.ownerId,now)
   ]);
   return output({approved:true,tenantId,trialEndsAt:endsAt});
  }catch(e){return e.status?err(e):output({error:'Cadastro já aprovado ou inconsistência na ativação.'},409);}
 }
 const match=path.match(/^\/api\/v1\/platform\/tenants\/([^/]{1,128})\/subscription$/);
 if(!match||request.method!=='PUT')return output({error:'Rota administrativa indisponível.'},404);
 try{
  const t=decodeURIComponent(match[1]),data=await bodyOf(request);
  if(!statusList.has(data.status)||!validText(data.planKey,48)||!/^[a-z0-9_-]{2,48}$/.test(data.planKey)||
     typeof data.endsAt!=='string'||!Number.isFinite(Date.parse(data.endsAt))||new Date(data.endsAt).toISOString()!==data.endsAt)
   throw fail(400,'Dados de assinatura inválidos.');
  if(['TRIAL','ACTIVE'].includes(data.status)&&Date.parse(data.endsAt)<=now)throw fail(400,'Vigência expirada.');
  if(!await q(db,'SELECT id FROM tenants WHERE id=? AND active=1',t).first())throw fail(404,'Empresa inexistente.');
  await db.batch([
   q(db,"INSERT INTO saas_subscriptions(tenant_id,plan_key,status,ends_at,updated_at,updated_by) VALUES(?,?,?,?,?,'PLATFORM') ON CONFLICT(tenant_id) DO UPDATE SET plan_key=excluded.plan_key,status=excluded.status,ends_at=excluded.ends_at,updated_at=excluded.updated_at,updated_by='PLATFORM',version=saas_subscriptions.version+1",t,data.planKey,data.status,data.endsAt,stamp(now)),
   audit(db,t,'PLATFORM','SUBSCRIPTION_CHANGED',t,now,{status:data.status,planKey:data.planKey,endsAt:data.endsAt})
  ]);
  return output({updated:true,status:data.status,planKey:data.planKey,endsAt:data.endsAt});
 }catch(e){return err(e);}
}
export async function createAdditionalTenant(request,db,env,session,now){
 if(env.TENANT_SELF_SIGNUP_ENABLED!=='true')return output({error:'Cadastro de empresas ainda não habilitado.'},403);
 try{
  const data=await bodyOf(request),slug=validText(data.slug,64)?.toLowerCase(),name=validText(data.name,100);
  if(!slug||!name||!/^[a-z0-9][a-z0-9-]{2,63}$/.test(slug))throw fail(400,'Identificação inválida.');
  const n=await q(db,"SELECT COUNT(*) AS n FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=? AND m.profile_key='OWNER' AND m.active=1 AND t.active=1",session.userId).first();
  if(!n.n||n.n>=3)throw fail(403,'Limite de três empresas por proprietário.');
  // A suspended owner must not mint a new trial tenant to bypass payment.
  if(env.SAAS_ENTITLEMENTS_ENABLED==='true'){
   const eligible=await q(db,"SELECT s.tenant_id FROM saas_subscriptions s JOIN tenant_memberships m ON m.tenant_id=s.tenant_id WHERE m.user_id=? AND m.active=1 AND m.profile_key='OWNER' AND s.status='ACTIVE' AND s.plan_key!='trial' AND s.ends_at>? LIMIT 1",session.userId,stamp(now)).first();
   if(!eligible)throw fail(402,'Assinatura principal inativa.');
  }
  const id=newId(),branchId=newId(),endsAt=stamp(now+14*86400000);
  try{await db.batch([
   q(db,'INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)',id,slug,name,stamp(now)),
   q(db,'INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)',id,session.userId,'OWNER',stamp(now)),
   q(db,'INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)',branchId,id,'MAIN','Matriz',stamp(now)),
   q(db,'INSERT INTO saas_subscriptions(tenant_id,plan_key,status,ends_at,updated_at,updated_by) VALUES(?,?,?,?,?,?)',id,'trial','TRIAL',endsAt,stamp(now),session.userId),
   audit(db,id,session.userId,'TENANT_CREATED',id,now,{slug})
  ]);}catch{return output({error:'Empresa já cadastrada ou cadastro não permitido.'},409);}
  return output({tenant:{id,slug,name,branchId},subscription:{status:'TRIAL',endsAt}},201);
 }catch(e){return err(e);}
}
