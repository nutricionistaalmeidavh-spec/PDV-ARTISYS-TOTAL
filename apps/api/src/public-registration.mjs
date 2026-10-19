import {sha256,hashPassword} from './password.mjs';

const FIFTEEN_MINUTES=15*60*1000;
const MAX_ATTEMPTS=3;
const TEXT_CONTROL=/[\u0000-\u001f\u007f]/u;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const successText='Se os dados estiverem disponíveis, sua solicitação foi registrada. O acesso depende de liberação da ArtiSys.';
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
  // Registration is separately gated from authentication.
  if(env.REGISTRATION_ENABLED!=='true')return json({error:'Cadastro indisponível no momento.'},503);
  if(!String(request.headers.get('content-type')||'').startsWith('application/json'))
    return json({error:'Envie os dados no formato JSON.'},415);
  if(Number(request.headers.get('content-length')||0)>4096)return json({error:'Dados muito extensos.'},413);
  const raw=await request.text();
  if(raw.length>4096)return json({error:'Dados muito extensos.'},413);
  let input;
  try{input=JSON.parse(raw);}catch{return json({error:'Dados inválidos.'},400);}
  if(!input||Array.isArray(input)||typeof input!=='object')return json({error:'Dados inválidos.'},400);
  if(input.website)return json({message:successText},202); // honeypot: no database write
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
  if(current)return json({message:successText},202);
  const userId='u_'+crypto.randomUUID();
  const tenantId='t_'+crypto.randomUUID();
  const branchId='b_'+crypto.randomUUID();
  const slug='loja-'+tenantId.slice(-18).replaceAll('-','');
  const createdAt=new Date(now).toISOString();
  const passwordHash=await hashPassword(password);
  try{
    await db.batch([
      db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
        .bind(userId,email,displayName,passwordHash,createdAt),
      db.prepare('INSERT INTO tenants(id,slug,name,active,created_at) VALUES(?,?,?,0,?)')
        .bind(tenantId,slug,businessName,createdAt),
      db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)')
        .bind(branchId,tenantId,'MAIN','Matriz',createdAt),
      db.prepare("INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,active,created_at) VALUES(?,?,'OWNER',0,?)")
        .bind(tenantId,userId,createdAt)
    ]);
  }catch(error){
    // Concurrent duplicates are handled generically to avoid enumeration.
    if(/UNIQUE|constraint/i.test(String(error?.message||''))){
      const existing=await db.prepare('SELECT id FROM users WHERE email_norm=?').bind(email).first();
      if(existing)return json({message:successText},202);
    }
    throw error;
  }
  return json({message:successText,status:'pending-approval'},202);
}
