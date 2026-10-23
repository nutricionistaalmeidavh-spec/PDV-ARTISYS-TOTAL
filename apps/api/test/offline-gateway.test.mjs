import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalDatabase} from '../src/local-db.mjs';
import {applyLocalMigrations} from '../src/local-migrations.mjs';
import {applyOfflineBaseline,pullOfflineBaseline} from '../src/offline-replica.mjs';
import {createApi} from '../src/worker.mjs';
import {hashPassword} from '../src/password.mjs';

test('Cloudflare branch gateway exports only approved tenant identity/catalog; local password works but monetary writes stay locked',async t=>{
 const cloud=openLocalDatabase(),local=openLocalDatabase();
 t.after(()=>{cloud.close();local.close();});
 await applyLocalMigrations(cloud);await applyLocalMigrations(local);
 const stamp='2026-10-23T00:00:00.000Z',password='OfflineGatewayLongPassword2026!';
 const hash=await hashPassword(password);
 for(const [id,slug] of [['a','tenant-a'],['b','tenant-b']]){
  await cloud.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind(id,slug,'Loja '+id,stamp).run();
  await cloud.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)')
   .bind(id+'-main',id,'MAIN','Principal',stamp).run();
  await cloud.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
   .bind(id+'-owner',id+'@qa.test','Owner '+id,hash,stamp).run();
  await cloud.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)')
   .bind(id,id+'-owner','OWNER',stamp).run();
  await cloud.prepare('INSERT INTO products(id,tenant_id,sku,name,sale_price_cents,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
   .bind(id+'-product',id,'CODE-'+id,'Product '+id,1000,stamp,stamp).run();
 }
 await cloud.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
  .bind('a-waiter','waiter@qa.test','Garçom A',hash,stamp).run();
 await cloud.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)')
  .bind('a','a-waiter','WAITER',stamp).run();
 const api=createApi({DB:cloud,AUTH_ENABLED:'true',COOKIE_SECURE:'true',OFFLINE_SYNC_ENABLED:'true',SAAS_ENTITLEMENTS_ENABLED:'false'});
 const origin='https://shop.example.test';
 async function call(path,{method='GET',body,cookie,headers={}}={}){
  const h=new Headers(headers);if(cookie)h.set('cookie',cookie);
  if(!['GET','HEAD'].includes(method))h.set('origin',origin);
  if(body!==undefined)h.set('content-type','application/json');
  const res=await api.fetch(new Request(origin+path,{method,headers:h,...(body===undefined?{}:{body:JSON.stringify(body)})}));
  return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 }
 const login=async email=>{
  const x=await call('/api/v1/auth/login',{method:'POST',body:{email,password}});
  assert.equal(x.status,200,JSON.stringify(x.data));return x.cookie;
 };
 const owner=await login('a@qa.test'),other=await login('b@qa.test'),waiter=await login('waiter@qa.test');
 const create=await call('/api/v1/tenants/a/offline/gateways',{method:'POST',cookie:owner,
  body:{branchId:'a-main',label:'PC da loja A'}});
 assert.equal(create.status,201,JSON.stringify(create.data));
 const {credential,gateway}=create.data;
 assert.match(credential,/^[a-f0-9]{64}$/);
 assert.equal((await call('/api/v1/tenants/a/offline/gateways',{method:'POST',cookie:other,
  body:{branchId:'a-main',label:'PC de B'}})).status,404);
 assert.equal((await call('/api/v1/tenants/a/offline/gateways',{method:'POST',cookie:waiter,
  body:{branchId:'a-main',label:'Garçom'}})).status,403);
 const endpoint='/api/v1/offline/gateway/snapshot';
 const headers={'authorization':'Bearer '+credential,'x-pdv-offline-gateway-id':gateway.id};
 assert.equal((await call(endpoint)).status,401);
 assert.equal((await call(endpoint,{headers:{...headers,authorization:'Bearer '+'f'.repeat(64)}})).status,401);
 const valid=await call(endpoint,{headers});
 assert.equal(valid.status,200,JSON.stringify(valid.data).slice(0,500));
 assert.equal(valid.data.baselineOnly,true);
 assert.deepEqual(valid.data.tables.tenants.map(x=>x.id),['a']);
 assert.deepEqual(valid.data.tables.products.map(x=>x.id),['a-product']);
 assert.deepEqual(valid.data.tables.users.map(x=>x.id).sort(),['a-owner','a-waiter']);
 assert.ok(!JSON.stringify(valid.data).includes('b-owner'));
 const scope={tenantId:'a',branchId:'a-main',gatewayId:gateway.id};
 const result=await applyOfflineBaseline(local,valid.data,scope);
 assert.equal(result.state,'BASELINE_ONLY');
 assert.equal((await local.prepare('SELECT count(*) AS n FROM users').bind().first()).n,2);
 const localApi=createApi({DB:local,LAN_MODE:'true',AUTH_ENABLED:'true',COOKIE_SECURE:'true',SAAS_ENTITLEMENTS_ENABLED:'false'});
 async function localCall(path,method='GET',body,cookie){
  const hdr=new Headers();if(cookie)hdr.set('cookie',cookie);
  if(method!=='GET')hdr.set('origin',origin);
  if(body)hdr.set('content-type','application/json');
  const res=await localApi.fetch(new Request(origin+path,{method,headers:hdr,...(body?{body:JSON.stringify(body)}:{})}));
  return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 }
 const localLogin=await localCall('/api/v1/auth/login','POST',{email:'waiter@qa.test',password});
 assert.equal(localLogin.status,200,JSON.stringify(localLogin.body));
 const env={OFFLINE_CLOUD_ORIGIN:origin+'/',OFFLINE_TENANT_ID:'a',OFFLINE_BRANCH_ID:'a-main',
   OFFLINE_GATEWAY_ID:gateway.id,OFFLINE_GATEWAY_TOKEN:credential};
 const firstPull=await pullOfflineBaseline(local,env,{
   fetcher:(url,options)=>api.fetch(new Request(url,{headers:options.headers}))
 });
 assert.equal(firstPull.state,'BASELINE_ONLY');
 await assert.rejects(pullOfflineBaseline(local,env,{
   fetcher:async()=>{throw Error('WAN_DOWN');}
 }),/WAN_DOWN/);
 assert.equal((await local.prepare('SELECT COUNT(*) AS n FROM users').bind().first()).n,2,
   'Network loss must not delete local identity');
 const blocked=await localCall('/api/v1/tenants/a/products','POST',{branchId:'a-main',sku:'NEW',name:'Nova',salePriceCents:2000},localLogin.cookie);
 assert.equal(blocked.status,503,'Do not claim offline commercial writes are synchronized before outbox is implemented');
 assert.equal((await local.prepare('SELECT COUNT(*) AS n FROM products').bind().first()).n,1);
 await assert.rejects(applyOfflineBaseline(local,{...valid.data,scope:{...scope,tenantId:'b'}},scope),/escopo/);
 await assert.rejects(applyOfflineBaseline(local,valid.data,{...scope,tenantId:'b'}),/escopo/);
 await cloud.prepare('INSERT INTO saas_mfa_totp(user_id,cipher,iv,enrolled_at) VALUES(?,?,?,?)')
   .bind('a-owner','encrypted-do-not-copy','iv-do-not-copy',Date.now()).run();
 assert.equal((await call(endpoint,{headers})).status,412,
   'Password-only local sign-in must never bypass SaaS MFA');
 await cloud.prepare('DELETE FROM saas_mfa_totp WHERE user_id=?').bind('a-owner').run();
 assert.equal((await call(endpoint,{headers})).status,200);
 const revoked=await call('/api/v1/tenants/a/offline/gateways/'+gateway.id,{method:'DELETE',cookie:owner});
 assert.equal(revoked.status,200);
 assert.equal((await call(endpoint,{headers})).status,401);
});

test('local baseline refuses to overwrite independently provisioned installation and rejects foreign tenant rows',async t=>{
 const db=openLocalDatabase();t.after(()=>db.close());await applyLocalMigrations(db);
 const stamp='2026-10-23T00:00:00.000Z';
 await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind('existing','my-store','Existing',stamp).run();
 const scope={tenantId:'a',branchId:'b',gatewayId:'gateway'};
 const snapshot={version:1,baselineOnly:true,scope,tables:{tenants:[{id:'a'}],branches:[{id:'b',tenant_id:'a'}],
 users:[],tenant_memberships:[],product_categories:[],products:[],stock_positions:[]}};
 await assert.rejects(applyOfflineBaseline(db,snapshot,scope),/Banco já provisionado/);
 snapshot.tables.products=[{id:'evil',tenant_id:'other'}];
 await assert.rejects(applyOfflineBaseline(db,snapshot,scope),/Produto fora da empresa/);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM tenants').bind().first()).n,1);
});
