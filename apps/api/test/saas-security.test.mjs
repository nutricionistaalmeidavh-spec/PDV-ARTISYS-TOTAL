import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createApi} from '../src/worker.mjs';
import {hashPassword} from '../src/password.mjs';

const origin='https://pdv-total.example.test';
const NOW=Date.parse('2026-10-19T12:00:00Z');
const password='Strong-Password-2026!';
const stamp=new Date(NOW).toISOString();

async function fixture(options={}){
 const db=openLocalDatabase();
 db.exec(readFileSync(new URL('../migrations/0001_identity.sql',import.meta.url),'utf8'));
 db.exec(readFileSync(new URL('../migrations/0030_saas_access.sql',import.meta.url),'utf8'));
 const pwd=await hashPassword(password);
 for(const [id,email] of [['alice','alice@example.test'],['bob','bob@example.test'],['operator','operator@example.test']])
   await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').bind(id,email,id,pwd,stamp).run();
 for(const tenant of ['a','b']){
   await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind(tenant,'test-'+tenant,'Store '+tenant,stamp).run();
   await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)').bind('branch-'+tenant,tenant,'MAIN','Main',stamp).run();
 }
 for(const [t,u,r] of [['a','alice','OWNER'],['b','bob','OWNER'],['a','operator','CASHIER']])
   await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)').bind(t,u,r,stamp).run();
 const api=createApi({DB:db,AUTH_ENABLED:'true',...options},{now:()=>NOW});
 async function request(path,method='GET',body=null,cookie='',customHeaders={}){
   const headers={...customHeaders};
   if(cookie)headers.cookie=cookie;
   if(!['GET','HEAD'].includes(method))headers.origin=origin;
   if(body!==null)headers['content-type']='application/json';
   return api.fetch(new Request(origin+path,{method,headers,...(body!==null?{body:JSON.stringify(body)}:{})}));
 }
 async function login(email){
   const r=await request('/api/v1/auth/login','POST',{email,password});
   assert.equal(r.status,200,JSON.stringify(await r.clone().json()));
   return r.headers.get('set-cookie').split(';')[0];
 }
 return {db,request,login,close:()=>db.close()};
}

test('OWNER can create a scoped branch, CASHIER and other tenant cannot',async()=>{
 const x=await fixture();
 try{
   const owner=await x.login('alice@example.test'),cashier=await x.login('operator@example.test'),other=await x.login('bob@example.test');
   const create=await x.request('/api/v1/tenants/a/branches','POST',{code:'NORTH',name:'North Store'},owner);
   assert.equal(create.status,201,await create.clone().text());
   const id=(await create.json()).branch.id;
   assert.ok(id);
   assert.equal((await x.request('/api/v1/tenants/a/branches','POST',{code:'WEST',name:'West'},cashier)).status,403);
   assert.equal((await x.request('/api/v1/tenants/a/branches','POST',{code:'SOUTH',name:'South'},other)).status,404);
   assert.equal((await x.request('/api/v1/tenants/b/branches','GET',null,owner)).status,404);
   const foreign=await x.db.prepare('SELECT tenant_id FROM branches WHERE id=?').bind(id).first();
   assert.equal(foreign.tenant_id,'a');
 }finally{x.close();}
});

test('invites use single-use bearer proof; require matching email and never grant OWNER',async()=>{
 const x=await fixture();
 try{
   const owner=await x.login('alice@example.test'),bob=await x.login('bob@example.test');
   const forbidden=await x.request('/api/v1/tenants/a/invitations','POST',{email:'new@example.test',profileKey:'OWNER'},owner);
   assert.equal(forbidden.status,400);
   const issued=await x.request('/api/v1/tenants/a/invitations','POST',{email:'new@example.test',profileKey:'CASHIER'},owner);
   assert.equal(issued.status,201,await issued.clone().text());
   const token=(await issued.json()).invitationToken;
   assert.match(token,/^[a-f0-9]{64}$/);
   assert.equal((await x.request('/api/v1/invitations/accept','POST',{token},bob)).status,403);
   const created=await x.request('/api/v1/auth/register-invite','POST',{token,email:'new@example.test',displayName:'New Employee',password:'Invite-New-Pass-2026!'});
   assert.equal(created.status,201,await created.clone().text());
   assert.equal((await x.request('/api/v1/auth/register-invite','POST',{token,email:'new@example.test',displayName:'Another',password:'Invite-New-Pass-2026!'})).status,409);
   const newUser=await x.db.prepare("SELECT m.profile_key as role,m.tenant_id as tenantId FROM users u JOIN tenant_memberships m ON u.id=m.user_id WHERE u.email_norm='new@example.test'").bind().first();
   assert.equal(newUser.role,'CASHIER');
   assert.equal(newUser.tenantId,'a');
 }finally{x.close();}
});

test('owner role management cannot demote owner, promote owner or affect another tenant',async()=>{
 const x=await fixture();
 try{
   const a=await x.login('alice@example.test'),b=await x.login('bob@example.test'),operator=await x.login('operator@example.test');
   assert.equal((await x.request('/api/v1/tenants/a/members/operator/role','PATCH',{profileKey:'SUPERVISOR'},a)).status,200);
   assert.equal((await x.request('/api/v1/tenants/a/members/alice/role','PATCH',{profileKey:'CASHIER'},a)).status,403);
   assert.equal((await x.request('/api/v1/tenants/a/members/operator/role','PATCH',{profileKey:'OWNER'},a)).status,400);
   assert.equal((await x.request('/api/v1/tenants/a/members/operator/revoke','POST',{},b)).status,404);
   assert.equal((await x.request('/api/v1/tenants/a/members/alice/revoke','POST',{},a)).status,403);
   assert.equal((await x.request('/api/v1/tenants/a/members/operator/revoke','POST',{},a)).status,200);
   assert.equal((await x.request('/api/v1/tenants/a/context','GET',null,operator)).status,404);
 }finally{x.close();}
});

test('paid entitlement is enforced server side for every tenant write and accepts only platform admin grants',async()=>{
 const x=await fixture({SAAS_ENTITLEMENTS_ENABLED:'true',PLATFORM_ADMIN_TOKEN:'private-admin-key-for-tests-1234567890'});
 try{
   const alice=await x.login('alice@example.test');
   // Existing tenant without subscription cannot mutate even if client toggles a paid flag.
   assert.equal((await x.request('/api/v1/tenants/a/branches','POST',{code:'NO',name:'Denied',paid:true},alice)).status,402);
   const deny=await x.request('/api/v1/platform/tenants/a/subscription','PUT',
     {status:'ACTIVE',planKey:'standard',endsAt:'2026-12-01T00:00:00.000Z'},alice);
   assert.equal(deny.status,403);
   const grant=await x.request('/api/v1/platform/tenants/a/subscription','PUT',
     {status:'ACTIVE',planKey:'standard',endsAt:'2026-12-01T00:00:00.000Z'},'',{authorization:'Bearer private-admin-key-for-tests-1234567890'});
   assert.equal(grant.status,200,await grant.clone().text());
   assert.equal((await x.request('/api/v1/tenants/a/branches','POST',{code:'OK',name:'Allowed'},alice)).status,201);
   const bob=await x.login('bob@example.test');
   assert.equal((await x.request('/api/v1/tenants/b/branches','POST',{code:'XX',name:'Other'},bob)).status,402);
   const suspend=await x.request('/api/v1/platform/tenants/a/subscription','PUT',
     {status:'SUSPENDED',planKey:'standard',endsAt:'2026-12-01T00:00:00.000Z'},'',{authorization:'Bearer private-admin-key-for-tests-1234567890'});
   assert.equal(suspend.status,200);
   assert.equal((await x.request('/api/v1/tenants/a/branches','POST',{code:'STOP',name:'Stopped'},alice)).status,402);
   assert.equal((await x.request('/api/v1/tenants/a/branches','GET',null,alice)).status,200,'read access survives suspension');
 }finally{x.close();}
});

test('owner sessions may be revoked without affecting another account',async()=>{
 const x=await fixture();
 try{
   const a=await x.login('alice@example.test'),b=await x.login('bob@example.test');
   const response=await x.request('/api/v1/auth/sessions','GET',null,a);
   assert.equal(response.status,200);
   const sessions=(await response.json()).sessions;
   assert.ok(sessions.length>=1);
   const revoke=await x.request('/api/v1/auth/sessions/'+sessions[0].id,'DELETE',null,b);
   assert.equal(revoke.status,404);
   assert.equal((await x.request('/api/v1/auth/sessions/'+sessions[0].id,'DELETE',null,a)).status,200);
   assert.equal((await x.request('/api/v1/auth/session','GET',null,a)).status,401);
 }finally{x.close();}
});
