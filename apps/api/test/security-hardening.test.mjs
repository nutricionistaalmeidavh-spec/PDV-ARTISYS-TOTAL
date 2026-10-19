import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createApi} from '../src/worker.mjs';
import {platformTotpCode} from '../src/identity-security.mjs';
import {hashPassword} from '../src/password.mjs';

const origin='https://pdv-security.example.test';
const NOW=Date.parse('2026-10-19T19:00:00Z');
const admin='platform-admin-token-test-very-long-2026';
const reader='platform-read-token-test-very-long-2026';
const totpSecret='JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const strong='NewPasswordVeryStrong2026!';
function fixture(extra={}){
 const db=openLocalDatabase();
 for(const name of ['0001_identity.sql','0030_public_registration.sql','0031_saas_access.sql','0032_identity_security.sql'])
  db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 const api=createApi({DB:db,AUTH_ENABLED:'true',REGISTRATION_ENABLED:'true',TRUST_CF_CONNECTING_IP:'true',
  PLATFORM_ADMIN_TOKEN:admin,PLATFORM_READ_TOKEN:reader,...extra},{now:()=>NOW});
 const request=(path,method='GET',body=null,headers={})=>api.fetch(new Request(origin+path,{
  method,headers:{...headers,...(!['GET','HEAD'].includes(method)?{origin}:{}),
   ...(body!==null?{'content-type':'application/json'}:{})},
  ...(body!==null?{body:JSON.stringify(body)}:{})
 }));
 return {db,request,close:()=>db.close()};
}
async function register(x,email='ana@example.test'){
 const response=await x.request('/api/v1/auth/register','POST',{
  displayName:'Ana',businessName:'Mercado Ana',email,password:strong
 },{'cf-connecting-ip':'198.51.100.2'});
 assert.equal(response.status,202);
 const pending=await x.request('/api/v1/platform/tenants','GET',null,{authorization:'Bearer '+admin});
 assert.equal(pending.status,200);
 return (await pending.json()).pendingTenants[0];
}
test('public email verification must precede platform approval and cannot be replayed',async()=>{
 const x=fixture();
 try{
  const pending=await register(x);
  const adminHeaders={authorization:'Bearer '+admin};
  assert.equal(pending.emailVerifiedAt,null);
  assert.equal((await x.request('/api/v1/platform/tenants/'+pending.id+'/approve','POST',{},adminHeaders)).status,409);
  const issue=await x.request('/api/v1/platform/users/'+pending.ownerUserId+'/email-verification','POST',{},adminHeaders);
  assert.equal(issue.status,201);
  const proof=(await issue.json()).token;
  assert.match(proof,/^[a-f0-9]{64}$/);
  assert.equal((await x.request('/api/v1/auth/verify-email','POST',{token:'0'.repeat(64)})).status,409);
  assert.equal((await x.request('/api/v1/auth/verify-email','POST',{token:proof})).status,200);
  assert.equal((await x.request('/api/v1/auth/verify-email','POST',{token:proof})).status,409);
  assert.equal((await x.request('/api/v1/platform/tenants/'+pending.id+'/approve','POST',{},adminHeaders)).status,200);
  const after=await x.request('/api/v1/platform/tenants','GET',null,adminHeaders);
  assert.equal((await after.json()).pendingTenants.length,0);
 }finally{x.close();}
});
test('private password recovery invalidates previous sessions and only permits one use',async()=>{
 const x=fixture();
 try{
  const pending=await register(x,'reset@example.test'),headers={authorization:'Bearer '+admin};
  const proof=await x.request('/api/v1/platform/users/'+pending.ownerUserId+'/email-verification','POST',{},headers);
  assert.equal((await x.request('/api/v1/auth/verify-email','POST',{token:(await proof.json()).token})).status,200);
  assert.equal((await x.request('/api/v1/platform/tenants/'+pending.id+'/approve','POST',{},headers)).status,200);
  const first=await x.request('/api/v1/auth/login','POST',{email:'reset@example.test',password:strong});
  assert.equal(first.status,200);
  const cookie=first.headers.get('set-cookie').split(';')[0];
  const issue=await x.request('/api/v1/platform/users/'+pending.ownerUserId+'/password-recovery','POST',{},headers);
  assert.equal(issue.status,201);
  const token=(await issue.json()).token;
  assert.equal((await x.request('/api/v1/auth/reset-password','POST',{token,password:'short'})).status,400);
  assert.equal((await x.request('/api/v1/auth/reset-password','POST',{token,password:'AnotherValidPassword2026!'})).status,200);
  assert.equal((await x.request('/api/v1/auth/reset-password','POST',{token,password:'ThirdValidPassword2026!'})).status,409);
  assert.equal((await x.request('/api/v1/auth/session','GET',null,{cookie})).status,401);
  assert.equal((await x.request('/api/v1/auth/login','POST',{email:'reset@example.test',password:strong})).status,401);
  assert.equal((await x.request('/api/v1/auth/login','POST',{email:'reset@example.test',password:'AnotherValidPassword2026!'})).status,200);
 }finally{x.close();}
});
test('read-only platform credential is scoped; privileged operations require TOTP and reject replay',async()=>{
 const x=fixture({PLATFORM_TOTP_SECRET:totpSecret,PLATFORM_REQUIRE_MFA:'true'});
 try{
  const pending=await register(x);
  const read={authorization:'Bearer '+reader},write={authorization:'Bearer '+admin};
  assert.equal((await x.request('/api/v1/platform/tenants','GET',null,read)).status,200);
  assert.equal((await x.request('/api/v1/platform/users/'+pending.ownerUserId+'/email-verification','POST',{},read)).status,403);
  assert.equal((await x.request('/api/v1/platform/users/'+pending.ownerUserId+'/email-verification','POST',{},write)).status,403);
  const code=await platformTotpCode(totpSecret,NOW);
  assert.equal((await x.request('/api/v1/platform/users/'+pending.ownerUserId+'/email-verification','POST',{},{
   ...write,'x-platform-totp':code})).status,201);
  assert.equal((await x.request('/api/v1/platform/users/'+pending.ownerUserId+'/password-recovery','POST',{},{
   ...write,'x-platform-totp':code})).status,403);
  const blocked=fixture({PLATFORM_REQUIRE_MFA:'true'});
  try{
   const p=await register(blocked);
   assert.equal((await blocked.request('/api/v1/platform/users/'+p.ownerUserId+'/email-verification','POST',{},write)).status,403);
  }finally{blocked.close();}
 }finally{x.close();}
});
test('tenant paths, membership roles and foreign branch identifiers do not grant financial access',async()=>{
 const x=fixture();
 try{
  const db=x.db,pwd=await hashPassword(strong),stamp=new Date(NOW).toISOString();
  for(const [id,email] of [['alice','alice2@example.test'],['bob','bob2@example.test'],['cash','cash@example.test']])
   await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').bind(id,email,id,pwd,stamp).run();
  for(const t of ['a','b']){
   await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind(t,'store-'+t,'Store '+t,stamp).run();
   await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)').bind('branch-'+t,t,'MAIN','Principal',stamp).run();
  }
  await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)').bind('secondary-a','a','NORTH','North',stamp).run();
  for(const [t,u,role] of [['a','alice','OWNER'],['b','bob','OWNER'],['a','cash','CASHIER']])
   await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)').bind(t,u,role,stamp).run();
  const login=async email=>{
   const result=await x.request('/api/v1/auth/login','POST',{email,password:strong});
   assert.equal(result.status,200);return result.headers.get('set-cookie').split(';')[0];
  };
  const alice=await login('alice2@example.test'),bob=await login('bob2@example.test'),cash=await login('cash@example.test');
  const list=await x.request('/api/v1/tenants/a/branches','GET',null,{cookie:alice});
  assert.equal(list.status,200);
  assert.deepEqual(new Set((await list.json()).branches.map(b=>b.id)),new Set(['branch-a','secondary-a']));
  assert.equal((await x.request('/api/v1/tenants/b/context','GET',null,{cookie:alice})).status,404);
  assert.equal((await x.request('/api/v1/tenants/a/members','GET',null,{cookie:bob})).status,404);
  assert.equal((await x.request('/api/v1/tenants/a/finance-advanced/accounts?branchId=branch-b','GET',null,{cookie:alice})).status,404);
  assert.equal((await x.request('/api/v1/tenants/a/branches','POST',{code:'WEST',name:'West'},{cookie:cash})).status,403);
  assert.equal((await x.request('/api/v1/tenants/a/branches','POST',{code:'WEST',name:'West'},{cookie:alice})).status,201);
 }finally{x.close();}
});
