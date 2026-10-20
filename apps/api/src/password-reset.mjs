// Public, one-time password reset. The bearer proof is emailed, never logged
// or returned in a public API response. It cannot disable an enrolled MFA.
import {hashPassword,sha256,newSessionToken} from './password.mjs';
import {emailTransportReady,sendTransactionalEmail} from './transactional-email.mjs';
const q=(db,sql,...bind)=>db.prepare(sql).bind(...bind);
const out=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{
 'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','referrer-policy':'no-referrer'
}});
const generic={message:'Se o e-mail pertencer a uma conta ativa, você receberá instruções para recuperar o acesso.'};
const validEmail=v=>typeof v==='string'&&v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
async function body(req){
 if(Number(req.headers.get('content-length')||0)>4096)throw Error('invalid_input');
 if(!String(req.headers.get('content-type')||'').startsWith('application/json'))throw Error('invalid_input');
 const raw=await req.text();if(raw.length>4096)throw Error('invalid_input');
 const data=JSON.parse(raw);if(!data||typeof data!=='object'||Array.isArray(data))throw Error('invalid_input');
 return data;
}
async function throttle(db,key,now,max=3){
 const start=Math.floor(now/900000)*900000;
 const hash=await sha256(key+':'+start);
 await q(db,`INSERT INTO saas_password_reset_throttles(bucket_hash,attempts,window_started)
  VALUES(?,1,?) ON CONFLICT(bucket_hash) DO UPDATE SET attempts=attempts+1`,hash,start).run();
 const row=await q(db,'SELECT attempts FROM saas_password_reset_throttles WHERE bucket_hash=?',hash).first();
 return row.attempts<=max;
}
async function requestReset(req,db,env,now,options){
 if(!emailTransportReady(env))return out({error:'Recuperação por e-mail não configurada.'},503);
 let input;try{input=await body(req);}catch{return out({error:'Dados inválidos.'},400);}
 const email=String(input.email||'').trim().toLowerCase();
 if(!validEmail(email))return out({error:'Informe um e-mail válido.'},400);
 const window=Math.floor(now/900000),emailHash=await sha256(email);
 const reported=env.TRUST_CF_CONNECTING_IP==='true'?(req.headers.get('cf-connecting-ip')||'unattributed'):'unattributed';
 const ip=/^[a-fA-F0-9:.]{3,64}$/.test(reported)?reported:'unattributed';
 const ipKey=await sha256('saas-reset-ip:'+(env.AUTH_IP_SALT||'')+':'+ip+':'+window);
 // Two independent buckets: targeted resend storms and distributed recipient enumeration.
 const allowedEmail=await throttle(db,'recipient:'+emailHash,now,1);
 const allowedIp=await throttle(db,'ip:'+ipKey,now,12);
 if(!allowedEmail||!allowedIp)return out(generic,202);
 const user=await q(db,'SELECT id,email_norm AS email FROM users WHERE email_norm=? AND active=1',email).first();
 if(!user)return out(generic,202);
 const token=newSessionToken(),hash=await sha256(token),expires=now+20*60000;
 await q(db,`INSERT INTO saas_password_resets(user_id,token_hash,created_at,expires_at)
  VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,
  created_at=excluded.created_at,expires_at=excluded.expires_at`,user.id,hash,now,expires).run();
 const link=new URL('/recuperar-senha/',new URL(req.url).origin);link.hash='token='+token;
 try{
  await sendTransactionalEmail(env,{
   to:user.email,subject:'Recuperar acesso ao PDV Total | ArtiSys',
   text:'Recebemos uma solicitação para redefinir sua senha do PDV Total.\n\n'
    +'Acesse o endereço abaixo para cadastrar uma nova senha (válido por 20 minutos e uso único):\n'
    +link.href+'\n\nSe você não solicitou, ignore este e-mail.\n',
   link:link.href
  },options);
 }catch{
  await q(db,'DELETE FROM saas_password_resets WHERE user_id=? AND token_hash=?',user.id,hash).run();
  return out({error:'Não foi possível enviar o e-mail de recuperação agora.'},503);
 }
 return out(generic,202);
}
async function confirmReset(req,db,now){
 let b;try{b=await body(req);}catch{return out({error:'Dados inválidos.'},400);}
 const token=b.token, password=b.password;
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return out({error:'Código inválido ou expirado.'},409);
 if(typeof password!=='string'||password.length<12||password.length>256||!/[\p{L}]/u.test(password)||!/[0-9]/.test(password)||/[\u0000-\u001f\u007f]/.test(password))
  return out({error:'A senha deve ter 12 a 256 caracteres, com letras e números.'},400);
 const hash=await sha256(token);
 const row=await q(db,`SELECT r.user_id AS userId,u.email_norm AS email
   FROM saas_password_resets r JOIN users u ON u.id=r.user_id
   WHERE r.token_hash=? AND r.expires_at>? AND u.active=1`,hash,now).first();
 if(!row)return out({error:'Código inválido, expirado ou já utilizado.'},409);
 const secret=await hashPassword(password);
 try{
  const results=await db.batch([
   q(db,`UPDATE users SET password_hash=?,email_verified_at=COALESCE(email_verified_at,?)
    WHERE id=? AND active=1 AND EXISTS(SELECT 1 FROM saas_password_resets
    WHERE user_id=? AND token_hash=? AND expires_at>?)`,
    secret,new Date(now).toISOString(),row.userId,row.userId,hash,now),
   q(db,`DELETE FROM auth_sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM saas_password_resets
    WHERE user_id=? AND token_hash=? AND expires_at>?)`,row.userId,row.userId,hash,now),
   q(db,'DELETE FROM saas_password_resets WHERE user_id=? AND token_hash=? AND expires_at>?',row.userId,hash,now)
  ]);
  if(!results[0].meta.changes||!results[2].meta.changes)
   return out({error:'Código inválido ou já utilizado.'},409);
  await q(db,'DELETE FROM login_throttles WHERE email_hash=?',await sha256(row.email)).run();
  return out({changed:true});
 }catch{return out({error:'Não foi possível redefinir a senha.'},503);}
}
export async function passwordResetRoute(req,db,env,now,options={}){
 if(req.method!=='POST')return null;
 const path=new URL(req.url).pathname;
 if(path==='/api/v1/auth/password/reset/request')return requestReset(req,db,env,now,options);
 if(path==='/api/v1/auth/password/reset/confirm')return confirmReset(req,db,now);
 return null;
}
