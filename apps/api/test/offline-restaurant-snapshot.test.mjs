import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalDatabase} from '../src/local-db.mjs';
import {applyLocalMigrations} from '../src/local-migrations.mjs';
import {hashPassword} from '../src/password.mjs';
import {createApi} from '../src/worker.mjs';
import {applyOfflineBaseline} from '../src/offline-replica.mjs';

test('D1 restaurant snapshot preserves linked closed table, served orders and settled cash without importing foreign tenant',async t=>{
 const cloud=openLocalDatabase(),local=openLocalDatabase();
 t.after(()=>{cloud.close();local.close();});
 await applyLocalMigrations(cloud);await applyLocalMigrations(local);
 const stamp='2026-10-23T11:20:00.000Z',password='OwnerIsOfflineRestaurante2026!',digest=await hashPassword(password);
 for(const id of ['alpha','beta']){
  await cloud.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind(id,id,id,stamp).run();
  await cloud.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)').bind(id+'-branch',id,'MAIN','Matriz',stamp).run();
  await cloud.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').bind(id+'-owner',id+'@test.local','Owner',digest,stamp).run();
  await cloud.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)').bind(id,id+'-owner','OWNER',stamp).run();
  await cloud.prepare('INSERT INTO products(id,tenant_id,sku,name,sale_price_cents,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
   .bind(id+'-product',id,'MAIN','Pizza',2500,stamp,stamp).run();
  await cloud.prepare('INSERT INTO restaurant_tables(id,tenant_id,branch_id,label,seats,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
   .bind(id+'-table',id,id+'-branch','Mesa 1',4,stamp,stamp).run();
 }
 const tId='alpha',branch='alpha-branch';
 await cloud.prepare('INSERT INTO restaurant_table_sessions(id,tenant_id,branch_id,table_id,status,party_size,opened_by,opened_at) VALUES(?,?,?,?,?,?,?,?)')
  .bind('table-session',tId,branch,'alpha-table','OPEN',2,'alpha-owner',stamp).run();
 await cloud.prepare('INSERT INTO restaurant_orders(id,tenant_id,branch_id,table_session_id,fulfillment,status,total_cents,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
  .bind('food-order',tId,branch,'table-session','TABLE','DELIVERED',2500,'alpha-owner',stamp,stamp).run();
 await cloud.prepare('INSERT INTO restaurant_order_items(id,tenant_id,branch_id,order_id,product_id,product_name,quantity_milli,unit_price_cents) VALUES(?,?,?,?,?,?,?,?)')
  .bind('order-item',tId,branch,'food-order','alpha-product','Pizza',1000,2500).run();
 await cloud.prepare('INSERT INTO restaurant_kitchen_tickets(id,tenant_id,branch_id,order_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
  .bind('kitchen-ticket',tId,branch,'food-order','READY',stamp,stamp).run();
 await cloud.prepare('UPDATE restaurant_table_sessions SET status=?,closed_at=? WHERE id=?').bind('CLOSED',stamp,'table-session').run();
 await cloud.prepare('INSERT INTO cash_sessions(id,tenant_id,branch_id,operator_id,status,opening_cents,opened_at) VALUES(?,?,?,?,?,?,?)')
  .bind('cash-session',tId,branch,'alpha-owner','OPEN',5000,stamp).run();
 await cloud.prepare('INSERT INTO sales(id,tenant_id,branch_id,operator_id,sale_number,status,subtotal_cents,total_cents,cash_session_id,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  .bind('paid-sale',tId,branch,'alpha-owner','001','OPEN',2500,2500,'cash-session',stamp,null).run();
 await cloud.prepare('INSERT INTO sale_items(id,tenant_id,branch_id,sale_id,product_id,product_name,sku,quantity_milli,unit_price_cents,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
  .bind('sold-item',tId,branch,'paid-sale','alpha-product','Pizza','MAIN',1000,2500,stamp).run();
 await cloud.prepare('INSERT INTO sale_payments(id,tenant_id,branch_id,sale_id,method,amount_cents,created_at) VALUES(?,?,?,?,?,?,?)')
  .bind('pix-payment',tId,branch,'paid-sale','PIX',2500,stamp).run();
 await cloud.prepare('UPDATE sales SET status=?,completed_at=? WHERE id=?')
  .bind('COMPLETED',stamp,'paid-sale').run();
 await cloud.prepare('INSERT INTO restaurant_sale_links(id,tenant_id,branch_id,table_session_id,sale_id,created_at) VALUES(?,?,?,?,?,?)')
  .bind('linked-checkout',tId,branch,'table-session','paid-sale',stamp).run();
 const origin='https://cloud.example.test';
 const api=createApi({DB:cloud,AUTH_ENABLED:'true',COOKIE_SECURE:'true',OFFLINE_SYNC_ENABLED:'true'});
 const call=async(path,{method='GET',body,cookie,headers={}}={})=>{
  const h=new Headers(headers);if(cookie)h.set('cookie',cookie);
  if(method!=='GET')h.set('origin',origin);
  if(body!==undefined)h.set('content-type','application/json');
  const response=await api.fetch(new Request(origin+path,{method,headers:h,...(body===undefined?{}:{body:JSON.stringify(body)})}));
  return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 };
 const login=await call('/api/v1/auth/login',{method:'POST',body:{email:'alpha@test.local',password}});
 assert.equal(login.status,200);
 const enrollment=await call('/api/v1/tenants/alpha/offline/gateways',{
  method:'POST',cookie:login.cookie,body:{branchId:branch,label:'PC restaurante'}});
 assert.equal(enrollment.status,201,JSON.stringify(enrollment.body));
 const {gateway,credential}=enrollment.body;
 const snapshotResponse=await call('/api/v1/offline/gateway/snapshot',{
  headers:{authorization:'Bearer '+credential,'x-pdv-offline-gateway-id':gateway.id}});
 assert.equal(snapshotResponse.status,200,JSON.stringify(snapshotResponse.body));
 const snapshot=snapshotResponse.body;
 assert.equal(snapshot.tables.restaurant_tables.length,1);
 assert.equal(snapshot.tables.restaurant_orders.length,1);
 assert.equal(snapshot.tables.sale_payments.length,1);
 assert.equal(snapshot.tables.restaurant_sale_links.length,1);
 assert.ok(!JSON.stringify(snapshot).includes('beta-table'),'another tenant never leaves D1');
 const scope={tenantId:'alpha',branchId:branch,gatewayId:gateway.id};
 const imported=await applyOfflineBaseline(local,snapshot,scope);
 assert.equal(imported.imported.restaurant_orders,1);
 const localSession=await local.prepare('SELECT status,closed_at AS closedAt FROM restaurant_table_sessions WHERE id=?').bind('table-session').first();
 assert.equal(localSession.status,'CLOSED');
 assert.equal(localSession.closedAt,stamp);
 assert.equal((await local.prepare('SELECT COUNT(*) AS n FROM restaurant_order_items').bind().first()).n,1);
 assert.equal((await local.prepare('SELECT COUNT(*) AS n FROM sale_payments').bind().first()).n,1);
 assert.equal((await local.prepare('SELECT COUNT(*) AS n FROM restaurant_sale_links').bind().first()).n,1);
 await applyOfflineBaseline(local,snapshot,scope);
 assert.equal((await local.prepare('SELECT COUNT(*) AS n FROM restaurant_order_items').bind().first()).n,1,'second pull must not duplicate immutable order rows');
 snapshot.tables.restaurant_tables[0].tenant_id='beta';
 await assert.rejects(applyOfflineBaseline(local,snapshot,scope),/fora da empresa/);
 assert.equal((await local.prepare('SELECT COUNT(*) AS n FROM restaurant_tables').bind().first()).n,1);
});
