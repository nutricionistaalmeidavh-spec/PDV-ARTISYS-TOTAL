import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createApi} from '../src/worker.mjs';
import {hashPassword} from '../src/password.mjs';

const origin='https://pdvtotal.test';
async function setup(){
  const db=openLocalDatabase();
  for(const file of ['0001_identity.sql','0002_commerce.sql','0003_cash_finance.sql','0004_advanced_finance.sql','0005_vertical_parity.sql','0006_desktop_parity.sql','0007_stock_transfers.sql','0008_transaction_reversals.sql','0009_catalog_inventory.sql','0010_purchase_orders.sql','0011_product_media.sql','0012_sale_item_notes.sql','0013_cash_terminals.sql','0014_checkout_configurations.sql','0015_seller_sales_targets.sql','0016_inventory_lot_receipts.sql','0017_inventory_minimum_levels.sql','0018_inventory_lot_balances.sql'])
    db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  const stamp='2026-10-17T12:00:00.000Z';
  const h=await hashPassword('Senha-de-teste-123!');
  for(const [tenant,user] of [['a','a-user'],['b','b-user']]){
    await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind(tenant,'loja-'+tenant,tenant,stamp).run();
    await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)').bind('filial-'+tenant,tenant,'MAIN','Matriz',stamp).run();
    await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').bind(user,user+'@example.com',user,h,stamp).run();
    await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)').bind(tenant,user,'OWNER',stamp).run();
  }
  const api=createApi({DB:db},{now:()=>Date.parse(stamp)});
  const cookies={};
  async function request(tenant,path,method='GET',body=undefined,{key=crypto.randomUUID(),as='a',originHeader=true}={}){
    const headers={};
    if(!cookies[as]){
      const login=await api.fetch(new Request(origin+'/api/v1/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:as+'-user@example.com',password:'Senha-de-teste-123!'})}));
      assert.equal(login.status,200);cookies[as]=login.headers.get('set-cookie').split(';')[0];
    }
    headers.cookie=cookies[as];
    if(!['GET','HEAD'].includes(method)){
      headers['content-type']='application/json';
      headers['x-mutation-id']=key;
      if(originHeader)headers.origin=origin;
    }
    const url=origin+'/api/v1/tenants/'+tenant+'/'+path;
    const response=await api.fetch(new Request(url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}));
    return {status:response.status,body:await response.json()};
  }
  return {db,request,close:()=>db.close()};
}

test('P7 contacts: idempotent tenant-scoped customers and suppliers',async()=>{
 const x=await setup();try{
   const key=crypto.randomUUID();
   const first=await x.request('a','customers','POST',{branchId:'filial-a',name:'Cliente A',document:'1234',creditLimitCents:5000},{key});
   assert.equal(first.status,201,JSON.stringify(first.body));
   const again=await x.request('a','customers','POST',{branchId:'filial-a',name:'Cliente A',document:'1234',creditLimitCents:5000},{key});
   assert.equal(again.status,201);assert.equal(again.body.customer.id,first.body.customer.id);
   assert.equal((await x.request('b','customers?branchId=filial-b','GET',undefined,{as:'b'})).body.customers.length,0);
   assert.equal((await x.request('b','customers?branchId=filial-b','GET',undefined,{as:'a'})).status,404);
   const supplier=await x.request('a','suppliers','POST',{branchId:'filial-a',name:'Fornecedor A',document:'9876'});
   assert.equal(supplier.status,201,JSON.stringify(supplier.body));
   assert.equal((await x.request('a','suppliers?branchId=filial-a')).body.suppliers.length,1);
 }finally{x.close();}
});

test('P7 restaurant: table reservation is singular, order creates one kitchen ticket',async()=>{
 const x=await setup();try{
   const table=await x.request('a','restaurant/tables','POST',{branchId:'filial-a',label:'Mesa 01',seats:4});
   assert.equal(table.status,201,JSON.stringify(table.body));
   const id=table.body.table.id;
   const session=await x.request('a',`restaurant/tables/${id}/open`,'POST',{branchId:'filial-a',partySize:3});
   assert.equal(session.status,201,JSON.stringify(session.body));
   assert.equal((await x.request('a',`restaurant/tables/${id}/open`,'POST',{branchId:'filial-a',partySize:3})).status,409);
   const product=await x.request('a','products','POST',{branchId:'filial-a',sku:'PIZZA',name:'Pizza',salePriceCents:2500});
   assert.equal(product.status,201,JSON.stringify(product.body));
   const key=crypto.randomUUID();
   const order=await x.request('a','restaurant/orders','POST',{branchId:'filial-a',tableSessionId:session.body.session.id,items:[{productId:product.body.product.id,quantity:2}]},{key});
   assert.equal(order.status,201,JSON.stringify(order.body));
   const again=await x.request('a','restaurant/orders','POST',{branchId:'filial-a',tableSessionId:session.body.session.id,items:[{productId:product.body.product.id,quantity:2}]},{key});
   assert.equal(again.body.order.id,order.body.order.id);
   const kitchen=await x.request('a','restaurant/kitchen?branchId=filial-a');
   assert.equal(kitchen.status,200);assert.equal(kitchen.body.tickets.length,1);
 }finally{x.close();}
});

test('P7 wholesale: quantity tier quote keeps immutable price snapshot and branch isolation',async()=>{
 const x=await setup();try{
   const product=await x.request('a','products','POST',{branchId:'filial-a',sku:'CX1',name:'Caixa',salePriceCents:3000});
   const pid=product.body.product.id;
   const client=await x.request('a','customers','POST',{branchId:'filial-a',name:'Atacadista'});
   const tier=await x.request('a','wholesale/tiers','POST',{branchId:'filial-a',productId:pid,minQuantity:5,unitPriceCents:2000});
   assert.equal(tier.status,201,JSON.stringify(tier.body));
   const quote=await x.request('a','wholesale/orders','POST',{branchId:'filial-a',customerId:client.body.customer.id,items:[{productId:pid,quantity:5}]});
   assert.equal(quote.status,201,JSON.stringify(quote.body));
   assert.equal(quote.body.order.totalCents,10000);
   assert.equal(quote.body.order.items[0].unitPriceCents,2000);
   assert.equal((await x.request('b','wholesale/orders?branchId=filial-b','GET',undefined,{as:'b'})).body.orders.length,0);
 }finally{x.close();}
});

test('P7 crediário and commissions are posted once in canonical sale completion, not as duplicate cash',async()=>{
 const x=await setup();try{
   const c=(await x.request('a','customers','POST',{branchId:'filial-a',name:'Cliente Crédito',creditLimitCents:5000})).body.customer;
   const product=(await x.request('a','products','POST',{branchId:'filial-a',sku:'TESTECRED',name:'Kit',salePriceCents:3000,trackStock:false})).body.product;
   const rule=await x.request('a','commissions/rules','POST',{branchId:'filial-a',sellerId:'a-user',commissionBps:1000});
   assert.equal(rule.status,201,JSON.stringify(rule.body));
   const cash=await x.request('a','cash/open','POST',{branchId:'filial-a',openingCents:1000});
   assert.equal(cash.status,201,JSON.stringify(cash.body));
   const sale=(await x.request('a','sales','POST',{branchId:'filial-a',sellerId:'a-user'})).body.sale;
   assert.equal((await x.request('a',`sales/${sale.id}/customer`,'POST',{branchId:'filial-a',customerId:c.id})).status,200);
   assert.equal((await x.request('a',`sales/${sale.id}/items`,'POST',{branchId:'filial-a',productId:product.id,quantity:1})).status,200);
   const paymentKey=crypto.randomUUID();
   const pay=await x.request('a',`sales/${sale.id}/complete`,'POST',{branchId:'filial-a',payments:[{method:'STORE_CREDIT',amountCents:3000}]},{key:paymentKey});
   assert.equal(pay.status,200,JSON.stringify(pay.body));
   assert.equal((await x.request('a',`sales/${sale.id}/complete`,'POST',{branchId:'filial-a',payments:[{method:'STORE_CREDIT',amountCents:3000}]},{key:paymentKey})).status,200);
   const credit=await x.request('a',`credit/${c.id}?branchId=filial-a`);
   assert.equal(credit.body.credit.balanceCents,3000);
   const ledger=await x.db.prepare('SELECT COUNT(*) AS n FROM seller_commission_ledger WHERE tenant_id=?').bind('a').first();
   assert.equal(ledger.n,1);
   const drawer=await x.db.prepare('SELECT COUNT(*) AS n FROM cash_movements WHERE sale_id=?').bind(sale.id).first();
   assert.equal(drawer.n,0,'sale paid by credit must never be a cash movement');
   const second=(await x.request('a','sales','POST',{branchId:'filial-a'})).body.sale;
   await x.request('a',`sales/${second.id}/customer`,'POST',{branchId:'filial-a',customerId:c.id});
   await x.request('a',`sales/${second.id}/items`,'POST',{branchId:'filial-a',productId:product.id,quantity:1});
   assert.equal((await x.request('a',`sales/${second.id}/complete`,'POST',{branchId:'filial-a',payments:[{method:'STORE_CREDIT',amountCents:3000}]})).status,409);
 }finally{x.close();}
});

test('P7 credit repayment reduces receivable and counts cash exactly once',async()=>{
 const x=await setup();try{
   const c=(await x.request('a','customers','POST',{branchId:'filial-a',name:'Cliente C',creditLimitCents:10000})).body.customer;
   const p=(await x.request('a','products','POST',{branchId:'filial-a',sku:'RECEIVE1',name:'Produto pago depois',salePriceCents:4000,trackStock:false})).body.product;
   await x.request('a','cash/open','POST',{branchId:'filial-a',openingCents:1000});
   const sale=(await x.request('a','sales','POST',{branchId:'filial-a'})).body.sale;
   await x.request('a',`sales/${sale.id}/customer`,'POST',{branchId:'filial-a',customerId:c.id});
   await x.request('a',`sales/${sale.id}/items`,'POST',{branchId:'filial-a',productId:p.id,quantity:1});
   assert.equal((await x.request('a',`sales/${sale.id}/complete`,'POST',{branchId:'filial-a',payments:[{method:'STORE_CREDIT',amountCents:4000}]})).status,200);
   const key=crypto.randomUUID();
   const first=await x.request('a',`credit/${c.id}/payments`,'POST',{branchId:'filial-a',amountCents:1500,method:'CASH'},{key});
   assert.equal(first.status,201,JSON.stringify(first.body));
   const retry=await x.request('a',`credit/${c.id}/payments`,'POST',{branchId:'filial-a',amountCents:1500,method:'CASH'},{key});
   assert.equal(retry.body.receipt.id,first.body.receipt.id);
   const summary=await x.request('a',`credit/${c.id}?branchId=filial-a`);
   assert.equal(summary.body.credit.balanceCents,2500);
   assert.equal((await x.request('a',`credit/${c.id}/payments`,'POST',{branchId:'filial-a',amountCents:5000,method:'CASH'})).status,409);
   const cash=await x.request('a','cash?branchId=filial-a');
   assert.equal(cash.status,200,JSON.stringify(cash.body));
   const receiptCount=await x.db.prepare('SELECT count(*) AS n FROM customer_credit_receipts WHERE tenant_id=?').bind('a').first();
   assert.equal(receiptCount.n,1);
   const view=await x.request('a','cash/sessions?branchId=filial-a');
   assert.equal(view.status,200);
 }finally{x.close();}
});

test('P7 restaurant: kitchen must be ready before delivery and table closure',async()=>{
 const x=await setup();try{
   const t=(await x.request('a','restaurant/tables','POST',{branchId:'filial-a',label:'Mesa 12',seats:4})).body.table;
   const session=(await x.request('a',`restaurant/tables/${t.id}/open`,'POST',{branchId:'filial-a'})).body.session;
   const p=(await x.request('a','products','POST',{branchId:'filial-a',sku:'FOOD1',name:'Bebida',salePriceCents:500,trackStock:false})).body.product;
   const order=(await x.request('a','restaurant/orders','POST',{branchId:'filial-a',tableSessionId:session.id,items:[{productId:p.id,quantity:1}]})).body.order;
   assert.equal((await x.request('a',`restaurant/sessions/${session.id}/close`,'POST',{branchId:'filial-a'})).status,409);
   assert.equal((await x.request('a',`restaurant/orders/${order.id}/deliver`,'POST',{branchId:'filial-a'})).status,409);
   const tickets=(await x.request('a','restaurant/kitchen?branchId=filial-a')).body.tickets;
   const tid=tickets[0].id;
   assert.equal((await x.request('a',`restaurant/kitchen/${tid}`,'PATCH',{branchId:'filial-a',status:'PREPARING'})).status,200);
   assert.equal((await x.request('a',`restaurant/kitchen/${tid}`,'PATCH',{branchId:'filial-a',status:'READY'})).status,200);
   assert.equal((await x.request('a',`restaurant/orders/${order.id}/deliver`,'POST',{branchId:'filial-a'})).status,200);
   assert.equal((await x.request('a',`restaurant/sessions/${session.id}/close`,'POST',{branchId:'filial-a'})).status,200);
 }finally{x.close();}
});

test('P7 quote confirmation converts at the quoted price into one canonical sale',async()=>{
 const x=await setup();try{
   const product=(await x.request('a','products','POST',{branchId:'filial-a',sku:'PRECO1',name:'Produto do Atacado',salePriceCents:4000,trackStock:false})).body.product;
   const customer=(await x.request('a','customers','POST',{branchId:'filial-a',name:'Revendedor'})).body.customer;
   assert.equal((await x.request('a','wholesale/tiers','POST',{branchId:'filial-a',productId:product.id,minQuantity:5,unitPriceCents:2500})).status,201);
   const quote=(await x.request('a','wholesale/orders','POST',{branchId:'filial-a',customerId:customer.id,items:[{productId:product.id,quantity:5}]})).body.order;
   assert.equal(quote.totalCents,12500);
   assert.equal((await x.request('a',`wholesale/orders/${quote.id}/confirm`,'POST',{branchId:'filial-a'})).status,200);
   const first=await x.request('a','sales','POST',{branchId:'filial-a',wholesaleOrderId:quote.id});
   assert.equal(first.status,201,JSON.stringify(first.body));
   const sid=first.body.sale.id;
   const sale=await x.request('a',`sales/${sid}?branchId=filial-a`);
   assert.equal(sale.body.sale.totalCents,12500);
   assert.equal(sale.body.sale.items[0].unitPriceCents,2500);
   assert.equal(sale.body.sale.customerId,customer.id);
   assert.equal((await x.request('a','sales','POST',{branchId:'filial-a',wholesaleOrderId:quote.id})).status,409);
   await x.request('a','cash/open','POST',{branchId:'filial-a',openingCents:1000});
   const done=await x.request('a',`sales/${sid}/complete`,'POST',{branchId:'filial-a',payments:[{method:'PIX',amountCents:12500}]});
   assert.equal(done.status,200,JSON.stringify(done.body));
   const updated=await x.request('a',`wholesale/orders/${quote.id}?branchId=filial-a`);
   assert.equal(updated.body.order.status,'FULFILLED');
   assert.equal(updated.body.order.saleId,sid);
   assert.equal((await x.db.prepare('SELECT count(*) AS n FROM sales WHERE tenant_id=? AND branch_id=?').bind('a','filial-a').first()).n,1);
 }finally{x.close();}
});
