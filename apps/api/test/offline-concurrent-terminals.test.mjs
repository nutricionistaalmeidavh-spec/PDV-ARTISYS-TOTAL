import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalDatabase} from '../src/local-db.mjs';
import {applyLocalMigrations} from '../src/local-migrations.mjs';
import {hashPassword} from '../src/password.mjs';
import {createApi} from '../src/worker.mjs';
import {pullOfflineFast} from '../src/offline-fast-client.mjs';
import {finishOfflineAuthority} from '../src/offline-outbox.mjs';

test('2 waiters, 2 cashiers and 1 kitchen on the same local Wi-Fi retain ID isolation after WAN recovery',async t=>{
 const cloud=openLocalDatabase(),local=openLocalDatabase();
 t.after(()=>{cloud.close();local.close();});await applyLocalMigrations(cloud);await applyLocalMigrations(local);
 const stamp='2026-10-23T00:00:00.000Z',password='MultiTerminalsOffline2026!',digest=await hashPassword(password);
 await cloud.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind('multi','multi','Multi',stamp).run();
 await cloud.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)').bind('main','multi','MAIN','Main',stamp).run();
 await cloud.prepare('INSERT INTO products(id,tenant_id,sku,name,sale_price_cents,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
  .bind('pizza','multi','PIZZA','Pizza',1000,stamp,stamp).run();
 for(const [user,role] of [['boss','OWNER'],['wait1','WAITER'],['wait2','WAITER'],['cash1','CASHIER'],['cash2','CASHIER'],['kitchen','KITCHEN']]){
  await cloud.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
   .bind(user,user+'@qa.test',user,digest,stamp).run();
  await cloud.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)')
   .bind('multi',user,role,stamp).run();
 }
 const origin='https://pdv-cloud.test';
 const call=async(api,path,{method='GET',cookie,body,headers={}}={})=>{
  const h=new Headers(headers);if(cookie)h.set('cookie',cookie);
  if(method!=='GET')h.set('origin',origin);
  if(body!==undefined)h.set('content-type','application/json');
  const r=await api.fetch(new Request(origin+path,{method,headers:h,
   ...(body===undefined?{}:{body:JSON.stringify(body)})}));
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
 };
 const remote=createApi({DB:cloud,AUTH_ENABLED:'true',COOKIE_SECURE:'true',OFFLINE_SYNC_ENABLED:'true',OFFLINE_CASH_ENABLED:'true'});
 const login=async(api,user)=>call(api,'/api/v1/auth/login',{method:'POST',body:{email:user+'@qa.test',password}});
 const boss=(await login(remote,'boss')).cookie;
 const enroll=await call(remote,'/api/v1/tenants/multi/offline/gateways',{method:'POST',cookie:boss,
  body:{branchId:'main',label:'PC QA Multi'}});
 assert.equal(enroll.status,201);
 const {credential,gateway}=enroll.data;
 const activate=await call(remote,'/api/v1/tenants/multi/offline/gateways/'+gateway.id+'/activate',{method:'POST',cookie:boss,body:{}});
 assert.equal(activate.status,200);
 const env={OFFLINE_CLOUD_ORIGIN:origin+'/',OFFLINE_TENANT_ID:'multi',OFFLINE_BRANCH_ID:'main',
  OFFLINE_GATEWAY_ID:gateway.id,OFFLINE_GATEWAY_TOKEN:credential};
 const fetcher=(url,options)=>remote.fetch(new Request(url,{method:options?.method||'GET',
  headers:{...options.headers,origin},body:options.body}));
 await pullOfflineFast(local,env,{fetcher,pageSize:30});
 const api=createApi({DB:local,LAN_MODE:'true',AUTH_ENABLED:'true',COOKIE_SECURE:'true',OFFLINE_CASH_ENABLED:'true'});
 const logins={};
 for(const user of ['boss','wait1','wait2','cash1','cash2','kitchen']){
  const r=await login(api,user);assert.equal(r.status,200,'login '+user+': '+JSON.stringify(r.data));
  logins[user]=r.cookie;
 }
 const devices={};
 for(const [user,kind] of [['boss','TERMINAL'],['wait1','WAITER'],['wait2','WAITER'],['cash1','TERMINAL'],['cash2','TERMINAL'],['kitchen','KITCHEN']]){
  const generated=await call(api,'/api/v1/tenants/multi/lan/pairings',{
   method:'POST',cookie:logins.boss,body:{branchId:'main',kind}});
  assert.equal(generated.status,201,'pairing '+user);
  const paired=await call(api,'/api/v1/tenants/multi/lan/devices/pair',{
   method:'POST',cookie:logins[user],body:{code:generated.data.code,name:user}});
  assert.equal(paired.status,201,'pair '+user+': '+JSON.stringify(paired.data));
  devices[user]={'x-pdv-device-id':paired.data.device.id,'x-pdv-device-credential':paired.data.credential};
 }
 let n=0;
 const run=(user,method,path,body)=>call(api,'/api/v1/tenants/multi/'+path,{
  method,cookie:logins[user],headers:{...devices[user],'x-mutation-id':'parallel-'+(++n).toString().padStart(5,'0')},
  body:{branchId:'main',...body}});
 const restock=await run('boss','POST','inventory/receipts',{productId:'pizza',quantity:20});
 assert.equal(restock.status,201,JSON.stringify(restock.data));
 const table=await run('boss','POST','restaurant/tables',{label:'Mesa 1',seats:5});
 assert.equal(table.status,201,JSON.stringify(table.data));
 const opened=await run('boss','POST','restaurant/tables/'+table.data.table.id+'/open',{partySize:4});
 assert.equal(opened.status,201,JSON.stringify(opened.data));
 const tableSessionId=opened.data.session.id;
 const orders=await Promise.all(['wait1','wait2'].map(user=>
  run(user,'POST','restaurant/orders',{fulfillment:'TABLE',tableSessionId,
   items:[{productId:'pizza',quantity:1}]})));
 for(const order of orders)assert.equal(order.status,201,JSON.stringify(order.data));
 const orderIds=orders.map(o=>o.data.order.id);
 assert.equal(new Set(orderIds).size,2);
 const tickets=(await local.prepare('SELECT id,order_id FROM restaurant_kitchen_tickets WHERE tenant_id=?').bind('multi').all()).results;
 assert.equal(tickets.length,2);
 for(const status of ['PREPARING','READY']){
  const responses=await Promise.all(tickets.map(row=>run('kitchen','PATCH','restaurant/kitchen/'+row.id,{status})));
  for(const r of responses)assert.equal(r.status,200,JSON.stringify(r.data));
 }
 const delivered=await Promise.all(orderIds.map((id,i)=>run('wait'+(i+1),'POST','restaurant/orders/'+id+'/deliver',{})));
 for(const r of delivered)assert.equal(r.status,200,JSON.stringify(r.data));
 const till=await Promise.all(['cash1','cash2'].map((user,i)=>run(user,'POST','cash/open',{
  terminalId:'WEB-00000000-0000-4000-8000-'+(i+1).toString().padStart(12,'0'),openingCents:1000})));
 for(const r of till)assert.equal(r.status,201,JSON.stringify(r.data));
 const sale1=await run('cash1','POST','sales',{
  terminalId:'WEB-00000000-0000-4000-8000-000000000001',restaurantSessionId:tableSessionId});
 assert.equal(sale1.status,201,JSON.stringify(sale1.data));
 const paid1=await run('cash1','POST','sales/'+sale1.data.sale.id+'/complete',{
  payments:[{method:'CASH',amountCents:500},{method:'PIX',amountCents:1500}]});
 assert.equal(paid1.status,200,JSON.stringify(paid1.data));
 const sale2=await run('cash2','POST','sales',{
  terminalId:'WEB-00000000-0000-4000-8000-000000000002'});
 assert.equal(sale2.status,201,JSON.stringify(sale2.data));
 const item2=await run('cash2','POST','sales/'+sale2.data.sale.id+'/items',{productId:'pizza',quantity:1});
 assert.equal(item2.status,200,JSON.stringify(item2.data));
 const paid2=await run('cash2','POST','sales/'+sale2.data.sale.id+'/complete',{
  payments:[{method:'DEBIT_CARD',amountCents:400},{method:'CREDIT_CARD',amountCents:600}]});
 assert.equal(paid2.status,200,JSON.stringify(paid2.data));
 await assert.rejects(finishOfflineAuthority(local,env,{fetcher:async()=>{throw Error('WAN_DOWN');}}),/WAN_DOWN/);
 const final=await finishOfflineAuthority(local,env,{fetcher});
 assert.equal(final.released,true);
 assert.equal((await cloud.prepare('SELECT COUNT(*) AS n FROM restaurant_orders WHERE tenant_id=?').bind('multi').first()).n,2);
 assert.equal((await cloud.prepare('SELECT COUNT(*) AS n FROM sales WHERE tenant_id=?').bind('multi').first()).n,2);
 assert.equal((await cloud.prepare('SELECT COUNT(*) AS n FROM sale_payments WHERE tenant_id=?').bind('multi').first()).n,4);
 assert.equal((await cloud.prepare('SELECT COUNT(*) AS n FROM offline_replay_receipts WHERE tenant_id=?').bind('multi').first()).n,
   (await local.prepare('SELECT COUNT(*) AS n FROM offline_outbox WHERE tenant_id=?').bind('multi').first()).n);
});
