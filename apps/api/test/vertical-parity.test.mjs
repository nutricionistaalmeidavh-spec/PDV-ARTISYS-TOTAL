import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createApi} from '../src/worker.mjs';
import {hashPassword} from '../src/password.mjs';

const origin='https://pdvtotal.test';
async function setup(){
  const db=openLocalDatabase();
  for(const file of ['0001_identity.sql','0002_commerce.sql','0003_cash_finance.sql','0004_advanced_finance.sql','0005_vertical_parity.sql','0006_desktop_parity.sql','0007_stock_transfers.sql','0008_transaction_reversals.sql','0009_catalog_inventory.sql','0010_purchase_orders.sql','0011_product_media.sql','0012_sale_item_notes.sql','0013_cash_terminals.sql','0014_checkout_configurations.sql','0015_seller_sales_targets.sql','0016_inventory_lot_receipts.sql','0017_inventory_minimum_levels.sql','0018_inventory_lot_balances.sql','0020_sale_configured_lines.sql','0021_r4_restaurant_operations.sql','0022_r4_restaurant_checkout.sql','0023_r4_extended_verticals.sql'])
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
    return {status:response.status,body:response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text()};
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
   assert.equal((await x.request('a',`restaurant/sessions/${session.id}/close`,'POST',{branchId:'filial-a'})).status,409);
   const sale=await x.request('a','sales','POST',{branchId:'filial-a',restaurantSessionId:session.id});
   assert.equal(sale.status,201,JSON.stringify(sale.body));
   assert.equal(sale.body.sale.totalCents,500);
   assert.equal((await x.request('a','sales','POST',{branchId:'filial-a',restaurantSessionId:session.id})).status,409);
   assert.equal((await x.request('a',`sales/${sale.body.sale.id}/items`,'POST',{branchId:'filial-a',productId:p.id,quantity:1})).status,409);
   assert.equal((await x.request('a',`restaurant/sessions/${session.id}/close`,'POST',{branchId:'filial-a'})).status,409);
   assert.equal((await x.request('a','cash/open','POST',{branchId:'filial-a',openingCents:1000})).status,201);
   assert.equal((await x.request('a',`sales/${sale.body.sale.id}/complete`,'POST',{branchId:'filial-a',payments:[{method:'PIX',amountCents:500}]})).status,200);
   assert.equal((await x.request('a',`restaurant/sessions/${session.id}/close`,'POST',{branchId:'filial-a'})).status,200);
   assert.equal((await x.db.prepare('SELECT count(*) AS n FROM sales WHERE tenant_id=?').bind('a').first()).n,1);
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

test('R4 cap-031: transferir mesa preserva comanda, pedidos e exige mesa de destino livre',async()=>{
 const x=await setup();try{
   const source=(await x.request('a','restaurant/tables','POST',{branchId:'filial-a',label:'Mesa origem'})).body.table;
   const target=(await x.request('a','restaurant/tables','POST',{branchId:'filial-a',label:'Mesa destino'})).body.table;
   const occupied=(await x.request('a','restaurant/tables','POST',{branchId:'filial-a',label:'Ocupada'})).body.table;
   const session=(await x.request('a',`restaurant/tables/${source.id}/open`,'POST',{branchId:'filial-a'})).body.session;
   await x.request('a',`restaurant/tables/${occupied.id}/open`,'POST',{branchId:'filial-a'});
   const product=(await x.request('a','products','POST',{branchId:'filial-a',sku:'R4MESA',name:'Lanche',salePriceCents:500,trackStock:false})).body.product;
   const order=(await x.request('a','restaurant/orders','POST',{branchId:'filial-a',tableSessionId:session.id,items:[{productId:product.id,quantity:2}]})).body.order;
   assert.equal((await x.request('a',`restaurant/sessions/${session.id}/transfer`,'POST',{branchId:'filial-a',targetTableId:occupied.id})).status,409);
   const key=crypto.randomUUID();
   const moved=await x.request('a',`restaurant/sessions/${session.id}/transfer`,'POST',{branchId:'filial-a',targetTableId:target.id},{key});
   assert.equal(moved.status,200,JSON.stringify(moved.body));
   assert.equal(moved.body.session.tableId,target.id);
   const replay=await x.request('a',`restaurant/sessions/${session.id}/transfer`,'POST',{branchId:'filial-a',targetTableId:target.id},{key});
   assert.deepEqual(replay.body,moved.body);
   const existing=await x.request('a',`restaurant/sessions/${session.id}?branchId=filial-a`);
   assert.equal(existing.body.session.table_id,target.id);
   const orders=(await x.request('a','restaurant/orders?branchId=filial-a')).body.orders;
   assert.equal(orders.filter(o=>o.id===order.id&&o.table_session_id===session.id).length,1);
   assert.equal((await x.request('b',`restaurant/sessions/${session.id}/transfer`,'POST',{branchId:'filial-b',targetTableId:target.id},{as:'b'})).status,404);
 }finally{x.close();}
});

test('R4 cap-048: chamado garçom/conta é isolado, idempotente e tem transições autorizadas',async()=>{
 const x=await setup();try{
   const table=(await x.request('a','restaurant/tables','POST',{branchId:'filial-a',label:'Chamado'})).body.table;
   const session=(await x.request('a',`restaurant/tables/${table.id}/open`,'POST',{branchId:'filial-a'})).body.session;
   const key=crypto.randomUUID();
   const request=await x.request('a',`restaurant/sessions/${session.id}/requests`,'POST',{branchId:'filial-a',type:'BILL',note:'Pode trazer a conta?'},{key});
   assert.equal(request.status,201,JSON.stringify(request.body));
   assert.equal((await x.request('a',`restaurant/sessions/${session.id}/requests`,'POST',{branchId:'filial-a',type:'BILL',note:'Pode trazer a conta?'},{key})).body.request.id,request.body.request.id);
   assert.equal((await x.request('b','restaurant/requests?branchId=filial-b','GET',undefined,{as:'b'})).body.requests.length,0);
   const rid=request.body.request.id;
   assert.equal((await x.request('a',`restaurant/requests/${rid}`,'PATCH',{branchId:'filial-a',status:'CLOSED'})).status,409);
   assert.equal((await x.request('a',`restaurant/requests/${rid}`,'PATCH',{branchId:'filial-a',status:'ACKNOWLEDGED'})).status,200);
   assert.equal((await x.request('a',`restaurant/requests/${rid}`,'PATCH',{branchId:'filial-a',status:'CLOSED'})).status,200);
   assert.equal((await x.request('a',`restaurant/requests/${rid}`,'PATCH',{branchId:'filial-a',status:'ACKNOWLEDGED'})).status,409);
   await x.db.prepare("UPDATE tenant_memberships SET profile_key='KITCHEN' WHERE tenant_id='a' AND user_id='a-user'").bind().run();
   assert.equal((await x.request('a','restaurant/requests?branchId=filial-a')).status,403);
 }finally{x.close();}
});

test('R4 cap-038 e cap-049: cancelamento antes do KDS, relatório separado de vendas e CSV isolado',async()=>{
 const x=await setup();try{
   const product=(await x.request('a','products','POST',{branchId:'filial-a',sku:'R4-REL',name:'Prato',salePriceCents:1700,trackStock:false})).body.product;
   const first=(await x.request('a','restaurant/orders','POST',{branchId:'filial-a',fulfillment:'PICKUP',items:[{productId:product.id,quantity:2}]})).body.order;
   const second=(await x.request('a','restaurant/orders','POST',{branchId:'filial-a',fulfillment:'DELIVERY',address:'Rua A, 10',items:[{productId:product.id,quantity:1}]})).body.order;
   const cancelled=await x.request('a',`restaurant/orders/${first.id}/cancel`,'POST',{branchId:'filial-a',reason:'Cliente desistiu'});
   assert.equal(cancelled.status,200,JSON.stringify(cancelled.body));
   assert.equal((await x.request('a',`restaurant/orders/${first.id}/deliver`,'POST',{branchId:'filial-a'})).status,409);
   const tickets=(await x.request('a','restaurant/kitchen?branchId=filial-a')).body.tickets;
   assert.equal(tickets.some(k=>k.orderId===first.id),false);
   const other=tickets.find(k=>k.orderId===second.id);
   assert.equal((await x.request('a',`restaurant/kitchen/${other.id}`,'PATCH',{branchId:'filial-a',status:'PREPARING'})).status,200);
   assert.equal((await x.request('a',`restaurant/orders/${second.id}/cancel`,'POST',{branchId:'filial-a'})).status,409);
   const report=await x.request('a','restaurant/reports/summary?branchId=filial-a&from=2026-01-01&to=2026-12-31');
   assert.equal(report.status,200,JSON.stringify(report.body));
   assert.equal(report.body.report.ordersCount,2);
   assert.equal(report.body.report.cancelledCount,1);
   assert.equal(report.body.report.orderedCents,1700);
   assert.equal((await x.request('b','restaurant/reports/summary?branchId=filial-b&from=2026-01-01&to=2026-12-31','GET',undefined,{as:'b'})).body.report.ordersCount,0);
   const csv=await x.request('a','restaurant/reports/csv?branchId=filial-a&from=2026-01-01&to=2026-12-31');
   assert.equal(csv.status,200);assert.match(csv.body,/PICKUP/);assert.match(csv.body,/DELIVERY/);
   assert.equal((await x.request('a','restaurant/reports/summary?branchId=filial-a&from=sem-data&to=2026-12-31')).status,400);
   assert.equal((await x.db.prepare('SELECT count(*) AS n FROM sales WHERE tenant_id=?').bind('a').first()).n,0);
 }finally{x.close();}
});

test('R4 cap-033/cap-037: retirada vira exatamente uma venda com preços congelados e estoque só no checkout',async()=>{
 const x=await setup();try{
   const p=(await x.request('a','products','POST',{branchId:'filial-a',sku:'R4RET',name:'Retirada',salePriceCents:1750,trackStock:false})).body.product;
   const order=(await x.request('a','restaurant/orders','POST',{branchId:'filial-a',fulfillment:'PICKUP',items:[{productId:p.id,quantity:2}]})).body.order;
   const orderId=order.id;
   assert.equal((await x.request('a','sales','POST',{branchId:'filial-a',restaurantOrderId:orderId})).status,409);
   const k=(await x.request('a','restaurant/kitchen?branchId=filial-a')).body.tickets[0].id;
   assert.equal((await x.request('a',`restaurant/kitchen/${k}`,'PATCH',{branchId:'filial-a',status:'PREPARING'})).status,200);
   assert.equal((await x.request('a',`restaurant/kitchen/${k}`,'PATCH',{branchId:'filial-a',status:'READY'})).status,200);
   assert.equal((await x.request('a',`restaurant/orders/${orderId}/deliver`,'POST',{branchId:'filial-a'})).status,200);
   const sale=await x.request('a','sales','POST',{branchId:'filial-a',restaurantOrderId:orderId});
   assert.equal(sale.status,201,JSON.stringify(sale.body));
   assert.equal(sale.body.sale.totalCents,3500);
   assert.equal((await x.request('a','sales','POST',{branchId:'filial-a',restaurantOrderId:orderId})).status,409);
   await x.request('a','cash/open','POST',{branchId:'filial-a',openingCents:0});
   assert.equal((await x.request('a',`sales/${sale.body.sale.id}/complete`,'POST',{branchId:'filial-a',payments:[{method:'PIX',amountCents:3500}]})).status,200);
   const money=(await x.request('a','cash?branchId=filial-a')).body;
   assert.equal((await x.db.prepare('SELECT count(*) AS n FROM cash_movements WHERE tenant_id=?').bind('a').first()).n,1);
   assert.equal((await x.db.prepare('SELECT count(*) AS n FROM sales WHERE tenant_id=?').bind('a').first()).n,1);
   assert.equal((await x.db.prepare('SELECT count(*) AS n FROM restaurant_sale_links WHERE tenant_id=?').bind('a').first()).n,1);
 }finally{x.close();}
});

test('R4 cap-034/035: KDS routes independently to production stations; one order remains canonical',async()=>{
 const x=await setup();try{
   const p=(await x.request('a','products','POST',{branchId:'filial-a',name:'Prato KDS',sku:'R4KDS',salePriceCents:2600,trackStock:false})).body.product;
   const station=await x.request('a','restaurant/kitchen/stations','POST',{branchId:'filial-a',name:'Grelha',printerName:'cozinha-1',printEnabled:false});
   assert.equal(station.status,201,JSON.stringify(station.body));
   const sid=station.body.station.id;
   const route=await x.request('a','restaurant/kitchen/routes','POST',{branchId:'filial-a',productId:p.id,mode:'PRODUCTION',stationId:sid});
   assert.equal(route.status,201,JSON.stringify(route.body));
   const order=(await x.request('a','restaurant/orders','POST',{branchId:'filial-a',fulfillment:'PICKUP',items:[{productId:p.id,quantity:2}]})).body.order;
   const tickets=(await x.request('a','restaurant/kitchen/station-tickets?branchId=filial-a')).body.tickets;
   assert.equal(tickets.length,1);assert.equal(tickets[0].stationId,sid);assert.equal(tickets[0].orderId,order.id);
   assert.equal((await x.request('a',`restaurant/orders/${order.id}/deliver`,'POST',{branchId:'filial-a'})).status,409);
   const ticket=tickets[0].id;
   assert.equal((await x.request('a',`restaurant/kitchen/station-tickets/${ticket}`,'PATCH',{branchId:'filial-a',status:'READY'})).status,409);
   assert.equal((await x.request('a',`restaurant/kitchen/station-tickets/${ticket}`,'PATCH',{branchId:'filial-a',status:'PREPARING'})).status,200);
   assert.equal((await x.request('a',`restaurant/kitchen/station-tickets/${ticket}`,'PATCH',{branchId:'filial-a',status:'READY'})).status,200);
   assert.equal((await x.request('a',`restaurant/orders/${order.id}/deliver`,'POST',{branchId:'filial-a'})).status,200);
   assert.equal((await x.request('b','restaurant/kitchen/station-tickets?branchId=filial-b','GET',undefined,{as:'b'})).body.tickets.length,0);
 }finally{x.close();}
});

test('R4 cap-036: pizza profiles and flavor pricing are tenant-isolated and integer cents',async()=>{
 const x=await setup();try{
   const p=(await x.request('a','products','POST',{branchId:'filial-a',name:'Pizza',sku:'R4PIZZA',salePriceCents:2000,trackStock:false})).body.product;
   const profile=await x.request('a','restaurant/pizzeria/profiles','POST',{branchId:'filial-a',productId:p.id,policy:'HIGHEST_FLAVOR',
     sizes:[{code:'M',name:'Média',priceCents:3000}],
     flavors:[{code:'MARG',name:'Marguerita',priceCents:3600},{code:'CAL',name:'Calabresa',priceCents:4200}],
     crusts:[{code:'CAT',name:'Catupiry',priceCents:600}]});
   assert.equal(profile.status,201,JSON.stringify(profile.body));
   const quote=await x.request('a','restaurant/pizzeria/quote','POST',{branchId:'filial-a',productId:p.id,sizeCode:'M',flavorCodes:['MARG','CAL'],crustCode:'CAT'});
   assert.equal(quote.status,200,JSON.stringify(quote.body));
   assert.equal(quote.body.quote.unitPriceCents,4800);
   assert.equal((await x.request('a','restaurant/pizzeria/quote','POST',{branchId:'filial-a',productId:p.id,sizeCode:'M',flavorCodes:['MARG','MARG']})).status,400);
   const avg=await x.request('a','restaurant/pizzeria/profiles','POST',{branchId:'filial-a',productId:p.id,policy:'PROPORTIONAL_AVERAGE',
     sizes:[{code:'M',name:'Média',priceCents:3000}],
     flavors:[{code:'MARG',name:'Marguerita',priceCents:3600},{code:'CAL',name:'Calabresa',priceCents:4200}],crusts:[]});
   assert.equal(avg.status,201,JSON.stringify(avg.body));
   assert.equal((await x.request('a','restaurant/pizzeria/quote','POST',{branchId:'filial-a',productId:p.id,sizeCode:'M',flavorCodes:['MARG','CAL']})).body.quote.unitPriceCents,3900);
   assert.equal((await x.request('b','restaurant/pizzeria/profiles?branchId=filial-b','GET',undefined,{as:'b'})).body.profiles.length,0);
 }finally{x.close();}
});

test('R4 cap-039/041: peso in grams priced safely and segment recommendations do not create duplicate sales',async()=>{
 const x=await setup();try{
   const p=(await x.request('a','products','POST',{branchId:'filial-a',name:'Pão a peso',sku:'R4PESO',salePriceCents:2999,unit:'KG',trackStock:false})).body.product;
   const price=await x.request('a','restaurant/weight/quote','POST',{branchId:'filial-a',productId:p.id,grams:450});
   assert.equal(price.status,200,JSON.stringify(price.body));
   assert.equal(price.body.quote.totalCents,1350);
   assert.equal((await x.request('a','restaurant/weight/quote','POST',{branchId:'filial-a',productId:p.id,grams:-5})).status,400);
   const rec=await x.request('a','restaurant/segments?branchId=filial-a');
   assert.equal(rec.status,200,JSON.stringify(rec.body));
   assert.ok(rec.body.segments.some(s=>s.id==='RESTAURANT'));
   assert.equal((await x.db.prepare('SELECT count(*) AS n FROM sales WHERE tenant_id=?').bind('a').first()).n,0);
 }finally{x.close();}
});

test('R4 cap-009: recipe versioned consumption uses canonical inventory sale ledger once',async()=>{
 const x=await setup();try{
   const flour=(await x.request('a','products','POST',{branchId:'filial-a',name:'Farinha',sku:'R4-FLOUR',salePriceCents:100,unit:'KG',trackStock:true})).body.product;
   const bread=(await x.request('a','products','POST',{branchId:'filial-a',name:'Pão pronto',sku:'R4-BREAD',salePriceCents:1000,trackStock:false})).body.product;
   assert.equal((await x.request('a','inventory/receipts','POST',{branchId:'filial-a',productId:flour.id,quantity:2,type:'opening'})).status,201);
   const first=await x.request('a',`recipes/${bread.id}`,'PUT',{branchId:'filial-a',ingredients:[{ingredientId:flour.id,quantity:0.25}]});
   assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.recipe.version,1);
   const revised=await x.request('a',`recipes/${bread.id}`,'PUT',{branchId:'filial-a',ingredients:[{ingredientId:flour.id,quantity:0.3}]});
   assert.equal(revised.status,200);assert.equal(revised.body.recipe.version,2);
   const rev1=await x.db.prepare('SELECT quantity_milli AS q FROM r4_recipe_ingredients WHERE tenant_id=? AND product_id=? AND version=1').bind('a',bread.id).first();
   assert.equal(rev1.q,250);
   const sale=(await x.request('a','sales','POST',{branchId:'filial-a'})).body.sale;
   assert.equal((await x.request('a',`sales/${sale.id}/items`,'POST',{branchId:'filial-a',productId:bread.id,quantity:2})).status,200);
   await x.request('a','cash/open','POST',{branchId:'filial-a',openingCents:0});
   const result=await x.request('a',`sales/${sale.id}/complete`,'POST',{branchId:'filial-a',payments:[{method:'PIX',amountCents:2000}]});
   assert.equal(result.status,200,JSON.stringify(result.body));
   const movement=await x.db.prepare("SELECT delta_milli AS delta FROM inventory_movements WHERE tenant_id=? AND sale_id=? AND product_id=? AND type='sale'").bind('a',sale.id,flour.id).first();
   assert.equal(movement.delta,-600);
   assert.equal((await x.db.prepare("SELECT count(*) AS n FROM inventory_movements WHERE tenant_id=? AND sale_id=? AND type='sale'").bind('a',sale.id).first()).n,1);
   const snapshot=await x.db.prepare('SELECT version FROM r4_sale_recipe_versions WHERE tenant_id=? AND sale_id=? AND product_id=?').bind('a',sale.id,bread.id).first();
   assert.equal(snapshot.version,2);
 }finally{x.close();}
});

test('R4 cap-037/038: counter ticket daily sequence and delivery courier events use same order',async()=>{
 const x=await setup();try{
   const p=(await x.request('a','products','POST',{branchId:'filial-a',sku:'R4TICKET',name:'Salgado',salePriceCents:900,trackStock:false})).body.product;
   const key=crypto.randomUUID();
   const one=await x.request('a','restaurant/orders','POST',{branchId:'filial-a',fulfillment:'COUNTER',useTicket:true,items:[{productId:p.id,quantity:1}]},{key});
   assert.equal(one.status,201,JSON.stringify(one.body));
   assert.equal(one.body.order.ticketNumber,1);
   assert.equal(one.body.order.serviceChannel,'COUNTER');
   const replay=await x.request('a','restaurant/orders','POST',{branchId:'filial-a',fulfillment:'COUNTER',useTicket:true,items:[{productId:p.id,quantity:1}]},{key});
   assert.equal(replay.body.order.id,one.body.order.id);
   const two=await x.request('a','restaurant/orders','POST',{branchId:'filial-a',fulfillment:'PICKUP',useTicket:true,items:[{productId:p.id,quantity:1}]});
   assert.equal(two.body.order.ticketNumber,2);
   const delivery=await x.request('a','restaurant/orders','POST',{branchId:'filial-a',fulfillment:'DELIVERY',address:'Rua Alfa, 100',
       items:[{productId:p.id,quantity:1}]});
   assert.equal(delivery.status,201,JSON.stringify(delivery.body));
   const oid=delivery.body.order.id,global=(await x.request('a','restaurant/kitchen?branchId=filial-a')).body.tickets.find(x=>x.orderId===oid);
   assert.equal((await x.request('a',`restaurant/kitchen/${global.id}`,'PATCH',{branchId:'filial-a',status:'PREPARING'})).status,200);
   assert.equal((await x.request('a',`restaurant/kitchen/${global.id}`,'PATCH',{branchId:'filial-a',status:'READY'})).status,200);
   assert.equal((await x.request('a',`restaurant/orders/${oid}/deliver`,'POST',{branchId:'filial-a'})).status,409);
   assert.equal((await x.request('a',`restaurant/orders/${oid}/dispatch`,'POST',{branchId:'filial-a',courierName:'Entregador próprio'})).status,200);
   assert.equal((await x.request('a',`restaurant/orders/${oid}/deliver`,'POST',{branchId:'filial-a'})).status,200);
   assert.equal((await x.db.prepare('SELECT count(*) AS n FROM restaurant_orders WHERE tenant_id=?').bind('a').first()).n,3);
 }finally{x.close();}
});

test('R4 cap-032: partial item transfer preserves quantity and two canonical table settlements',async()=>{
 const x=await setup();try{
   const product=(await x.request('a','products','POST',{branchId:'filial-a',sku:'TRANSFER-ITEM',name:'Prato transferível',salePriceCents:1500,trackStock:false})).body.product;
   const ta=(await x.request('a','restaurant/tables','POST',{branchId:'filial-a',label:'Origem itens'})).body.table;
   const tb=(await x.request('a','restaurant/tables','POST',{branchId:'filial-a',label:'Destino itens'})).body.table;
   const a=(await x.request('a',`restaurant/tables/${ta.id}/open`,'POST',{branchId:'filial-a'})).body.session;
   const b=(await x.request('a',`restaurant/tables/${tb.id}/open`,'POST',{branchId:'filial-a'})).body.session;
   const order=(await x.request('a','restaurant/orders','POST',{branchId:'filial-a',tableSessionId:a.id,items:[{productId:product.id,quantity:2}]})).body.order;
   const kitchen=(await x.request('a','restaurant/kitchen?branchId=filial-a')).body.tickets[0];
   await x.request('a',`restaurant/kitchen/${kitchen.id}`,'PATCH',{branchId:'filial-a',status:'PREPARING'});
   await x.request('a',`restaurant/kitchen/${kitchen.id}`,'PATCH',{branchId:'filial-a',status:'READY'});
   await x.request('a',`restaurant/orders/${order.id}/deliver`,'POST',{branchId:'filial-a'});
   const item=await x.db.prepare('SELECT id FROM restaurant_order_items WHERE order_id=?').bind(order.id).first();
   const transfer=await x.request('a',`restaurant/sessions/${a.id}/transfer-items`,'POST',
     {branchId:'filial-a',targetSessionId:b.id,items:[{orderItemId:item.id,quantity:1}]});
   assert.equal(transfer.status,200,JSON.stringify(transfer.body));
   assert.equal((await x.request('a',`restaurant/sessions/${a.id}/transfer-items`,'POST',
     {branchId:'filial-a',targetSessionId:b.id,items:[{orderItemId:item.id,quantity:2}]})).status,409);
   const sa=await x.request('a','sales','POST',{branchId:'filial-a',restaurantSessionId:a.id});
   const sb=await x.request('a','sales','POST',{branchId:'filial-a',restaurantSessionId:b.id});
   assert.equal(sa.status,201,JSON.stringify(sa.body));assert.equal(sb.status,201,JSON.stringify(sb.body));
   assert.equal(sa.body.sale.totalCents,1500);assert.equal(sb.body.sale.totalCents,1500);
   assert.equal((await x.db.prepare('SELECT count(*) AS n FROM restaurant_orders').bind().first()).n,1);
 }finally{x.close();}
});

test('R4 cap-032: equal split plus explicit service charge posts through one sale and immutable tenders',async()=>{
 const x=await setup();try{
   const product=(await x.request('a','products','POST',{branchId:'filial-a',sku:'SPLITBASE',name:'Refeição',salePriceCents:1000,trackStock:false})).body.product;
   const charge=(await x.request('a','products','POST',{branchId:'filial-a',sku:'SERVICE_CHARGE',name:'Taxa de serviço',salePriceCents:0,trackStock:false})).body.product;
   const table=(await x.request('a','restaurant/tables','POST',{branchId:'filial-a',label:'Split'})).body.table;
   const session=(await x.request('a',`restaurant/tables/${table.id}/open`,'POST',{branchId:'filial-a'})).body.session;
   const order=(await x.request('a','restaurant/orders','POST',{branchId:'filial-a',tableSessionId:session.id,items:[{productId:product.id,quantity:1}]})).body.order;
   const k=(await x.request('a','restaurant/kitchen?branchId=filial-a')).body.tickets[0].id;
   await x.request('a',`restaurant/kitchen/${k}`,'PATCH',{branchId:'filial-a',status:'PREPARING'});
   await x.request('a',`restaurant/kitchen/${k}`,'PATCH',{branchId:'filial-a',status:'READY'});
   await x.request('a',`restaurant/orders/${order.id}/deliver`,'POST',{branchId:'filial-a'});
   const plan=await x.request('a',`restaurant/sessions/${session.id}/split`,'POST',
     {branchId:'filial-a',parts:2,serviceChargeBps:1000,serviceChargeProductId:charge.id});
   assert.equal(plan.status,200,JSON.stringify(plan.body));assert.deepEqual(plan.body.plan.shares,[550,550]);
   const opened=await x.request('a','sales','POST',{branchId:'filial-a',restaurantSessionId:session.id});
   assert.equal(opened.status,201,JSON.stringify(opened.body));assert.equal(opened.body.sale.totalCents,1100);
   const saleId=opened.body.sale.id;
   await x.request('a','cash/open','POST',{branchId:'filial-a',openingCents:0});
   assert.equal((await x.request('a',`sales/${saleId}/complete`,'POST',{branchId:'filial-a',payments:[{method:'PIX',amountCents:1100}]})).status,409);
   const done=await x.request('a',`sales/${saleId}/complete`,'POST',{branchId:'filial-a',
     shares:[{index:1,amountCents:550,method:'PIX'},{index:2,amountCents:550,method:'CASH'}]});
   assert.equal(done.status,200,JSON.stringify(done.body));
   assert.equal((await x.db.prepare('SELECT count(*) AS n FROM r4_split_tenders WHERE sale_id=?').bind(saleId).first()).n,2);
   assert.equal((await x.db.prepare('SELECT count(*) AS n FROM sales WHERE tenant_id=?').bind('a').first()).n,1);
   assert.equal((await x.request('a',`restaurant/sessions/${session.id}/close`,'POST',{branchId:'filial-a'})).status,200);
 }finally{x.close();}
});
