import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalDatabase} from '../src/local-db.mjs';
import {applyLocalMigrations} from '../src/local-migrations.mjs';
import {hashPassword} from '../src/password.mjs';
import {createApi} from '../src/worker.mjs';
import {pullOfflineFast} from '../src/offline-fast-client.mjs';
import {applyOfflineBaseline} from '../src/offline-replica.mjs';

test('versioned summary avoids unchanged 300-product transfer, pages changed catalogs and authenticates each request',async t=>{
 const cloud=openLocalDatabase(),local=openLocalDatabase(); t.after(()=>{cloud.close();local.close();});
 await applyLocalMigrations(cloud);await applyLocalMigrations(local);
 const stamp='2026-10-23T00:00:00.000Z',pwd='OfflineFastSyncStrongPass-2026!',digest=await hashPassword(pwd);
 await cloud.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind('fast','fast','Fast Store',stamp).run();
 await cloud.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)').bind('branch-fast','fast','MAIN','Main',stamp).run();
 await cloud.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').bind('owner-fast','fast@test.local','Owner',digest,stamp).run();
 await cloud.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)').bind('fast','owner-fast','OWNER',stamp).run();
 for(let i=0;i<302;i++){
  await cloud.prepare('INSERT INTO products(id,tenant_id,sku,name,sale_price_cents,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
   .bind('product-'+i,'fast','SKU-'+i,'Product '+i,1200,stamp,stamp).run();
 }
 const origin='https://cloud.test';
 const api=createApi({DB:cloud,AUTH_ENABLED:'true',COOKIE_SECURE:'true',OFFLINE_SYNC_ENABLED:'true'});
 async function call(path,opts={}){
  const h=new Headers(opts.headers||{});
  if(opts.cookie)h.set('cookie',opts.cookie);if(opts.method==='POST')h.set('origin',origin);
  if(opts.body)h.set('content-type','application/json');
  const response=await api.fetch(new Request(origin+path,{method:opts.method||'GET',headers:h,
   ...(opts.body?{body:JSON.stringify(opts.body)}:{})}));
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 const login=await call('/api/v1/auth/login',{method:'POST',body:{email:'fast@test.local',password:pwd}});
 assert.equal(login.status,200);
 const enrollment=await call('/api/v1/tenants/fast/offline/gateways',{
  method:'POST',cookie:login.cookie,body:{branchId:'branch-fast',label:'Offline Main'}});
 assert.equal(enrollment.status,201,JSON.stringify(enrollment.data));
 const {gateway,credential}=enrollment.data;
 const env={OFFLINE_CLOUD_ORIGIN:origin+'/',OFFLINE_TENANT_ID:'fast',OFFLINE_BRANCH_ID:'branch-fast',
  OFFLINE_GATEWAY_ID:gateway.id,OFFLINE_GATEWAY_TOKEN:credential};
 const observations=[];
 const fetcher=async(url,options)=>{
  const u=new URL(url);
  observations.push({path:u.pathname,table:u.searchParams.get('table')});
  return api.fetch(new Request(url,{method:options?.method||'GET',headers:options?.headers}));
 };
 const first=await pullOfflineFast(local,env,{fetcher,pageSize:75});
 assert.equal(first.protocol,2);
 assert.equal(first.changed.includes('products'),true);
 assert.equal((await local.prepare('SELECT COUNT(*) AS n FROM products WHERE tenant_id=?').bind('fast').first()).n,302);
 assert.ok(observations.filter(x=>x.table==='products').length>=5,'product pages are bounded');
 observations.length=0;
 const second=await pullOfflineFast(local,env,{fetcher,pageSize:75});
 assert.equal(second.changed.includes('products'),false,'same revision uses local cache');
 assert.equal(observations.filter(x=>x.table==='products').length,0,'zero catalog page requests for unchanged product dataset');
 await cloud.prepare('UPDATE products SET name=? WHERE id=?').bind('New price label','product-299').run();
 observations.length=0;
 const third=await pullOfflineFast(local,env,{fetcher,pageSize:75});
 assert.ok(third.changed.includes('products'),'triggers detect update even if updated_at did not change');
 assert.equal((await local.prepare('SELECT name FROM products WHERE id=?').bind('product-299').first()).name,'New price label');
 // Interrupted transfer retains verified pages in local SQLite so a reboot
 // can resume without re-requesting all prior 75-row batches.
 const interruptedDb=openLocalDatabase();t.after(()=>interruptedDb.close());
 await applyLocalMigrations(interruptedDb);
 let pageCount=0;
 const dropAfterTwo=async(url,opts)=>{
  if(new URL(url).pathname.endsWith('/page')&&new URL(url).searchParams.get('table')==='products'){
   pageCount++;
   if(pageCount===3)throw Error('WAN_LOST_DURING_PAGE');
  }
  return fetcher(url,opts);
 };
 await assert.rejects(pullOfflineFast(interruptedDb,env,{fetcher:dropAfterTwo,pageSize:75}),
  /WAN_LOST_DURING_PAGE/);
 assert.equal((await interruptedDb.prepare("SELECT COUNT(*) AS n FROM offline_download_pages WHERE table_name='products'").bind().first()).n,2);
 const resumed=await pullOfflineFast(interruptedDb,env,{fetcher,pageSize:75});
 assert.ok(resumed.resumedPages>=2,'verified pages survive WAN loss and resume after restart');
 assert.equal((await interruptedDb.prepare('SELECT COUNT(*) AS n FROM products').bind().first()).n,302);
 assert.equal((await interruptedDb.prepare('SELECT COUNT(*) AS n FROM offline_download_pages').bind().first()).n,0,
  'staging removed atomically after successful projection');
 await cloud.prepare('DELETE FROM products WHERE id=? AND tenant_id=?').bind('product-298','fast').run();
 await assert.rejects(pullOfflineFast(local,env,{fetcher,pageSize:75}),/Exclusão ou divergência/,
   'canonical deletion must not silently leave stale products locally');
 assert.equal((await local.prepare('SELECT COUNT(*) AS n FROM products WHERE tenant_id=?').bind('fast').first()).n,302,
   'failed snapshot rolls back and preserves previous coherent local dataset');
 const unauthorized=await call('/api/v1/offline/gateway/summary');
 assert.equal(unauthorized.status,401);
 const foreign=await call('/api/v1/offline/gateway/page?table=products&after=0&limit=50',{
  headers:{authorization:'Bearer '+credential,'x-pdv-offline-gateway-id':'not-my-gateway'}});
 assert.equal(foreign.status,401);
});

test('v2 authenticated pages import more than 2500 rows without reintroducing legacy snapshot cap',async t=>{
 const db=openLocalDatabase();t.after(()=>db.close());await applyLocalMigrations(db);
 const stamp='2026-10-23T00:00:00.000Z',scope={tenantId:'stress',branchId:'stress-branch',gatewayId:'stress-gateway'};
 const products=Array.from({length:2550},(_,i)=>({
  id:'catalog-'+i,tenant_id:'stress',sku:'PRODUCT-'+i,name:'Menu '+i,
  sale_price_cents:1000,created_at:stamp,updated_at:stamp
 }));
 const snapshot={version:1,baselineOnly:true,scope,changedTables:[
  'tenants','branches','users','tenant_memberships','saas_mfa_totp','products'
 ],tables:{
  tenants:[{id:'stress',slug:'stress',name:'Stress',active:1,created_at:stamp}],
  branches:[{id:'stress-branch',tenant_id:'stress',code:'MAIN',name:'Main',active:1,created_at:stamp}],
  users:[],tenant_memberships:[],saas_mfa_totp:[],product_categories:[],products,stock_positions:[]
 }};
 const imported=await applyOfflineBaseline(db,snapshot,scope);
 assert.equal(imported.imported.products,2550);
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM products WHERE tenant_id='stress'").bind().first()).n,2550);
});
