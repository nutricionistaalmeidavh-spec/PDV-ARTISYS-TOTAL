import {sha256,hashPassword} from './password.mjs';
import {emailTransportPresent,sendTransactionalEmail} from './transactional-email.mjs';
import {formatSubscriptionEnd} from '../../../packages/core/shared/subscription-presentation.mjs';

const FIFTEEN_MINUTES=15*60*1000;
const MAX_ATTEMPTS=3;
const TEXT_CONTROL=/[\u0000-\u001f\u007f]/u;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const successText='Cadastro recebido. Se o e-mail estiver disponível, o teste grátis de 14 dias já está ativo. Tente entrar com os dados informados.';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const normalize=value=>typeof value==='string'?value.trim():'';
function validName(name){return name.length>=3&&name.length<=100&&!TEXT_CONTROL.test(name);}
function validEmail(email){return email.length<=254&&EMAIL.test(email);}
async function countAttempt(db,request,env,now){
  // Trust only the edge-supplied IP. Self-hosted requests without an edge
  // share a conservative bucket; client-provided X-Forwarded-For is ignored.
  const reported=env.TRUST_CF_CONNECTING_IP==='true'?(request.headers.get('cf-connecting-ip')||'unattributed'):'unattributed';
  const ip=/^[a-fA-F0-9:.]{3,50}$/.test(reported)?reported:'unattributed';
  const key=await sha256('signup:'+(env.AUTH_IP_SALT||'')+':'+ip);
  const sql='INSERT INTO public_signup_throttles(ip_hash,attempts,window_started) VALUES(?,1,?) '
    +'ON CONFLICT(ip_hash) DO UPDATE SET '
    +'attempts=CASE WHEN ?>=window_started+? THEN 1 ELSE attempts+1 END, '
    +'window_started=CASE WHEN ?>=window_started+? THEN ? ELSE window_started END';
  await db.prepare(sql).bind(key,now,now,FIFTEEN_MINUTES,now,FIFTEEN_MINUTES,now).run();
  const entry=await db.prepare('SELECT attempts FROM public_signup_throttles WHERE ip_hash=?').bind(key).first();
  return entry.attempts<=MAX_ATTEMPTS;
}
export async function registerPublicAccount(request,env,db,now){
  // Public trial creation is opt-in, but never depends on manual approval.
  // Repeated emails, honeypot and newly created accounts return the same public response.
  if(env.REGISTRATION_ENABLED!=='true')return json({error:'Cadastro indisponível no momento.'},503);
  if(!String(request.headers.get('content-type')||'').startsWith('application/json'))
    return json({error:'Envie os dados no formato JSON.'},415);
  if(Number(request.headers.get('content-length')||0)>4096)return json({error:'Dados muito extensos.'},413);
  const raw=await request.text();
  if(raw.length>4096)return json({error:'Dados muito extensos.'},413);
  let input;
  try{input=JSON.parse(raw);}catch{return json({error:'Dados inválidos.'},400);}
  if(!input||Array.isArray(input)||typeof input!=='object')return json({error:'Dados inválidos.'},400);
  if(input.website)return json({message:successText,status:'trial-ready'},202); // honeypot: no database write
  const displayName=normalize(input.displayName);
  const businessName=normalize(input.businessName);
  const email=normalize(input.email).toLowerCase();
  const password=input.password;
  if(!validName(displayName)||!validName(businessName)||!validEmail(email)
    ||typeof password!=='string'||password.length<12||password.length>256
    ||TEXT_CONTROL.test(password)||!/\p{L}/u.test(password)||!/\d/.test(password))
    return json({error:'Confira nome, estabelecimento, e-mail e senha (mínimo de 12 caracteres com letras e números).'},400);
  if(!await countAttempt(db,request,env,now))
    return json({error:'Muitas solicitações. Tente novamente mais tarde.'},429);
  const current=await db.prepare('SELECT id FROM users WHERE email_norm=?').bind(email).first();
  if(current)return json({message:successText,status:'trial-ready'},202);
  const userId='u_'+crypto.randomUUID();
  const tenantId='t_'+crypto.randomUUID();
  const branchId='b_'+crypto.randomUUID();
  const slug='loja-'+tenantId.slice(-18).replaceAll('-','');
  const createdAt=new Date(now).toISOString();
  const trialEndsAt=new Date(now+14*86400000).toISOString();
  const passwordHash=await hashPassword(password);
  try{
    // A single D1 transaction grants the new owner/tenant and the 14-day trial.
    // Failed statements must never leave half-created users or trial entitlements.
    await db.batch([
      db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
        .bind(userId,email,displayName,passwordHash,createdAt),
      db.prepare('INSERT INTO tenants(id,slug,name,active,created_at) VALUES(?,?,?,1,?)')
        .bind(tenantId,slug,businessName,createdAt),
      db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)')
        .bind(branchId,tenantId,'MAIN','Matriz',createdAt),
      db.prepare("INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,active,created_at) VALUES(?,?,'OWNER',1,?)")
        .bind(tenantId,userId,createdAt),
      db.prepare("INSERT INTO saas_subscriptions(tenant_id,plan_key,status,ends_at,updated_at,updated_by) VALUES(?,'trial','TRIAL',?,?,'PUBLIC_SIGNUP')")
        .bind(tenantId,trialEndsAt,createdAt),
      db.prepare("INSERT INTO saas_audit_events(id,tenant_id,actor_id,kind,subject_id,created_at,detail_json) VALUES(?,?,?,'PUBLIC_AUTO_TRIAL_STARTED',?,?,?)")
        .bind(crypto.randomUUID(),tenantId,userId,tenantId,createdAt,JSON.stringify({durationDays:14}))
    ]);
  }catch(error){
    // Concurrent duplicates are handled generically to avoid enumeration.
    if(/UNIQUE|constraint/i.test(String(error?.message||''))){
      const existing=await db.prepare('SELECT id FROM users WHERE email_norm=?').bind(email).first();
      if(existing)return json({message:successText,status:'trial-ready'},202);
    }
    throw error;
  }
  // Welcome notification is best effort. Provider outages cannot revoke a
  // completed trial; the user can immediately sign in with their own password.
  if(emailTransportPresent(env)){
    try{
      const configured=env.EMAIL_PUBLIC_BASE_URL?new URL(env.EMAIL_PUBLIC_BASE_URL):null;
      if(configured&&(configured.protocol!=='https:'||configured.username||configured.password||configured.pathname!=='/'||configured.search||configured.hash))throw Error('INVALID_EMAIL_PUBLIC_BASE_URL');
      const appUrl=new URL('/app/',configured?.origin||new URL(request.url).origin).href;
      const end=formatSubscriptionEnd(trialEndsAt);
      const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      await sendTransactionalEmail(env,{
        to:email,
        subject:'Seu acesso ao PDV Total está pronto | ArtiSys',
        text:'Seu estabelecimento '+businessName+' já pode usar o PDV Total.\n\n'
          +'Seus 14 dias de teste grátis começaram agora. Entre com o e-mail e a senha criados no cadastro:\n'
          +appUrl+'\n\nO teste termina em '
          +end
          +'.\n\nSe não reconhece este cadastro, entre em contato com a ArtiSys.',
        html:'<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#172b42;line-height:1.6;max-width:560px;margin:32px auto;padding:24px">'
          +'<p><strong>ArtiSys · PDV Total</strong></p><h1 style="font-size:24px">Seu acesso está pronto</h1>'
          +'<p>O estabelecimento <strong>'+escape(businessName)+'</strong> já pode usar o PDV Total.</p>'
          +'<p>Seus 14 dias de teste grátis começaram. Entre com o e-mail e a senha criados no cadastro.</p>'
          +'<p><a href="'+escape(appUrl)+'">Acessar o PDV Total</a></p>'
          +'<p>O teste termina em <strong>'+escape(end)+'</strong>.</p>'
          +'<p>Se não reconhece este cadastro, entre em contato com a ArtiSys.</p></body></html>'
      });
    }catch{
      // No credential, token or provider failure details are disclosed.
    }
  }
  return json({message:successText,status:'trial-ready'},202);
}
