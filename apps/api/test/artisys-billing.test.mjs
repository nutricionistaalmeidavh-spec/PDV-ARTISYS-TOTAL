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

test('orders read authoritative central status, remain tenant-scoped, and never activate a trial',async()=>{
 const db=await setup(),env={ARTISYS_BILLING_ENABLED:'true',ARTISYS_BILLING_SECRET:secret};
 try{
  const stamp=new Date(at).toISOString();
  await db.prepare("INSERT INTO saas_subscriptions(tenant_id,plan_key,status,ends_at,updated_at,updated_by) VALUES(?,'trial','TRIAL',?,?,'PUBLIC_SIGNUP')")
   .bind('company','2026-11-02T12:00:00.000Z',stamp).run();
  await db.prepare('INSERT INTO saas_billing_orders VALUES(?,?,?,?,?,?,?,?,?)')
   .bind('test-order','company','owner','monthly','monthly',8900,'https://asaas.com/checkoutSession/show?id=test','unique-idempotency-key',stamp).run();
  const request=new Request(origin+'/api/v1/tenants/company/billing/orders');
  const run=fetchImpl=>billingCustomerRoute(request,db,env,{userId:'owner'},{profileKey:'OWNER'},'company','billing/orders',at,{fetchImpl});
  for(const status of ['pending','paid','expired','canceled','refunded']){
   const response=await run(async(url,options)=>{
    assert.match(url,/\/v1\/integrations\/pdv\/billing-status$/);
    assert.equal(options.redirect,'manual');
    assert.deepEqual(JSON.parse(options.body),{tenantId:'company',orders:[{orderId:'test-order',userId:'owner'}]});
    assert.equal(options.headers['x-artisys-signature'],'sha256='+await signHex(secret,String(at)+'.'+'/v1/integrations/pdv/billing-status'+'.'+options.body));
    return Response.json({orders:[{orderId:'test-order',status}],checkedAt:stamp});
   });
   const data=await response.json();assert.equal(data.orders[0].status,status);
   assert.equal(Object.hasOwn(data.orders[0],'userId'),false);
   assert.equal((await db.prepare('SELECT status FROM saas_subscriptions').bind().first()).status,'TRIAL');
  }
  for(const failure of [async()=>{throw Error('offline');},async()=>new Response(null,{status:401}),async()=>Response.json({orders:[{orderId:'test-order',status:'unknown'}]})]){
   const data=await (await run(failure)).json();assert.equal(data.orders[0].status,'unavailable');
  }
  const other=await billingCustomerRoute(request,db,env,{userId:'owner'},{profileKey:'OWNER'},'other-company','billing/orders',at,{fetchImpl:()=>{throw Error('must not fetch');}});
  assert.deepEqual((await other.json()).orders,[]);
  assert.equal((await billingCustomerRoute(request,db,env,{userId:'owner'},{profileKey:'CASHIER'},'company','billing/orders',at)).status,403);
 }finally{db.close();}
});

test('successful checkout creates a purchase but leaves existing trial unchanged',async()=>{
 const db=await setup(),env={ARTISYS_BILLING_ENABLED:'true',ARTISYS_BILLING_SECRET:secret,ARTISYS_PDV_MONTHLY_OFFER_ID:'monthly-offer'};
 try{
  const stamp=new Date(at).toISOString(),ends='2026-11-02T12:00:00.000Z';
  await db.prepare("INSERT INTO saas_subscriptions(tenant_id,plan_key,status,ends_at,updated_at,updated_by) VALUES(?,'trial','TRIAL',?,?,'PUBLIC_SIGNUP')").bind('company',ends,stamp).run();
  const calls=[],fetchImpl=async(url)=>{
   calls.push(url);
   if(url.endsWith('/v1/catalog'))return Response.json({offers:[{id:'monthly-offer',productId:'pdv-total-saas',saleType:'monthly',deliveryMode:'webhook',priceCents:8900,name:'Mensal'}]});
   if(url.endsWith('/v1/orders'))return Response.json({order:{id:'12345678-1234-4234-8234-123456789012',amountCents:8900},orderAccessToken:'private-access-token'});
   return Response.json({checkoutUrl:'https://asaas.com/checkoutSession/show?id=123456'});
  };
  const request=new Request(origin+'/api/v1/tenants/company/billing/checkout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({period:'monthly',idempotencyKey:'checkout-test-idempotency'})});
  assert.equal((await billingCustomerRoute(request,db,env,{userId:'owner'},{profileKey:'OWNER'},'company','billing/checkout',at,{fetchImpl})).status,201);
  const sub=await db.prepare('SELECT status,ends_at FROM saas_subscriptions').bind().first();
  assert.equal(sub.status,'TRIAL');assert.equal(sub.ends_at,ends);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM saas_billing_orders').bind().first()).n,1);
  assert.equal(calls.length,3);
 }finally{db.close();}
});
