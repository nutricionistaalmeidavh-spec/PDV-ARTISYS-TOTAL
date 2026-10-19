// Security flows with no paid identity provider: admin issues one-time proofs,
// delivers them through a separately authenticated private channel.
import {sha256,hashPassword,newSessionToken} from './password.mjs';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const fail=(n,msg)=>json({error:msg},n);
const q=(db,sql,...args)=>db.prepare(sql).bind(...args);
function parseBase32(value){
 const s=typeof value==='string'?value.toUpperCase().replace(/[\s=]/g,''):'';
 if(!/^[A-Z2-7]{32,}$/.test(s))throw Error('Invalid platform MFA configuration.');
 const bytes=[];let buffer=0,bits=0;
 for(const char of s){const v='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char);buffer=(buffer<<5)|v;bits+=5;
  if(bits>=8){bits-=8;bytes.push((buffer>>bits)&255);buffer&=(1<<bits)-1;}}
 if(bytes.length<20)throw Error('Platform MFA secret is too short.');
 return new Uint8Array(bytes);
}
export async function platformTotpCode(secret,at){
 const key=await crypto.subtle.importKey('raw',parseBase32(secret),{name:'HMAC',hash:'SHA-1'},false,['sign']);
 const counter=Math.floor(at/30000),message=new Uint8Array(8);
 const data=new DataView(message.buffer);data.setUint32(0,Math.floor(counter/4294967296));data.setUint32(4,counter>>>0);
 const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,message));
 const offset=mac[mac.length-1]&15;
 const value=(((mac[offset]&127)<<24)|(mac[offset+1]<<16)|(mac[offset+2]<<8)|mac[offset+3])>>>0;
 return String(value%1000000).padStart(6,'0');
}
function compareCode(a,b){
 let diff=0;for(let i=0;i<6;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;
}
export async function verifyPlatformSecondFactor(request,db,env,now){
 const secret=env.PLATFORM_TOTP_SECRET;
 if(!secret)return env.PLATFORM_REQUIRE_MFA!=='true';
 const supplied=request.headers.get('x-platform-totp')||'';
 if(!/^[0-9]{6}$/.test(supplied))return false;
 for(const offset of [0,-1,1]){
  const time=Math.floor(now/30000)*30000+offset*30000;
  if(compareCode(supplied,await platformTotpCode(secret,time))){
   const counter=Math.floor(time/30000);
   const claimed=await q(db,'INSERT OR IGNORE INTO platform_totp_replay(counter,consumed_at) VALUES(?,?)',counter,now).run();
   if(claimed.meta.changes!==1)return false;
   await q(db,'DELETE FROM platform_totp_replay WHERE counter<?',Math.floor(now/30000)-4).run();
   return true;
  }
 }
 return false;
}
function validToken(token){return typeof token==='string'&&/^[a-f0-9]{64}$/.test(token);}
async function parse(request){
 if(!request.headers.get('content-type')?.includes('application/json'))return null;
 if(Number(request.headers.get('content-length')||0)>4096)return null;
 const raw=await request.text();if(raw.length>4096)return null;
 try{const data=JSON.parse(raw);return data&&typeof data==='object'&&!Array.isArray(data)?data:null;}catch{return null;}
}
export async function platformIdentityRoute(request,db,path,now){
 const match=path.match(/^\/api\/v1\/platform\/users\/([^/]{1,128})\/(email-verification|password-recovery)$/);
 if(!match)return null;
 if(request.method!=='POST')return fail(405,'Método não permitido.');
 const userId=decodeURIComponent(match[1]),purpose=match[2]==='email-verification'?'EMAIL_VERIFICATION':'PASSWORD_RECOVERY';
 const user=await q(db,"SELECT u.id,u.email_norm AS email,u.email_verified_at AS verifiedAt,m.tenant_id AS tenantId FROM users u JOIN tenant_memberships m ON m.user_id=u.id WHERE u.id=? ORDER BY m.tenant_id LIMIT 1",userId).first();
 if(!user)return fail(404,'Usuário não encontrado.');
 if(purpose==='EMAIL_VERIFICATION'&&user.verifiedAt)return fail(409,'E-mail já verificado.');
 const token=newSessionToken(),expiresAt=now+15*60*1000;
 await db.batch([
  q(db,'UPDATE saas_identity_challenges SET consumed_at=? WHERE user_id=? AND purpose=? AND consumed_at IS NULL',now,userId,purpose),
  q(db,'INSERT INTO saas_identity_challenges(token_hash,user_id,purpose,created_at,expires_at) VALUES(?,?,?,?,?)',await sha256(token),userId,purpose,now,expiresAt),
  q(db,"INSERT INTO saas_audit_events(id,tenant_id,actor_id,kind,subject_id,created_at,detail_json) VALUES(?,?, 'PLATFORM',?,?,?,?)",crypto.randomUUID(),user.tenantId,purpose+'_ISSUED',userId,new Date(now).toISOString(),'{}')
 ]);
 return json({issued:true,recipient:user.email,token,expiresAt:new Date(expiresAt).toISOString()},201);
}
export async function publicIdentityRoute(request,db,path,now){
 const verify=path==='/api/v1/auth/verify-email';
 const recover=path==='/api/v1/auth/reset-password';
 if(!verify&&!recover)return null;
 if(request.method!=='POST')return fail(405,'Método não permitido.');
 const input=await parse(request);
 if(!input||!validToken(input.token))return fail(400,'Código inválido ou expirado.');
 if(recover&&(typeof input.password!=='string'||input.password.length<12||input.password.length>256))
  return fail(400,'Nova senha inválida.');
 const purpose=verify?'EMAIL_VERIFICATION':'PASSWORD_RECOVERY';
 const hash=await sha256(input.token);
 const item=await q(db,'SELECT c.user_id AS userId,m.tenant_id AS tenantId FROM saas_identity_challenges c JOIN tenant_memberships m ON m.user_id=c.user_id WHERE c.token_hash=? AND c.purpose=? AND c.consumed_at IS NULL AND c.expires_at>? ORDER BY m.tenant_id LIMIT 1',hash,purpose,now).first();
 if(!item)return fail(409,'Código expirado ou já utilizado.');
 const when=new Date(now).toISOString();
 const statements=[q(db,'UPDATE saas_identity_challenges SET consumed_at=? WHERE token_hash=? AND purpose=? AND consumed_at IS NULL AND expires_at>?',now,hash,purpose,now)];
 if(verify)statements.push(q(db,'UPDATE users SET email_verified_at=? WHERE id=?',when,item.userId));
 else{
  const passwordHash=await hashPassword(input.password);
  statements.push(q(db,'UPDATE users SET password_hash=? WHERE id=?',passwordHash,item.userId));
  statements.push(q(db,'DELETE FROM auth_sessions WHERE user_id=?',item.userId));
 }
 statements.push(q(db,'INSERT INTO saas_audit_events(id,tenant_id,actor_id,kind,subject_id,created_at,detail_json) VALUES(?,?,?,?,?,?,?)',
  crypto.randomUUID(),item.tenantId,item.userId,verify?'EMAIL_VERIFIED':'PASSWORD_RESET',item.userId,when,'{}'));
 const results=await db.batch(statements);
 if(results[0]?.meta?.changes!==1)return fail(409,'Código expirado ou já utilizado.');
 return json(verify?{verified:true}:{reset:true,sessionsRevoked:true});
}
