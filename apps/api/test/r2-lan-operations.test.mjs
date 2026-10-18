import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalDatabase} from '../src/local-db.mjs';
import {applyLocalMigrations} from '../src/local-migrations.mjs';
import {createApi} from '../src/worker.mjs';
import {hashPassword} from '../src/password.mjs';

test('R2: hashed one-use pairing, branch+operator scope, revocation, read-only and tenant isolation', async t=>{
  const db=openLocalDatabase(':memory:');
  t.after(()=>db.close());
  await applyLocalMigrations(db);
  const pw=await hashPassword('LocalNetworkStrongPass2026!');
  const stamp=new Date().toISOString();
  for(const [id,email] of [['owner','owner@a.test'],['waiter','waiter@a.test'],['cashier','cashier@a.test'],['other','owner@b.test']]){
    await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
      .bind(id,email,id,pw,stamp).run();
  }
  for(const id of ['a','b']){
    await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)')
      .bind(id,'test-'+id,'Tenant '+id,stamp).run();
    await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)')
      .bind('branch-'+id,id,'MAIN','Branch '+id,stamp).run();
  }
  for(const [tenant,user,role] of [['a','owner','OWNER'],['a','waiter','WAITER'],['a','cashier','CASHIER'],['b','other','OWNER']]){
    await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)')
      .bind(tenant,user,role,stamp).run();
  }
  const origin='https://localhost:8443';
  const api=createApi({DB:db,AUTH_ENABLED:'true',COOKIE_SECURE:'true'});
  async function call(path,method='GET',body=null,cookie='',sameOrigin=true){
    const headers=new Headers();
    if(cookie)headers.set('cookie',cookie);
    if(method!=='GET'&&sameOrigin)headers.set('origin',origin);
    if(body!==null)headers.set('content-type','application/json');
    const res=await api.fetch(new Request(origin+path,{method,headers,...(body===null?{}:{body:JSON.stringify(body)})}));
    const data=await res.json();
    return {status:res.status,data,cookie:res.headers.get('set-cookie')?.split(';')[0]||null};
  }
  async function login(email){
    const res=await call('/api/v1/auth/login','POST',{email,password:'LocalNetworkStrongPass2026!'});
    assert.equal(res.status,200);
    return res.cookie;
  }
  const owner=await login('owner@a.test'),waiter=await login('waiter@a.test');
  const cashier=await login('cashier@a.test'),other=await login('owner@b.test');
  const base='/api/v1/tenants/a/lan';
  assert.equal((await call(base+'/devices','GET',null,cashier)).status,403);
  assert.equal((await call(base+'/devices','GET',null,other)).status,404);
  assert.equal((await call(base+'/pairings','POST',{kind:'WAITER',branchId:'branch-a'},waiter)).status,403);
  assert.equal((await call(base+'/pairings','POST',{kind:'WAITER',branchId:'branch-b'},owner)).status,400);
  assert.equal((await call(base+'/pairings','POST',{kind:'WAITER',branchId:'branch-a'},owner,false)).status,403);
  const first=await call(base+'/pairings','POST',{kind:'WAITER',branchId:'branch-a'},owner);
  assert.equal(first.status,201,JSON.stringify(first.data));
  assert.match(first.data.code,/^[a-f0-9]{64}$/);
  const replayPayload={code:first.data.code,name:'Atendente 01'};
  assert.equal((await call(base+'/devices/pair','POST',replayPayload,cashier)).status,403);
  const paired=await call(base+'/devices/pair','POST',replayPayload,waiter);
  assert.equal(paired.status,201,JSON.stringify(paired.data));
  assert.match(paired.data.credential,/^[a-f0-9]{64}$/);
  const id=paired.data.device.id;
  assert.equal((await call(base+'/devices/pair','POST',replayPayload,waiter)).status,409);
  const listed=await call(base+'/devices','GET',null,owner);
  assert.equal(listed.status,200);
  assert.equal(listed.data.devices.length,1);
  assert.ok(!JSON.stringify(listed.data).includes(paired.data.credential));
  assert.ok(!JSON.stringify(listed.data).includes(first.data.code));
  const check=await call(base+'/devices/check','POST',{id,credential:paired.data.credential},waiter);
  assert.equal(check.status,200);
  assert.equal(check.data.device.branchId,'branch-a');
  assert.equal((await call(base+'/devices/check','POST',{id,credential:'a'.repeat(64)},waiter)).status,401);
  assert.equal((await call(base+'/devices/check','POST',{id,credential:paired.data.credential},owner)).status,401);
  assert.equal((await call(base+'/devices/check','POST',{id,credential:paired.data.credential},other)).status,404);
  assert.equal((await call(base+'/devices/'+id,'DELETE',{},cashier)).status,403);
  assert.equal((await call(base+'/devices/'+id,'DELETE',{},owner)).status,200);
  assert.equal((await call(base+'/devices/check','POST',{id,credential:paired.data.credential},waiter)).status,401);
  assert.equal((await call(base+'/devices/'+id,'DELETE',{},owner)).status,200);
});

test('R2: pilot readiness stays incomplete until explicit evidence, with isolated persisted entries',async t=>{
  const db=openLocalDatabase(':memory:');
  t.after(()=>db.close());
  await applyLocalMigrations(db);
  const {r2LanRoute}=await import('../src/r2-lan-router.mjs');
  const owner={userId:'u-1'},membership={profileKey:'OWNER'};
  const cashier={userId:'u-2'},memberCash={profileKey:'CASHIER'};
  const origin='https://localhost:8443';
  const mk=(path,method='GET',body=null)=>new Request(origin+'/api/v1/tenants/a/'+path,{
    method,headers:{origin,'content-type':'application/json'},...(body===null?{}:{body:JSON.stringify(body)})});
  await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind('a','pilot-a','Store A',new Date().toISOString()).run();
  await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind('b','pilot-b','Store B',new Date().toISOString()).run();
  const list=await r2LanRoute(mk('lan/readiness'),db,owner,membership,'a','lan/readiness');
  assert.equal(list.status,200);
  assert.equal((await list.json()).ready,false);
  const denied=await r2LanRoute(mk('lan/readiness/restore-test','PATCH',{status:'READY',note:'Testes completos comprovados'}),db,cashier,memberCash,'a','lan/readiness/restore-test');
  assert.equal(denied.status,403);
  const missing=await r2LanRoute(mk('lan/readiness/restore-test','PATCH',{status:'READY',note:'OK'}),db,owner,membership,'a','lan/readiness/restore-test');
  assert.equal(missing.status,400);
  const written=await r2LanRoute(mk('lan/readiness/restore-test','PATCH',{status:'READY',note:'Ensaio de recuperação em máquina isolada executado',evidenceRef:'qa/local-restore-001'}),db,owner,membership,'a','lan/readiness/restore-test');
  assert.equal(written.status,200);
  assert.equal((await written.json()).check.status,'READY');
  const other=await r2LanRoute(mk('lan/readiness'),db,owner,membership,'b','lan/readiness');
  assert.equal((await other.json()).checks.find(x=>x.key==='restore-test').status,'NOT_STARTED');
  const audit=await r2LanRoute(mk('lan/audit'),db,owner,membership,'a','lan/audit');
  assert.equal(audit.status,200);
  assert.ok((await audit.json()).events.some(x=>x.action==='readiness.update'));
});
