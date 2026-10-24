import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalDatabase} from '../src/local-db.mjs';
import {applyLocalMigrations} from '../src/local-migrations.mjs';
import {hashPassword,sha256} from '../src/password.mjs';
import {createApi} from '../src/worker.mjs';
import {applyOfflineBaseline} from '../src/offline-replica.mjs';
import {pushOfflineOutbox,finishOfflineAuthority} from '../src/offline-outbox.mjs';

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
 const cloudApi=createApi({DB:cloud,AUTH_ENABLED:'true',COOKIE_SECURE:'true',OFFLINE_SYNC_ENABLED:'true',OFFLINE_CASH_ENABLED:'true'});
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
 // A signed gateway message must not settle an old cloud sale outside this
 // authority epoch. No machine can fabricate a prior accepted sale.
 const forgedPath='/api/v1/tenants/a/sales/legacy-sale/complete';
 const forgedBody={branchId:'a-branch',payments:[{method:'CASH',amountCents:1000}]};
 const forgedHash=await sha256(JSON.stringify({method:'POST',path:forgedPath,
   body:JSON.stringify(forgedBody),userId:'a-owner'}));
 const rogue=await call(cloudApi,'/api/v1/offline/gateway/replay',{
  method:'POST',headers:{authorization:'Bearer '+credential,'x-pdv-offline-gateway-id':gateway.id},
  body:{sequence:1,epoch:activate.data.epoch,mutationId:'forged-sale-0001',method:'POST',
   path:forgedPath,body:forgedBody,operatorId:'a-owner',payloadHash:forgedHash,createdAt:Date.now()}});
 assert.equal(rogue.status,403,'historic sale cannot be settled by forged gateway replay');

 const snapshot=await call(cloudApi,'/api/v1/offline/gateway/snapshot',
  {headers:{authorization:'Bearer '+credential,'x-pdv-offline-gateway-id':gateway.id}});
 assert.equal(snapshot.status,200);assert.equal(snapshot.data.authority.mode,'LOCAL');
 await applyOfflineBaseline(local,snapshot.data,{tenantId:'a',branchId:'a-branch',gatewayId:gateway.id});
 // A periodic snapshot must not undo a local handoff in progress.
 await local.prepare("UPDATE offline_local_authority SET mode='RECONCILING'").bind().run();
 await applyOfflineBaseline(local,snapshot.data,{tenantId:'a',branchId:'a-branch',gatewayId:gateway.id});
 assert.equal((await local.prepare('SELECT mode FROM offline_local_authority LIMIT 1').bind().first()).mode,
  'RECONCILING','Cloud pull must not reopen local writes during handoff');
 await local.prepare("UPDATE offline_local_authority SET mode='LOCAL'").bind().run();

 const localApi=createApi({DB:local,LAN_MODE:'true',AUTH_ENABLED:'true',COOKIE_SECURE:'true',OFFLINE_CASH_ENABLED:'true'});
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
 // The D1 write succeeds, but network drops its ACK: retry cannot add stock again.
 const second=await call(localApi,'/api/v1/tenants/a/inventory/receipts',{
  ...request,headers:{...deviceHeaders,'x-mutation-id':'offline-receipt-002'},
  body:{branchId:'a-branch',productId:'a-product',quantity:4}});
 assert.equal(second.status,201,JSON.stringify(second.data));
 let dropped=false;
 await assert.rejects(pushOfflineOutbox(local,{OFFLINE_CLOUD_ORIGIN:origin+'/',OFFLINE_GATEWAY_ID:gateway.id,
  OFFLINE_GATEWAY_TOKEN:credential},{fetcher:async(url,options)=>{
   const res=await fetcher(url,options);
   if(!dropped){dropped=true;throw Error('ACK_LOST');}
   return res;
  }}),/ACK_LOST/);
 assert.equal((await cloud.prepare('SELECT COUNT(*) AS n FROM inventory_movements WHERE tenant_id=?').bind('a').first()).n,2);
 await pushOfflineOutbox(local,{OFFLINE_CLOUD_ORIGIN:origin+'/',OFFLINE_GATEWAY_ID:gateway.id,
  OFFLINE_GATEWAY_TOKEN:credential},{fetcher});
 assert.equal((await cloud.prepare('SELECT COUNT(*) AS n FROM inventory_movements WHERE tenant_id=?').bind('a').first()).n,2);
 assert.equal((await cloud.prepare('SELECT balance_milli AS n FROM stock_positions WHERE tenant_id=? AND branch_id=? AND product_id=?').bind('a','a-branch','a-product').first()).n,7000);
 // Restaurant waiter actions use the same IDs locally and on canonical D1.
 // The table/session/order must replay in order, preserving every FK.
 const table=await call(localApi,'/api/v1/tenants/a/restaurant/tables',{
  method:'POST',cookie:localOwner,headers:{...deviceHeaders,'x-mutation-id':'offline-table-001'},
  body:{branchId:'a-branch',label:'Mesa 7',seats:4}});
 assert.equal(table.status,201,JSON.stringify(table.data));
 assert.match(table.data.table.id,/^[a-f0-9-]{36}$/);
 const tableId=table.data.table.id;
 const opened=await call(localApi,'/api/v1/tenants/a/restaurant/tables/'+tableId+'/open',{
  method:'POST',cookie:localOwner,headers:{...deviceHeaders,'x-mutation-id':'offline-table-open-001'},
  body:{branchId:'a-branch',partySize:3}});
 assert.equal(opened.status,201,JSON.stringify(opened.data));
 const sessionId=opened.data.session.id;
 const order=await call(localApi,'/api/v1/tenants/a/restaurant/orders',{
  method:'POST',cookie:localOwner,headers:{...deviceHeaders,'x-mutation-id':'offline-food-order-001'},
  body:{branchId:'a-branch',fulfillment:'TABLE',tableSessionId:sessionId,
    items:[{productId:'a-product',quantity:1}]}});
 assert.equal(order.status,201,JSON.stringify(order.data));
 const orderId=order.data.order.id;
 const kitchenId=(await local.prepare('SELECT id FROM restaurant_kitchen_tickets WHERE tenant_id=? AND branch_id=? AND order_id=?')
   .bind('a','a-branch',orderId).first()).id;
 const preparing=await call(localApi,'/api/v1/tenants/a/restaurant/kitchen/'+kitchenId,{
  method:'PATCH',cookie:localOwner,headers:{...deviceHeaders,'x-mutation-id':'offline-kitchen-prepare-001'},
  body:{branchId:'a-branch',status:'PREPARING'}});
 assert.equal(preparing.status,200,JSON.stringify(preparing.data));
 const ready=await call(localApi,'/api/v1/tenants/a/restaurant/kitchen/'+kitchenId,{
  method:'PATCH',cookie:localOwner,headers:{...deviceHeaders,'x-mutation-id':'offline-kitchen-ready-001'},
  body:{branchId:'a-branch',status:'READY'}});
 assert.equal(ready.status,200,JSON.stringify(ready.data));
 const delivered=await call(localApi,'/api/v1/tenants/a/restaurant/orders/'+orderId+'/deliver',{
  method:'POST',cookie:localOwner,headers:{...deviceHeaders,'x-mutation-id':'offline-order-deliver-001'},
  body:{branchId:'a-branch'}});
 assert.equal(delivered.status,200,JSON.stringify(delivered.data));
 assert.equal((await local.prepare("SELECT COUNT(*) AS n FROM offline_outbox WHERE status='PENDING'").bind().first()).n,6);
 // Cash-only pilot: a local till and one paid sale must replay exactly once.
 const terminalId='WEB-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const drawer=await call(localApi,'/api/v1/tenants/a/cash/open',{
  method:'POST',cookie:localOwner,headers:{...deviceHeaders,'x-mutation-id':'offline-cash-open-001'},
  body:{branchId:'a-branch',terminalId,openingCents:2000}});
 assert.equal(drawer.status,201,JSON.stringify(drawer.data));
 const tillId=drawer.data.session.id;
 const draft=await call(localApi,'/api/v1/tenants/a/sales',{
  method:'POST',cookie:localOwner,headers:{...deviceHeaders,'x-mutation-id':'offline-sale-open-001'},
  body:{branchId:'a-branch',terminalId}});
 assert.equal(draft.status,201,JSON.stringify(draft.data));
 const saleId=draft.data.sale.id;
 const item=await call(localApi,'/api/v1/tenants/a/sales/'+saleId+'/items',{
  method:'POST',cookie:localOwner,headers:{...deviceHeaders,'x-mutation-id':'offline-sale-item-001'},
  body:{branchId:'a-branch',productId:'a-product',quantity:1}});
 assert.equal(item.status,200,JSON.stringify(item.data));
 const blockedPix=await call(localApi,'/api/v1/tenants/a/sales/'+saleId+'/complete',{
  method:'POST',cookie:localOwner,headers:{...deviceHeaders,'x-mutation-id':'offline-pix-denied-001'},
  body:{branchId:'a-branch',payments:[{method:'PIX',amountCents:1000}]}});
 assert.equal(blockedPix.status,403,'Do not mark unverifiable PIX/card transactions paid offline');
 const paid=await call(localApi,'/api/v1/tenants/a/sales/'+saleId+'/complete',{
  method:'POST',cookie:localOwner,headers:{...deviceHeaders,'x-mutation-id':'offline-sale-paid-001'},
  body:{branchId:'a-branch',payments:[{method:'CASH',amountCents:1000}]}});
 assert.equal(paid.status,200,JSON.stringify(paid.data));
 // A stale cloud pull during a WAN recovery must not erase an already
 // committed local cash sale that has not yet reached D1.
 await applyOfflineBaseline(local,snapshot.data,{tenantId:'a',branchId:'a-branch',gatewayId:gateway.id});
 assert.equal((await local.prepare('SELECT status FROM sales WHERE id=?').bind(saleId).first()).status,'COMPLETED');
 assert.equal((await local.prepare("SELECT COUNT(*) AS n FROM offline_outbox WHERE status='PENDING'").bind().first()).n,10);
 const closed=await call(localApi,'/api/v1/tenants/a/cash/sessions/'+tillId+'/close',{
  method:'POST',cookie:localOwner,headers:{...deviceHeaders,'x-mutation-id':'offline-cash-close-001'},
  body:{branchId:'a-branch',countedCashCents:3000}});
 assert.equal(closed.status,200,JSON.stringify(closed.data));
 assert.equal((await local.prepare("SELECT COUNT(*) AS n FROM offline_outbox WHERE status='PENDING'").bind().first()).n,11);
 const released=await finishOfflineAuthority(local,{OFFLINE_CLOUD_ORIGIN:origin+'/',OFFLINE_GATEWAY_ID:gateway.id,
  OFFLINE_GATEWAY_TOKEN:credential},{fetcher});
 assert.equal(released.released,true);
 assert.equal(released.acknowledged,11);
 assert.equal((await cloud.prepare('SELECT id FROM restaurant_tables WHERE tenant_id=? AND branch_id=?').bind('a','a-branch').first()).id,tableId);
 assert.equal((await cloud.prepare('SELECT id FROM restaurant_table_sessions WHERE tenant_id=? AND branch_id=?').bind('a','a-branch').first()).id,sessionId);
 assert.equal((await cloud.prepare('SELECT id FROM restaurant_orders WHERE tenant_id=? AND branch_id=?').bind('a','a-branch').first()).id,orderId);
 assert.equal((await cloud.prepare('SELECT COUNT(*) AS n FROM restaurant_order_items WHERE tenant_id=?').bind('a').first()).n,1);
 assert.equal((await cloud.prepare('SELECT status FROM restaurant_orders WHERE id=?').bind(orderId).first()).status,'DELIVERED');
 assert.equal((await cloud.prepare('SELECT status FROM restaurant_kitchen_tickets WHERE id=?').bind(kitchenId).first()).status,'READY');
 assert.equal((await cloud.prepare('SELECT status FROM cash_sessions WHERE id=?').bind(tillId).first()).status,'CLOSED');
 assert.equal((await cloud.prepare('SELECT status FROM sales WHERE id=?').bind(saleId).first()).status,'COMPLETED');
 assert.equal((await cloud.prepare('SELECT COUNT(*) AS n FROM sale_payments WHERE sale_id=?').bind(saleId).first()).n,1);
 assert.equal((await cloud.prepare('SELECT balance_milli AS n FROM stock_positions WHERE tenant_id=? AND branch_id=? AND product_id=?')
  .bind('a','a-branch','a-product').first()).n,6000);
 assert.equal((await local.prepare('SELECT mode FROM offline_local_authority LIMIT 1').bind().first()).mode,'CLOUD');
 const resumed=await call(cloudApi,'/api/v1/tenants/a/inventory/receipts',{method:'POST',cookie:owner,
  headers:{'x-mutation-id':'cloud-after-handoff-001'},body:{branchId:'a-branch',productId:'a-product',quantity:1}});
 assert.equal(resumed.status,201,'normal SaaS writers resume only after complete release');
 // Reuse the same authorized PC for a second offline period: its SQLite
 // AUTOINCREMENT sequence must not block return-to-cloud in a new epoch.
 const secondActivation=await call(cloudApi,'/api/v1/tenants/a/offline/gateways/'+gateway.id+'/activate',{
   method:'POST',cookie:owner,body:{}});
 assert.equal(secondActivation.status,200,JSON.stringify(secondActivation.data));
 assert.ok(secondActivation.data.epoch>activate.data.epoch);
 const secondSnapshot=await call(cloudApi,'/api/v1/offline/gateway/snapshot',{
   headers:{authorization:'Bearer '+credential,'x-pdv-offline-gateway-id':gateway.id}});
 assert.equal(secondSnapshot.status,200);
 await applyOfflineBaseline(local,secondSnapshot.data,{tenantId:'a',branchId:'a-branch',gatewayId:gateway.id});
 const next=await call(localApi,'/api/v1/tenants/a/inventory/receipts',{
   ...request,headers:{...deviceHeaders,'x-mutation-id':'offline-receipt-003'},
   body:{branchId:'a-branch',productId:'a-product',quantity:2}});
 assert.equal(next.status,201,JSON.stringify(next.data));
 // One uninterrupted handoff must drain more than the per-request 25-event
 // transport batch; no false release when the queue is larger than one batch.
 for(let i=0;i<26;i++){
   const burst=await call(localApi,'/api/v1/tenants/a/inventory/receipts',{
     ...request,headers:{...deviceHeaders,'x-mutation-id':'offline-burst-'+String(i).padStart(3,'0')},
     body:{branchId:'a-branch',productId:'a-product',quantity:1}});
   assert.equal(burst.status,201,'offline burst write '+i+': '+JSON.stringify(burst.data));
 }
 const secondRelease=await finishOfflineAuthority(local,{
  OFFLINE_CLOUD_ORIGIN:origin+'/',OFFLINE_GATEWAY_ID:gateway.id,
  OFFLINE_GATEWAY_TOKEN:credential},{fetcher});
 assert.equal(secondRelease.released,true,'second offline authority epoch must reconcile');
 assert.equal((await cloud.prepare('SELECT balance_milli AS n FROM stock_positions WHERE tenant_id=? AND branch_id=? AND product_id=?')
   .bind('a','a-branch','a-product').first()).n,35000);
});

test('a new authorized gateway epoch may reuse sequence 1 without colliding with an earlier completed offline session',async t=>{
 const db=openLocalDatabase();t.after(()=>db.close());await applyLocalMigrations(db);
 const stamp='2026-10-23T00:00:00.000Z';
 await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)')
  .bind('epoch-shop','epoch-shop','Epoch Shop',stamp).run();
 await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)')
  .bind('epoch-branch','epoch-shop','MAIN','Main',stamp).run();
 const sql='INSERT INTO offline_replay_receipts(tenant_id,branch_id,epoch,sequence,mutation_id,payload_hash,result_json,acked_at) VALUES(?,?,?,?,?,?,?,?)';
 await db.prepare(sql).bind('epoch-shop','epoch-branch',1,1,'first-epoch-event','a'.repeat(64),'{}',100).run();
 await db.prepare(sql).bind('epoch-shop','epoch-branch',2,1,'second-epoch-event','b'.repeat(64),'{}',200).run();
 const rows=(await db.prepare('SELECT epoch,sequence FROM offline_replay_receipts ORDER BY epoch').bind().all()).results;
 assert.deepEqual(rows.map(row=>({epoch:row.epoch,sequence:row.sequence})),[{epoch:1,sequence:1},{epoch:2,sequence:1}]);
});
