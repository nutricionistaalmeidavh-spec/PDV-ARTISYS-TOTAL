import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalDatabase} from '../src/local-db.mjs';
import {applyLocalMigrations} from '../src/local-migrations.mjs';
import {createApi} from '../src/worker.mjs';
import {hashPassword} from '../src/password.mjs';

test('cap-003 cap-044 cap-045 cap-046 R2: independently paired terminal, waiter and kitchen devices with revocation', async t=>{
  const db=openLocalDatabase(':memory:');
  t.after(()=>db.close());
  await applyLocalMigrations(db);
  const pw=await hashPassword('LocalNetworkStrongPass2026!');
  const stamp=new Date().toISOString();
  for(const [id,email] of [['owner','owner@a.test'],['waiter','waiter@a.test'],['cashier','cashier@a.test'],['kitchen','kitchen@a.test'],['other','owner@b.test']]){
    await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
      .bind(id,email,id,pw,stamp).run();
  }
  for(const id of ['a','b']){
    await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)')
      .bind(id,'test-'+id,'Tenant '+id,stamp).run();
    await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)')
      .bind('branch-'+id,id,'MAIN','Branch '+id,stamp).run();
  }
  for(const [tenant,user,role] of [['a','owner','OWNER'],['a','waiter','WAITER'],['a','cashier','CASHIER'],['a','kitchen','KITCHEN'],['b','other','OWNER']]){
    await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)')
      .bind(tenant,user,role,stamp).run();
  }
  const origin='https://localhost:8443';
  const api=createApi({DB:db,AUTH_ENABLED:'true',COOKIE_SECURE:'true',LAN_MODE:'true'});
  async function call(path,method='GET',body=null,cookie='',sameOrigin=true,extraHeaders={}){
    const headers=new Headers();
    if(cookie)headers.set('cookie',cookie);
    for(const [key,value] of Object.entries(extraHeaders))headers.set(key,value);
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
  const cashier=await login('cashier@a.test'),kitchen=await login('kitchen@a.test'),other=await login('owner@b.test');
  const base='/api/v1/tenants/a/lan';
  const linkStatus=await call(base+'/access','GET',null,owner);
  assert.equal(linkStatus.status,200);
  assert.deepEqual(linkStatus.data.replication,{state:'NOT_CONFIGURED',cloudLinked:false,lastCloudSyncAt:null},
    'offline LAN alone is not proof of Cloudflare D1 replication');
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
  assert.equal((await call(base+'/devices/check','POST',{id,credential:paired.data.credential},owner)).status,200);
  assert.equal((await call(base+'/devices/check','POST',{id,credential:paired.data.credential},cashier)).status,403);
  assert.equal((await call(base+'/devices/check','POST',{id,credential:paired.data.credential},other)).status,404);
  const protectedPath='/api/v1/tenants/a/products?branchId=branch-a';
  const deviceHeaders={'x-pdv-device-id':id,'x-pdv-device-credential':paired.data.credential};
  assert.equal((await call(protectedPath,'GET',null,owner)).status,403,'LAN business route must require a paired device');
  assert.equal((await call(protectedPath,'GET',null,owner,true,{'x-pdv-device-id':id,'x-pdv-device-credential':'a'.repeat(64)})).status,401);
  assert.equal((await call(protectedPath,'GET',null,owner,true,deviceHeaders)).status,200);
  // cap-003: two independently paired, authenticated terminals on the same LAN.
  const secondCode=await call(base+'/pairings','POST',{kind:'TERMINAL',branchId:'branch-a'},owner);
  assert.equal(secondCode.status,201);
  const second=await call(base+'/devices/pair','POST',{code:secondCode.data.code,name:'Caixa B'},cashier);
  assert.equal(second.status,201);
  assert.notEqual(second.data.device.id,id);
  const secondHeaders={'x-pdv-device-id':second.data.device.id,
    'x-pdv-device-credential':second.data.credential};
  assert.equal((await call(protectedPath,'GET',null,owner,true,secondHeaders)).status,200);
  // cap-044: a waiter can use a WAITER device for live restaurant tables,
  // but its profile cannot enter kitchen production endpoints.
  const waiterHeaders={'x-pdv-device-id':id,'x-pdv-device-credential':paired.data.credential};
  assert.equal((await call('/api/v1/tenants/a/restaurant/tables?branchId=branch-a',
    'GET',null,waiter,true,waiterHeaders)).status,200);
  assert.equal((await call('/api/v1/tenants/a/restaurant/kitchen?branchId=branch-a',
    'GET',null,waiter,true,waiterHeaders)).status,403);
  // cap-045: independent kitchen device, strictly limited to KDS permissions.
  const kitchenCode=await call(base+'/pairings','POST',{kind:'KITCHEN',branchId:'branch-a'},owner);
  assert.equal(kitchenCode.status,201);
  const kitchenDevice=await call(base+'/devices/pair','POST',
    {code:kitchenCode.data.code,name:'KDS B'},kitchen);
  assert.equal(kitchenDevice.status,201);
  const kitchenHeaders={'x-pdv-device-id':kitchenDevice.data.device.id,
    'x-pdv-device-credential':kitchenDevice.data.credential};
  const kitchenFeed=await call('/api/v1/tenants/a/restaurant/kitchen?branchId=branch-a',
    'GET',null,kitchen,true,kitchenHeaders);
  assert.equal(kitchenFeed.status,200,JSON.stringify(kitchenFeed.data));
  assert.ok(Array.isArray(kitchenFeed.data.tickets));
  assert.equal((await call('/api/v1/tenants/a/restaurant/tables?branchId=branch-a',
    'GET',null,kitchen,true,kitchenHeaders)).status,403);

  // Actual waiter-to-KDS workflow on the paired devices.
  const mut=()=>({'x-mutation-id':crypto.randomUUID()});
  const product=await call('/api/v1/tenants/a/products','POST',
    {branchId:'branch-a',sku:'R2-PLATE',name:'Prato LAN',salePriceCents:1700},
    owner,true,{...secondHeaders,...mut()});
  assert.equal(product.status,201,JSON.stringify(product.data));
  const table=await call('/api/v1/tenants/a/restaurant/tables','POST',
    {branchId:'branch-a',label:'Mesa R2',seats:2},waiter,true,{...waiterHeaders,...mut()});
  assert.equal(table.status,201,JSON.stringify(table.data));
  const session=await call('/api/v1/tenants/a/restaurant/tables/'+table.data.table.id+'/open','POST',
    {branchId:'branch-a',partySize:2},waiter,true,{...waiterHeaders,...mut()});
  assert.equal(session.status,201,JSON.stringify(session.data));
  const order=await call('/api/v1/tenants/a/restaurant/orders','POST',
    {branchId:'branch-a',tableSessionId:session.data.session.id,
      items:[{productId:product.data.product.id,quantity:1}]},
    waiter,true,{...waiterHeaders,...mut()});
  assert.equal(order.status,201,JSON.stringify(order.data));
  const feed=await call('/api/v1/tenants/a/restaurant/kitchen?branchId=branch-a',
    'GET',null,kitchen,true,kitchenHeaders);
  assert.equal(feed.status,200);
  const ticket=feed.data.tickets.find(item=>item.orderId===order.data.order.id);
  assert.ok(ticket,'cap-044 waiter order must reach cap-045 kitchen without duplicate tickets');
  const preparing=await call('/api/v1/tenants/a/restaurant/kitchen/'+ticket.id,'PATCH',
    {branchId:'branch-a',status:'PREPARING'},kitchen,true,{...kitchenHeaders,...mut()});
  assert.equal(preparing.status,200,JSON.stringify(preparing.data));
  const ready=await call('/api/v1/tenants/a/restaurant/kitchen/'+ticket.id,'PATCH',
    {branchId:'branch-a',status:'READY'},kitchen,true,{...kitchenHeaders,...mut()});
  assert.equal(ready.status,200,JSON.stringify(ready.data));
  assert.equal((await call(base+'/devices/'+id,'DELETE',{},cashier)).status,403);
  assert.equal((await call(base+'/devices/'+id,'DELETE',{},owner)).status,200);
  assert.equal((await call(base+'/devices/check','POST',{id,credential:paired.data.credential},waiter)).status,401);
  assert.equal((await call(protectedPath,'GET',null,owner,true,deviceHeaders)).status,401,'revocation must block commercial requests');
  assert.equal((await call(protectedPath,'GET',null,owner,true,secondHeaders)).status,200,
    'revoking one device does not revoke a second independent terminal');
  assert.equal((await call('/api/v1/tenants/a/restaurant/kitchen?branchId=branch-a',
    'GET',null,kitchen,true,kitchenHeaders)).status,200,
    'revoking waiter does not revoke independent kitchen session');
  assert.equal((await call(base+'/devices/'+second.data.device.id,'DELETE',{},owner)).status,200);
  assert.equal((await call(protectedPath,'GET',null,owner,true,secondHeaders)).status,401);
  assert.equal((await call(base+'/devices/'+id,'DELETE',{},owner)).status,200);
});

test('cap-053 cap-055 R2: tenant-scoped readiness, sanitized audit and health remain private',async t=>{
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
  for(const [id,email] of [['u-1','owner@pilot.test'],['u-2','cashier@pilot.test']])
    await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
      .bind(id,email,id,'test-only-fixture',new Date().toISOString()).run();
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
  const optional=await r2LanRoute(mk('lan/readiness'),db,owner,membership,'a','lan/readiness');
  const optionalChecks=(await optional.json()).checks;
  assert.equal(optionalChecks.find(c=>c.key==='lan-test').optional,true,
    'physical two-machine QA cannot block code or the operational checklist');
  assert.equal(optionalChecks.find(c=>c.key==='printer-test').optional,true);
  const other=await r2LanRoute(mk('lan/readiness'),db,owner,membership,'b','lan/readiness');
  assert.equal((await other.json()).checks.find(x=>x.key==='restore-test').status,'NOT_STARTED');
  const audit=await r2LanRoute(mk('lan/audit'),db,owner,membership,'a','lan/audit');
  assert.equal(audit.status,200);
  const auditBody=await audit.json();
  assert.ok(auditBody.events.some(x=>x.action==='readiness.update'));
  assert.equal(JSON.stringify(auditBody).includes('owner@pilot.test'),false,
    'cap-053 sanitized audit cannot expose operator emails');
  const deniedAudit=await r2LanRoute(mk('lan/audit'),db,cashier,memberCash,'a','lan/audit');
  assert.equal(deniedAudit.status,403);
  const health=await r2LanRoute(mk('lan/health'),db,owner,membership,'a','lan/health');
  assert.equal(health.status,200);
  const status=await health.json();
  assert.equal(status.cloudRequired,false,'cap-053 health must not depend on SaaS');
  assert.equal(status.pendingPairings,0);
  const otherAudit=await r2LanRoute(mk('lan/audit'),db,owner,membership,'b','lan/audit');
  assert.equal((await otherAudit.json()).events.length,0,
    'cap-053 administrative audit is isolated per tenant');
});


test('cap-054 R2: support diagnostics ZIP contains no password, cookie, email or credentials',async t=>{
  const db=openLocalDatabase(':memory:');
  t.after(()=>db.close());
  await applyLocalMigrations(db);
  const stamp=new Date().toISOString();
  await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind('a','diagnostic-a','Diagnostics store',stamp).run();
  await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
    .bind('secret-operator','private.person@shop.test','Highly Private Operator','SENSITIVE_PASSWORD_HASH',stamp).run();
  await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)')
    .bind('a','secret-operator','OWNER',stamp).run();
  const {r2LanRoute}=await import('../src/r2-lan-router.mjs');
  const url='https://localhost:8443/api/v1/tenants/a/lan/diagnostics.zip';
  const unauth=await r2LanRoute(new Request(url),db,{userId:'secret-operator'},{profileKey:'CASHIER'},'a','lan/diagnostics.zip');
  assert.equal(unauth.status,403);
  const res=await r2LanRoute(new Request(url),db,{userId:'secret-operator'},{profileKey:'OWNER'},'a','lan/diagnostics.zip');
  assert.equal(res.status,200);
  assert.equal(res.headers.get('content-type'),'application/zip');
  const bytes=new Uint8Array(await res.arrayBuffer()),raw=new TextDecoder().decode(bytes);
  assert.equal(raw.slice(0,2),'PK');
  assert.ok(raw.includes('health.json'));
  assert.ok(raw.includes('manifest.json'));
  assert.ok(raw.includes('audit.json'));
  for(const secret of ['private.person@shop.test','SENSITIVE_PASSWORD_HASH','__Host-pdvtotal_session','credential_hash'])
    assert.ok(!raw.includes(secret),secret+' cannot be in ZIP');
  assert.ok(bytes.length>300);
});


test('cap-010 R2 optional modules: FOOD and WHOLESALE stay tenant-scoped, reversible and audited',async t=>{
  const db=openLocalDatabase(':memory:');
  t.after(()=>db.close());
  await applyLocalMigrations(db);
  const now=new Date().toISOString();
  for(const id of ['a','b'])
    await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)')
      .bind(id,'mod-'+id,'Store '+id,now).run();
  for(const [id,email] of [['owner','modules@example.test'],['cash','cash@example.test']])
    await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
      .bind(id,email,id,'fixture-not-valid-for-login',now).run();
  const {r2LanRoute,authorizeLanModule}=await import('../src/r2-lan-router.mjs');
  const base='https://localhost:8443/api/v1/tenants/a/';
  const owner={userId:'owner'},admin={profileKey:'OWNER'};
  const send=(path,method='GET',body=null,who=owner,role=admin)=>
    r2LanRoute(new Request(base+path,{method,headers:{origin:'https://localhost:8443'},
      ...(body===null?{}:{body:JSON.stringify(body)})}),db,who,role,'a',path);
  const defaults=await (await send('lan/modules')).json();
  assert.equal(defaults.modules.find(m=>m.id==='FOOD').enabled,true);
  assert.equal(defaults.modules.find(m=>m.id==='WHOLESALE').enabled,false);
  assert.equal((await send('lan/modules/FOOD','PATCH',{enabled:false},{userId:'cash'},{profileKey:'CASHIER'})).status,403);
  assert.equal((await send('lan/modules/FOOD','PATCH',{enabled:false})).status,200);
  assert.equal((await authorizeLanModule(db,'a','restaurant/tables'))?.status,403);
  assert.equal(await authorizeLanModule(db,'b','restaurant/tables'),null,'second tenant retains defaults');
  assert.equal((await send('lan/modules/FOOD','PATCH',{enabled:true})).status,200);
  assert.equal(await authorizeLanModule(db,'a','restaurant/tables'),null);
  assert.equal((await send('lan/modules/INVALID','PATCH',{enabled:true})).status,404);
  const audit=await (await send('lan/audit')).json();
  assert.ok(audit.events.some(e=>e.action==='module.updated'));
});
