import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalDatabase} from '../src/local-db.mjs';
import {applyLocalMigrations} from '../src/local-migrations.mjs';
import {hashPassword} from '../src/password.mjs';
import {createApi} from '../src/worker.mjs';
import {applyOfflineBaseline} from '../src/offline-replica.mjs';
import {pushOfflineOutbox} from '../src/offline-outbox.mjs';

test('offline inventory receipt is captured atomically, replayed with same idempotency key and no double stock',async t=>{
 const cloud=openLocalDatabase(),local=openLocalDatabase();t.after(()=>{cloud.close();local.close();});
 await applyLocalMigrations(cloud);await applyLocalMigrations(local);
 const stamp='2026-10-23T16:00:00.000Z',password='Offline-Strong-Password-2026!',p=await hashPassword(password);
 for(const [id,slug] of [['a','store-a'],['b','store-b']]){
  await cloud.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind(id,slug,id,stamp).run();
  await cloud.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)').bind(id+'-branch',id,'MAIN',id,stamp).run();
  await cloud.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').bind(id+'-owner',id+'@test.local','Owner',p,stamp).run();
  await cloud.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)').bind(id,id+'-owner','OWNER',stamp).run();
  await cloud.prepare('INSERT INTO products(id,tenant_id,sku,name,sale_price_cents,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id+'-product',id,'SKU-'+id,'Product',1000,stamp,stamp).run();
 }
 const cloudApi=createApi({DB:cloud,AUTH_ENABLED:'true',COOKIE_SECURE:'true',OFFLINE_SYNC_ENABLED:'true'});
 const origin='https://shop.example.test';
 const call=async(api,path,{method='GET',body,cookie,headers={}}={})=>{
  const h=new Headers(headers);if(cookie)h.set('cookie',cookie);if(method!=='GET')h.set('origin',origin);
  if(body!==undefined)h.set('content-type','application/json');
  const res=await api.fetch(new Request(origin+path,{method,headers:h,...(body===undefined?{}:{body:JSON.stringify(body)})}));
  return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 };
 const owner=(await call(cloudApi,'/api/v1/auth/login',{method:'POST',body:{email:'a@test.local',password}})).cookie;
 const auth=await call(cloudApi,'/api/v1/tenants/a/offline/gateways',{method:'POST',cookie:owner,body:{branchId:'a-branch',label:'PC QA'}});
 assert.equal(auth.status,201);
 const {credential,gateway}=auth.data;
 const activate=await call(cloudApi,'/api/v1/tenants/a/offline/gateways/'+gateway.id+'/activate',{method:'POST',cookie:owner,body:{}});
 assert.equal(activate.status,200,JSON.stringify(activate.data));
 assert.ok(activate.data.epoch>=1);
 const denied=await call(cloudApi,'/api/v1/tenants/a/inventory/receipts',{method:'POST',cookie:owner,
  headers:{'x-mutation-id':'remote-write-0001'},body:{branchId:'a-branch',productId:'a-product',quantity:2}});
 assert.equal(denied.status,423,'cloud writer blocked during LAN authority');
 const snapshot=await call(cloudApi,'/api/v1/offline/gateway/snapshot',
  {headers:{authorization:'Bearer '+credential,'x-pdv-offline-gateway-id':gateway.id}});
 assert.equal(snapshot.status,200);assert.equal(snapshot.data.authority.mode,'LOCAL');
 await applyOfflineBaseline(local,snapshot.data,{tenantId:'a',branchId:'a-branch',gatewayId:gateway.id});
 const localApi=createApi({DB:local,LAN_MODE:'true',AUTH_ENABLED:'true',COOKIE_SECURE:'true'});
 const localOwner=(await call(localApi,'/api/v1/auth/login',{method:'POST',body:{email:'a@test.local',password}})).cookie;
 const localPair=await call(localApi,'/api/v1/tenants/a/lan/pairings',{method:'POST',cookie:localOwner,body:{kind:'TERMINAL',branchId:'a-branch'}});
 assert.equal(localPair.status,201,JSON.stringify(localPair.data));
 const paired=await call(localApi,'/api/v1/tenants/a/lan/devices/pair',{method:'POST',cookie:localOwner,
  body:{code:localPair.data.code,name:'Terminal QA'}});
 assert.equal(paired.status,201);
 const deviceHeaders={'x-pdv-device-id':paired.data.device.id,'x-pdv-device-credential':paired.data.credential};
 const request={method:'POST',cookie:localOwner,headers:{...deviceHeaders,'x-mutation-id':'offline-receipt-001'},
  body:{branchId:'a-branch',productId:'a-product',quantity:3}};
 const localSale=await call(localApi,'/api/v1/tenants/a/inventory/receipts',request);
 assert.equal(localSale.status,201,JSON.stringify(localSale.data));
 const localStock=await local.prepare('SELECT balance_milli AS n FROM stock_positions WHERE tenant_id=? AND branch_id=? AND product_id=?').bind('a','a-branch','a-product').first();
 assert.equal(localStock.n,3000);
 const outbox=(await local.prepare('SELECT mutation_id,sequence,status FROM offline_outbox').bind().all()).results;
 assert.equal(outbox.length,1);assert.equal(outbox[0].status,'PENDING');
 assert.equal((await cloud.prepare('SELECT COUNT(*) AS n FROM inventory_movements WHERE tenant_id=?').bind('a').first()).n,0);
 // WAN loss retains the locally committed write and keeps outbox pending.
 await assert.rejects(pushOfflineOutbox(local,{OFFLINE_CLOUD_ORIGIN:origin+'/',OFFLINE_GATEWAY_ID:gateway.id,
  OFFLINE_GATEWAY_TOKEN:credential},{fetcher:async()=>{throw Error('WAN_LOST');}}),/WAN_LOST/);
 assert.equal((await local.prepare('SELECT COUNT(*) AS n FROM offline_outbox WHERE status=?').bind('PENDING').first()).n,1);
 const fetcher=(url,options)=>cloudApi.fetch(new Request(url,{method:options.method,headers:{...options.headers,origin},body:options.body}));
 const first=await pushOfflineOutbox(local,{OFFLINE_CLOUD_ORIGIN:origin+'/',OFFLINE_GATEWAY_ID:gateway.id,
  OFFLINE_GATEWAY_TOKEN:credential},{fetcher});
 assert.equal(first.acknowledged,1,JSON.stringify(first));
 assert.equal((await cloud.prepare('SELECT balance_milli AS n FROM stock_positions WHERE tenant_id=? AND branch_id=? AND product_id=?').bind('a','a-branch','a-product').first()).n,3000);
 const again=await pushOfflineOutbox(local,{OFFLINE_CLOUD_ORIGIN:origin+'/',OFFLINE_GATEWAY_ID:gateway.id,
  OFFLINE_GATEWAY_TOKEN:credential},{fetcher});
 assert.equal(again.acknowledged,0);
 assert.equal((await cloud.prepare('SELECT COUNT(*) AS n FROM inventory_movements WHERE tenant_id=?').bind('a').first()).n,1);
 assert.equal((await cloud.prepare('SELECT COUNT(*) AS n FROM inventory_movements WHERE tenant_id=?').bind('b').first()).n,0);
});
