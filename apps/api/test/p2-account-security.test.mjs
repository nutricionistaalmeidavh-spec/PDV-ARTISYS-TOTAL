import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createApi} from '../src/worker.mjs';
import {hashPassword} from '../src/password.mjs';
import {totpForTest,accountSecurityRoute,emailVerifyPublic} from '../src/account-security.mjs';

const origin='https://pdv-total.example.test';
const NOW=Date.parse('2026-10-19T12:00:00Z');
const MFA_KEY='mfa-encryption-key-only-for-tests-at-least-32-bytes';
const password='Strong-Secure-Password-2026';

async function fixture(flags={},clock={value:NOW}){
 const db=openLocalDatabase();
 for(const migration of ['0001_identity.sql','0031_saas_access.sql','0033_p2_account_security.sql'])
   db.exec(readFileSync(new URL('../migrations/'+migration,import.meta.url),'utf8'));
 await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
   .bind('owner','owner@example.test','Example Owner',await hashPassword(password),new Date(NOW).toISOString()).run();
 await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)')
   .bind('company','example-company','Example',new Date(NOW).toISOString()).run();
 await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)')
   .bind('company','owner','OWNER',new Date(NOW).toISOString()).run();
 const api=createApi({DB:db,AUTH_ENABLED:'true',...flags},{now:()=>clock.value});
 const request=(path,method='GET',body=null,cookie='')=>api.fetch(new Request(origin+path,{
  method,headers:{...(cookie?{cookie}:{}),...(!['GET','HEAD'].includes(method)?{origin}:{}),...(body?{'content-type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
 }));
 const login=()=>request('/api/v1/auth/login','POST',{email:'owner@example.test',password});
 return {db,api,request,login,clock,close:()=>db.close()};
}
test('password login requires TOTP or one-time recovery when MFA is enrolled; no session issued prematurely',async()=>{
 const x=await fixture({MFA_ENABLED:'true',MFA_ENCRYPTION_KEY:MFA_KEY});
 try{
  const first=await x.login();assert.equal(first.status,200);
  const cookie=first.headers.get('set-cookie').split(';')[0];
  const enroll=await x.request('/api/v1/auth/mfa/enroll','POST',{password},cookie);
  assert.equal(enroll.status,200,await enroll.clone().text());
  const data=await enroll.json();
  assert.match(data.secret,/^[A-Z2-7]{32}$/);
  const code=await totpForTest(data.secret,x.clock.value);
  const confirm=await x.request('/api/v1/auth/mfa/confirm','POST',{code},cookie);
  assert.equal(confirm.status,200,await confirm.clone().text());
  const recovery=(await confirm.json()).recoveryCodes;
  assert.equal(recovery.length,8);
  const second=await x.login();assert.equal(second.status,202);
  assert.equal(second.headers.get('set-cookie'),null);
  const challenge=(await second.json()).challengeToken;
  x.clock.value+=31000;
  const wrong=await x.request('/api/v1/auth/mfa/login','POST',{challengeToken:challenge,code:'000000'});
  assert.equal(wrong.status,401);
  const verified=await x.request('/api/v1/auth/mfa/login','POST',{challengeToken:challenge,code:await totpForTest(data.secret,x.clock.value)});
  assert.equal(verified.status,200,await verified.clone().text());
  assert.match(verified.headers.get('set-cookie'),/HttpOnly/);
  assert.equal((await x.request('/api/v1/auth/mfa/login','POST',{challengeToken:challenge,code:await totpForTest(data.secret,x.clock.value)})).status,401);
  const third=await x.login();assert.equal(third.status,202);
  const another=(await third.json()).challengeToken;
  const recovered=await x.request('/api/v1/auth/mfa/login','POST',{challengeToken:another,code:recovery[0]});
  assert.equal(recovered.status,200,await recovered.clone().text());
  const last=await x.login(),lastToken=(await last.json()).challengeToken;
  assert.equal((await x.request('/api/v1/auth/mfa/login','POST',{challengeToken:lastToken,code:recovery[0]})).status,401,'recovery codes are single-use');
 }finally{x.close();}
});
test('verified-email gate protects tenant data while permitting one-use verification and account recovery workflow',async()=>{
 const x=await fixture({EMAIL_VERIFICATION_REQUIRED:'true',EMAIL_DELIVERY_URL:'https://mail.example.test/send',EMAIL_DELIVERY_TOKEN:'email-bridge-private-auth-token-123456'});
 try{
  const login=await x.login();assert.equal(login.status,200);
  const data=await login.json();assert.equal(data.emailVerificationRequired,true);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await x.request('/api/v1/tenants','GET',null,cookie)).status,403);
  let sent;
  const mocked=await accountSecurityRoute(new Request(origin+'/api/v1/auth/email/request',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),
   x.db,{EMAIL_DELIVERY_URL:'https://mail.example.test/send',EMAIL_DELIVERY_TOKEN:'email-bridge-private-auth-token-123456'},
   {userId:'owner',email:'owner@example.test'},NOW,'/api/v1/auth/email/request',
   {fetchImpl:async(_url,init)=>{sent=JSON.parse(init.body);return new Response('{}',{status:202});}});
  assert.equal(mocked.status,200,await mocked.clone().text());
  assert.equal(sent.to,'owner@example.test');
  const token=new URL(sent.link).hash.slice('#token='.length);
  assert.match(token,/^[a-f0-9]{64}$/);
  const request=()=>new Request(origin+'/api/v1/auth/email/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});
  assert.equal((await emailVerifyPublic(request(),x.db,NOW)).status,200);
  assert.equal((await emailVerifyPublic(request(),x.db,NOW)).status,409);
  assert.equal((await x.request('/api/v1/tenants','GET',null,cookie)).status,200);
 }finally{x.close();}
});
test('MFA remains opt-in and legacy non-MFA sessions do not query missing security tables',async()=>{
 const db=openLocalDatabase();
 try{
  db.exec(readFileSync(new URL('../migrations/0001_identity.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../migrations/0031_saas_access.sql',import.meta.url),'utf8'));
  await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
   .bind('plain','plain@example.test','Plain',await hashPassword(password),new Date(NOW).toISOString()).run();
  await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)')
   .bind('tenant','plain-tenant','Plain',new Date(NOW).toISOString()).run();
  await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)')
   .bind('tenant','plain','OWNER',new Date(NOW).toISOString()).run();
  const api=createApi({DB:db,AUTH_ENABLED:'true'},{now:()=>NOW});
  const r=await api.fetch(new Request(origin+'/api/v1/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'plain@example.test',password})}));
  assert.equal(r.status,200,await r.clone().text());
 }finally{db.close();}
});
