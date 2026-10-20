import {hashPassword,verifyPassword,sha256,newSessionToken} from './password.mjs';
import {emailTransportReady,sendTransactionalEmail} from './transactional-email.mjs';
const q=(db,sql,...v)=>db.prepare(sql).bind(...v);
const out=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const dataBytes=value=>new TextEncoder().encode(value);
const base64=bytes=>{let x='';for(const n of bytes)x+=String.fromCharCode(n);return btoa(x).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');};
const from64=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-value.length%4)%4)),v=>v.charCodeAt(0));
const same=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let v=0;for(let i=0;i<a.length;i++)v|=a.charCodeAt(i)^b.charCodeAt(i);return v===0;};
const base32=bytes=>{const abc='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let acc=0,bits=0,str='';for(const b of bytes){acc=(acc<<8)|b;bits+=8;while(bits>=5){bits-=5;str+=abc[(acc>>bits)&31];}}if(bits)str+=abc[(acc<<(5-bits))&31];return str;};
const base32Bytes=input=>{const abc='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let acc=0,bits=0,result=[];for(const x of input.toUpperCase().replace(/=+$/,'')){const v=abc.indexOf(x);if(v<0)throw Error('invalid_totp_secret');acc=(acc<<5)|v;bits+=5;if(bits>=8){bits-=8;result.push((acc>>bits)&255);}}return Uint8Array.from(result);};
async function keyFor(env){
 const secret=env.MFA_ENCRYPTION_KEY;
 if(typeof secret!=='string'||secret.length<32)throw Error('MFA key not configured');
 const digest=await crypto.subtle.digest('SHA-256',dataBytes(secret));
 return crypto.subtle.importKey('raw',digest,'AES-GCM',false,['encrypt','decrypt']);
}
async function encrypt(env,secret){
 const iv=crypto.getRandomValues(new Uint8Array(12)),key=await keyFor(env);
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,dataBytes(secret));
 return {iv:base64(iv),cipher:base64(new Uint8Array(cipher))};
}
async function decrypt(env,row){
 const key=await keyFor(env),clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:from64(row.iv)},key,from64(row.cipher));
 return new TextDecoder().decode(clear);
}
async function codeAt(secret,counter){
 const data=new Uint8Array(8);let v=BigInt(counter);for(let i=7;i>=0;i--){data[i]=Number(v&255n);v>>=8n;}
 const key=await crypto.subtle.importKey('raw',base32Bytes(secret),{name:'HMAC',hash:'SHA-1'},false,['sign']);
 const digest=new Uint8Array(await crypto.subtle.sign('HMAC',key,data));
 const offset=digest[19]&15,num=((digest[offset]&127)<<24)|(digest[offset+1]<<16)|(digest[offset+2]<<8)|digest[offset+3];
 return String(num%1000000).padStart(6,'0');
}
export async function totpForTest(secret,now){return codeAt(secret,Math.floor(now/30000));}
async function verifyFactor(db,env,userId,code,now){
 if(typeof code!=='string'||code.length>32)return false;
 const row=await q(db,'SELECT cipher,iv,last_counter AS lastCounter FROM saas_mfa_totp WHERE user_id=? AND enrolled_at IS NOT NULL',userId).first();
 if(!row)return false;
 const normalized=code.toUpperCase().replaceAll('-','');
 if(/^[A-F0-9]{16}$/.test(normalized)){
  const hash=await sha256(normalized);
  const updated=await q(db,'UPDATE saas_mfa_recovery SET used_at=? WHERE user_id=? AND code_hash=? AND used_at IS NULL',now,userId,hash).run();
  return !!updated.meta.changes;
 }
 if(!/^\d{6}$/.test(code))return false;
 const secret=await decrypt(env,row),counter=Math.floor(now/30000);
 for(const offset of [-1,0,1]){
  const slot=counter+offset;if(slot<=row.lastCounter||slot<0)continue;
  if(same(code,await codeAt(secret,slot))){
   const updated=await q(db,'UPDATE saas_mfa_totp SET last_counter=? WHERE user_id=? AND last_counter<?',slot,userId,slot).run();
   return !!updated.meta.changes;
  }
 }
 return false;
}
async function parse(request){
 if(!request.headers.get('content-type')?.includes('application/json'))throw Error('Content-type must be JSON');
 if(Number(request.headers.get('content-length')||0)>4096)throw Error('Request too large');
 const raw=await request.text();if(raw.length>4096)throw Error('Request too large');
 const data=JSON.parse(raw);if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid JSON');
 return data;
}
function mfaBucket(userId,now){return sha256('pdv-mfa:'+userId+':'+Math.floor(now/900000));}
async function mfaFailures(db,userId,now){
 const key=await mfaBucket(userId,now);
 return {key,row:await q(db,'SELECT failures FROM saas_auth_rate_limits WHERE bucket_hash=? AND expires_at>?',key,now).first()};
}
async function mfaFailed(db,userId,now){
 const key=await mfaBucket(userId,now);
 await q(db,'INSERT INTO saas_auth_rate_limits(bucket_hash,failures,expires_at) VALUES(?,1,?) ON CONFLICT(bucket_hash) DO UPDATE SET failures=saas_auth_rate_limits.failures+1,expires_at=excluded.expires_at',key,(Math.floor(now/900000)+1)*900000).run();
}
export async function beginMfaLogin(db,env,userId,now){
 if(env.MFA_ENABLED!=='true')return null;
 const enrolled=await q(db,'SELECT 1 AS ok FROM saas_mfa_totp WHERE user_id=? AND enrolled_at IS NOT NULL',userId).first();
 if(!enrolled)return null;
 const rate=await mfaFailures(db,userId,now);
 const active=await q(db,'SELECT COUNT(*) AS count FROM saas_mfa_login_challenges WHERE user_id=? AND expires_at>?',userId,now).first();
 if((rate.row?.failures||0)>=10||active.count>=5)throw Object.assign(new Error('Muitas tentativas MFA; tente novamente mais tarde.'),{status:429});
 await keyFor(env); // Missing key must FAIL CLOSED, not bypass MFA.
 const token=newSessionToken();
 await q(db,'INSERT INTO saas_mfa_login_challenges(token_hash,user_id,expires_at,attempts) VALUES(?,?,?,0)',await sha256(token),userId,now+300000).run();
 return token;
}
export async function finishMfaLogin(request,db,env,now){
 if(env.MFA_ENABLED!=='true')return null;
 let body;try{body=await parse(request);}catch{return null;}
 const token=body.challengeToken;
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return null;
 const hash=await sha256(token);
 const row=await q(db,'SELECT user_id AS userId,attempts,expires_at AS expiresAt FROM saas_mfa_login_challenges WHERE token_hash=?',hash).first();
 if(!row||row.expiresAt<=now||row.attempts>=5)return null;
 const attempt=await q(db,'UPDATE saas_mfa_login_challenges SET attempts=attempts+1 WHERE token_hash=? AND expires_at>? AND attempts<5',hash,now).run();
 if(!attempt.meta.changes)return null;
 if((await mfaFailures(db,row.userId,now)).row?.failures>=10)return null;
 if(!await verifyFactor(db,env,row.userId,body.code,now)){
  await mfaFailed(db,row.userId,now);return null;
 }
 const deleteResult=await q(db,'DELETE FROM saas_mfa_login_challenges WHERE token_hash=?',hash).run();
 if(!deleteResult.meta.changes)return null;
 return q(db,'SELECT id,email_norm AS email,display_name AS displayName FROM users WHERE id=? AND active=1',row.userId).first();
}
export async function emailVerifyPublic(request,db,now){
 try{
  const body=await parse(request),token=body.token;
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return out({error:'Código inválido ou expirado.'},400);
  const hash=await sha256(token);
  const entry=await q(db,'SELECT user_id AS userId FROM saas_email_verifications WHERE token_hash=? AND expires_at>?',hash,now).first();
  if(!entry)return out({error:'Código inválido ou expirado.'},409);
  await db.batch([
   q(db,'UPDATE users SET email_verified_at=? WHERE id=? AND email_verified_at IS NULL',new Date(now).toISOString(),entry.userId),
   q(db,'DELETE FROM saas_email_verifications WHERE user_id=? AND token_hash=?',entry.userId,hash)
  ]);
  return out({verified:true});
 }catch{return out({error:'Não foi possível verificar o e-mail.'},400);}
}
async function sendEmailToken(request,db,env,session,now,options={}){
 if(!emailTransportReady(env))return out({error:'Entrega de e-mails não configurada.'},503);
 const person=await q(db,'SELECT email_norm AS email,email_verified_at AS verified FROM users WHERE id=?',session.userId).first();
 if(person?.verified)return out({alreadyVerified:true});
 if(!person)return out({error:'Conta indisponível.'},404);
 const token=newSessionToken(),tokenHash=await sha256(token),expires=now+24*3600000;
 await q(db,`INSERT INTO saas_email_verifications(user_id,token_hash,created_at,expires_at)
   VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
   token_hash=excluded.token_hash,created_at=excluded.created_at,expires_at=excluded.expires_at`,
   session.userId,tokenHash,now,expires).run();
 const link=new URL('/verificar-email/',new URL(request.url).origin);link.hash='token='+token;
 try{
  await sendTransactionalEmail(env,{to:person.email,subject:'Confirme seu e-mail no PDV Total',
   text:'Confirme seu e-mail no PDV Total: '+link.href,link:link.href},options);
  return out({sent:true,expiresAt:new Date(expires).toISOString()});
 }catch{
  await q(db,'DELETE FROM saas_email_verifications WHERE user_id=? AND token_hash=?',session.userId,tokenHash).run();
  return out({error:'Não foi possível enviar o e-mail.'},503);
 }
}
export async function accountSecurityRoute(request,db,env,session,now,path,options={}){
 const method=request.method;
 try{
  if(path==='/api/v1/auth/security'&&method==='GET'){
   const user=await q(db,'SELECT email_verified_at AS verified FROM users WHERE id=?',session.userId).first().catch(error=>{
    if(env.EMAIL_VERIFICATION_REQUIRED==='true')throw error;return null;
   });
   const mfa=env.MFA_ENABLED==='true'?await q(db,'SELECT enrolled_at AS enrolledAt FROM saas_mfa_totp WHERE user_id=?',session.userId).first():null;
   return out({emailVerified:!!user?.verified,mfaEnabled:!!mfa?.enrolledAt,emailDeliveryConfigured:emailTransportReady(env)});
  }
  if(path==='/api/v1/auth/email/request'&&method==='POST')return sendEmailToken(request,db,env,session,now,options);
  if(path==='/api/v1/auth/mfa/enroll'&&method==='POST'){
   if(env.MFA_ENABLED!=='true')return out({error:'MFA não habilitado nesta instalação.'},503);
   const b=await parse(request);
   const user=await q(db,'SELECT password_hash AS hash FROM users WHERE id=?',session.userId).first();
   if(!user||typeof b.password!=='string'||!await verifyPassword(b.password,user.hash))return out({error:'Senha atual inválida.'},403);
   const active=await q(db,'SELECT enrolled_at AS enrolled FROM saas_mfa_totp WHERE user_id=?',session.userId).first();
   if(active?.enrolled)return out({error:'MFA já habilitado.'},409);
   const secret=base32(crypto.getRandomValues(new Uint8Array(20))),sealed=await encrypt(env,secret);
   await q(db,"INSERT INTO saas_mfa_totp(user_id,cipher,iv,pending_expires_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET cipher=excluded.cipher,iv=excluded.iv,enrolled_at=NULL,pending_expires_at=excluded.pending_expires_at,last_counter=-1",
    session.userId,sealed.cipher,sealed.iv,now+600000).run();
   return out({secret,otpauthUrl:'otpauth://totp/'+encodeURIComponent('ArtiSys PDV Total:'+session.email)+'?secret='+secret+'&issuer='+encodeURIComponent('ArtiSys PDV Total')});
  }
  if(path==='/api/v1/auth/mfa/confirm'&&method==='POST'){
   if(env.MFA_ENABLED!=='true')return out({error:'MFA não habilitado nesta instalação.'},503);
   const b=await parse(request);
   const row=await q(db,'SELECT * FROM saas_mfa_totp WHERE user_id=? AND enrolled_at IS NULL AND pending_expires_at>?',session.userId,now).first();
   if(!row||typeof b.code!=='string'||!/^\d{6}$/.test(b.code))return out({error:'Configuração expirada ou código inválido.'},409);
   const secret=await decrypt(env,row);
   const slot=Math.floor(now/30000),valid=await Promise.all([-1,0,1].map(n=>codeAt(secret,slot+n)));
   if(!valid.includes(b.code))return out({error:'Código inválido.'},403);
   const codes=Array.from({length:8},()=>Array.from(crypto.getRandomValues(new Uint8Array(8)),x=>x.toString(16).padStart(2,'0')).join('').toUpperCase());
   const writes=[q(db,'UPDATE saas_mfa_totp SET enrolled_at=?,pending_expires_at=NULL,last_counter=? WHERE user_id=? AND enrolled_at IS NULL AND pending_expires_at>?',now,slot,session.userId,now)];
   for(const code of codes)writes.push(q(db,'INSERT INTO saas_mfa_recovery(code_hash,user_id) VALUES(?,?)',await sha256(code),session.userId));
   await db.batch(writes);
   return out({enabled:true,recoveryCodes:codes});
  }
  if(path==='/api/v1/auth/mfa/disable'&&method==='POST'){
   if(env.MFA_ENABLED!=='true')return out({error:'MFA não habilitado nesta instalação.'},503);
   const b=await parse(request),user=await q(db,'SELECT password_hash AS hash FROM users WHERE id=?',session.userId).first();
   if(!user||typeof b.password!=='string'||!await verifyPassword(b.password,user.hash)||!await verifyFactor(db,env,session.userId,b.code,now))
    return out({error:'Credenciais inválidas.'},403);
   await db.batch([
    q(db,'DELETE FROM saas_mfa_recovery WHERE user_id=?',session.userId),
    q(db,'DELETE FROM saas_mfa_login_challenges WHERE user_id=?',session.userId),
    q(db,'DELETE FROM saas_mfa_totp WHERE user_id=?',session.userId),
    q(db,'DELETE FROM auth_sessions WHERE user_id=? AND token_hash<>?',session.userId,session.tokenHash)
   ]);
   return out({disabled:true});
  }
  return null;
 }catch{return out({error:'Não foi possível concluir a operação de segurança.'},503);}
}
