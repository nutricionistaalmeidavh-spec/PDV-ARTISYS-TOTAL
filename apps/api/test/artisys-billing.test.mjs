import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createBinding,billingConnectorRoute,billingCustomerRoute,signHex} from '../src/artisys-billing.mjs';
const origin='https://pdv-total.example.test',at=Date.parse('2026-10-19T12:00:00Z'),secret='pdv-billing-secret-for-local-tests-1234567890';
const setup=async()=>{
 const db=openLocalDatabase();
 for(const sql of ['0001_identity.sql','0031_saas_access.sql','0032_artisys_billing.sql'])
   db.exec(readFileSync(new URL('../migrations/'+sql,import.meta.url),'utf8'));
 for(const [id,email] of [['owner','owner@example.test'],['outsider','outsider@example.test']])
  await db.prepare("INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)").bind(id,email,id,'mock',new Date(at).toISOString()).run();
 await db.prepare("INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)").bind('company','company','Company',new Date(at).toISOString()).run();
 await db.prepare("INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)").bind('company','owner','OWNER',new Date(at).toISOString()).run();
 return db;
};
const signed=async(payload,timestamp=at,overrides={})=>{
 const body=JSON.stringify(payload),sig=await signHex(overrides.secret||secret,String(timestamp)+'.'+body);
 return new Request(origin+'/api/v1/integrations/artisys/billing',{method:'POST',headers:{'content-type':'application/json','x-artisys-timestamp':String(timestamp),'x-artisys-signature':'sha256='+sig,'x-artisys-delivery-id':payload.idempotencyKey},body});
};
test('payment delivery authenticates HMAC, fixed tenant binding, period and replay before granting subscription',async()=>{
 const db=await setup(),env={ARTISYS_BILLING_ENABLED:'true',ARTISYS_BILLING_SECRET:secret};
 try{
  const ticket=await createBinding(secret,{tenantId:'company',userId:'owner',expiresAt:at+86400000});
  await db.prepare('INSERT INTO saas_billing_orders(order_id,tenant_id,owner_user_id,offer_id,plan_key,amount_cents,checkout_url,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind('pay-order','company','owner','monthly','monthly',5900,'https://asaas.com/checkoutSession/show?id=abcdefghijk','idempotency-for-one-order',new Date(at).toISOString()).run();
  const payload={event:'artisys.license.activate',orderId:'pay-order',productId:'pdv-total-saas',email:'owner@example.test',amountCents:5900,currency:'BRL',saleType:'monthly',buyerBinding:ticket,idempotencyKey:'delivery-1'};
  assert.equal((await billingConnectorRoute(await signed(payload,at,{secret:'WRONG'}),db,env,at)).status,401);
  assert.equal((await billingConnectorRoute(await signed(payload,at-400000),db,env,at)).status,401);
  const altered={...payload,amountCents:1,idempotencyKey:'delivery-cheap'};
  assert.equal((await billingConnectorRoute(await signed(altered),db,env,at)).status,409);
  const other={...payload,email:'outsider@example.test',idempotencyKey:'delivery-other'};
  assert.equal((await billingConnectorRoute(await signed(other),db,env,at)).status,409);
  const ok=await billingConnectorRoute(await signed(payload),db,env,at);
  assert.equal(ok.status,200,await ok.clone().text());
  assert.equal((await billingConnectorRoute(await signed(payload),db,env,at)).status,200);
  let row=await db.prepare('SELECT * FROM saas_subscriptions WHERE tenant_id=?').bind('company').first();
  assert.equal(row.status,'ACTIVE');assert.equal(row.plan_key,'monthly');assert.match(row.updated_by,/^BILLING:pay-order$/);
  const repeated={...payload,event:'artisys.license.renew',idempotencyKey:'delivery-renew'};
  assert.equal((await billingConnectorRoute(await signed(repeated),db,env,at)).status,200);
  row=await db.prepare('SELECT * FROM saas_subscriptions WHERE tenant_id=?').bind('company').first();
  const end=row.ends_at;
  assert.equal((await billingConnectorRoute(await signed(repeated),db,env,at)).status,200);
  assert.equal((await db.prepare('SELECT ends_at FROM saas_subscriptions WHERE tenant_id=?').bind('company').first()).ends_at,end);
  const revoke={...payload,event:'artisys.license.revoke',idempotencyKey:'delivery-revoke'};
  assert.equal((await billingConnectorRoute(await signed(revoke),db,env,at)).status,200);
  assert.equal((await db.prepare('SELECT status FROM saas_subscriptions WHERE tenant_id=?').bind('company').first()).status,'SUSPENDED');
 }finally{db.close();}
});
test('billing checkout remains optional and cashier cannot initiate it',async()=>{
 const db=await setup();
 try{
  const path='billing/checkout',req=new Request(origin+'/api/v1/tenants/company/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({period:'monthly',couponCode:'PROMO',idempotencyKey:'requested-idempotency-123456'})});
  const member={profileKey:'OWNER'},session={userId:'owner'};
  assert.equal((await billingCustomerRoute(req.clone(),db,{},session,member,'company',path,at)).status,503);
  assert.equal((await billingCustomerRoute(req.clone(),db,{ARTISYS_BILLING_ENABLED:'true'},session,{profileKey:'CASHIER'},'company',path,at)).status,403);
 }finally{db.close();}
});
