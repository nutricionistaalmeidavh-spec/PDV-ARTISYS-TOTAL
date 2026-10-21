import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createApi} from '../src/worker.mjs';
import {hashPassword} from '../src/password.mjs';

async function setup(){
  const db=openLocalDatabase(),origin='https://pdv.test',stamp=new Date().toISOString();
  for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())
    db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind('t','test','Loja',stamp).run();
  await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)').bind('b','t','MAIN','Matriz',stamp).run();
  await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').bind('u','u@example.com','Usuário',await hashPassword('Senha-teste-123!'),stamp).run();
  await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)').bind('t','u','OWNER',stamp).run();
  const api=createApi({DB:db});
  const login=await api.fetch(new Request(origin+'/api/v1/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'u@example.com',password:'Senha-teste-123!'})}));
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  async function request(path,method='GET',body,key=crypto.randomUUID()){
    const response=await api.fetch(new Request(origin+'/api/v1/tenants/t/'+path,{method,headers:{cookie,origin,'content-type':'application/json','x-mutation-id':key},...(body===undefined?{}:{body:JSON.stringify({branchId:'b',...body})})}));
    return {status:response.status,body:await response.json()};
  }
  return {db,request,close:()=>db.close()};
}

test('Balcão lists confirmed wholesale documents and opens the same sale once across retries and terminals',async()=>{
  const x=await setup();try{
    const p=await x.request('products','POST',{name:'Produto',sku:'P1',salePriceCents:1000,trackStock:false});assert.equal(p.status,201,JSON.stringify(p.body));
    const customer=await x.request('customers','POST',{name:'Cliente'});assert.equal(customer.status,201);
    const order=await x.request('wholesale/orders','POST',{customerId:customer.body.customer.id,items:[{productId:p.body.product.id,quantity:2}]});assert.equal(order.status,201,JSON.stringify(order.body));
    const id=order.body.order.id;
    assert.equal((await x.request('wholesale/orders/'+id+'/confirm','POST',{})).status,200);
    const list=await x.request('checkout/documents?branchId=b&query=atacado');
    assert.equal(list.status,200,JSON.stringify(list.body));assert.equal(list.body.documents.length,1);assert.equal(list.body.documents[0].id,id);
    const invalid=await x.request('checkout/documents/order/'+id+'/open','POST',{});assert.equal(invalid.status,400);
    const key=crypto.randomUUID();
    const opened=await x.request('checkout/documents/order/'+id+'/open','POST',{terminalId:'WEB-TEST'},key);assert.equal(opened.status,200,JSON.stringify(opened.body));
    assert.equal(opened.body.sale.items.length,1);assert.equal(opened.body.sale.totalCents,2000);
    const again=await x.request('checkout/documents/order/'+id+'/open','POST',{terminalId:'WEB-TEST'},key);assert.equal(again.status,200);assert.equal(again.body.sale.id,opened.body.sale.id);
    const other=await x.request('checkout/documents/order/'+id+'/open','POST',{terminalId:'WEB-OTHER'});assert.equal(other.status,409);
    assert.equal((await x.db.prepare('SELECT COUNT(*) AS n FROM sales').bind().first()).n,1);
    assert.equal((await x.db.prepare('SELECT COUNT(*) AS n FROM inventory_movements').bind().first()).n,0);
  }finally{x.close();}
});

test('Balcão lists table sessions and delivered pickup documents, filtering by type and tenant branch',async()=>{
  const x=await setup();try{
    const at=new Date().toISOString();
    await x.db.prepare('INSERT INTO restaurant_tables(id,tenant_id,branch_id,label,seats,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind('table','t','b','7',4,at,at).run();
    await x.db.prepare("INSERT INTO restaurant_table_sessions(id,tenant_id,branch_id,table_id,status,party_size,opened_by,opened_at) VALUES('session','t','b','table','OPEN',2,'u',?)").bind(at).run();
    const list=await x.request('checkout/documents?branchId=b&query=comanda%207');assert.equal(list.status,200,JSON.stringify(list.body));
    assert.equal(list.body.documents.length,1);assert.equal(list.body.documents[0].type,'COMMAND');
    assert.equal((await x.request('checkout/documents?branchId=b&query=retirada')).body.documents.length,0);
    assert.equal((await x.request('checkout/documents?branchId=another')).status,404);
    const denied=await x.request('checkout/documents/order/not-found/open','POST',{terminalId:'WEB-TEST'});assert.equal(denied.status,404);
  }finally{x.close();}
});

test('document search filters names, accents and fulfillment before applying the pending-document limit',async()=>{
  const x=await setup();try{
    const at='2026-10-20T12:00:00.000Z';
    for(let i=0;i<101;i++){
      const label=i===0?'João':i===1?'ÁLVARO':'Mesa '+i;
      await x.db.prepare('INSERT INTO restaurant_tables(id,tenant_id,branch_id,label,seats,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind('t'+i,'t','b',label,4,at,at).run();
      await x.db.prepare("INSERT INTO restaurant_table_sessions(id,tenant_id,branch_id,table_id,status,party_size,opened_by,opened_at) VALUES(?,?,?,?,'OPEN',2,'u',?)").bind('s'+i,'t','b','t'+i,at).run();
    }
    assert.equal((await x.request('checkout/documents?branchId=b')).status,409);
    for(const query of ['comanda joao','ÁLVARO','alvaro']){
      const searched=await x.request('checkout/documents?branchId=b&query='+encodeURIComponent(query));assert.equal(searched.status,200,JSON.stringify(searched.body));assert.equal(searched.body.documents.length,1);
    }
    for(let i=0;i<102;i++)await x.db.prepare(`INSERT INTO restaurant_orders(id,tenant_id,branch_id,fulfillment,status,address,total_cents,created_by,created_at,updated_at)
      VALUES(?,'t','b',?,'DELIVERED','Endereço de teste',0,'u',?,?)`).bind('o'+i,i===0?'PICKUP':'DELIVERY',i===0?'2026-10-19T12:00:00Z':at,at).run();
    const pickup=await x.request('checkout/documents?branchId=b&query=retirada');assert.equal(pickup.status,200,JSON.stringify(pickup.body));assert.equal(pickup.body.documents.length,1);assert.equal(pickup.body.documents[0].id,'o0');
  }finally{x.close();}
});

test('hosted settings manages optional areas without exposing LAN device routes and requires admin for writes',async()=>{
  const x=await setup();try{
    const get=await x.request('modules');assert.equal(get.status,200,JSON.stringify(get.body));assert.equal(get.body.modules.length,2);
    const changed=await x.request('modules/WHOLESALE','PATCH',{enabled:true});assert.equal(changed.status,200);
    assert.equal((await x.request('modules')).body.modules.find(x=>x.id==='WHOLESALE').enabled,true);
    assert.equal((await x.request('lan/devices')).status,404);
    await x.db.prepare("UPDATE tenant_memberships SET profile_key='CASHIER'").bind().run();
    assert.equal((await x.request('modules/FOOD','PATCH',{enabled:false})).status,403);
    assert.equal((await x.request('checkout/documents/command/session/open','POST',{terminalId:'WEB-TEST'})).status,403);
  }finally{x.close();}
});

async function deliveredTable(x,{price=2500,stock=true}={}){
  const created=await x.request('products','POST',{name:'Prato da casa',sku:'TABLE-PLATE',salePriceCents:price,trackStock:stock});
  assert.equal(created.status,201,JSON.stringify(created.body));const product=created.body.product;
  if(stock)assert.equal((await x.request('inventory/receipts','POST',{productId:product.id,quantity:10,type:'opening'})).status,201);
  const table=await x.request('restaurant/tables','POST',{label:'Mesa divisão',seats:4});assert.equal(table.status,201,JSON.stringify(table.body));
  const opened=await x.request('restaurant/tables/'+table.body.table.id+'/open','POST',{});assert.equal(opened.status,201,JSON.stringify(opened.body));
  const session=opened.body.session;
  const order=await x.request('restaurant/orders','POST',{tableSessionId:session.id,items:[{productId:product.id,quantity:1}]});assert.equal(order.status,201,JSON.stringify(order.body));
  const tickets=await x.request('restaurant/kitchen?branchId=b');assert.equal(tickets.status,200);
  const ticket=tickets.body.tickets.find(t=>t.orderId===order.body.order.id||t.order_id===order.body.order.id);
  assert.ok(ticket,JSON.stringify(tickets.body));
  assert.equal((await x.request('restaurant/kitchen/'+ticket.id,'PATCH',{status:'PREPARING'})).status,200);
  assert.equal((await x.request('restaurant/kitchen/'+ticket.id,'PATCH',{status:'READY'})).status,200);
  assert.equal((await x.request('restaurant/orders/'+order.body.order.id+'/deliver','POST',{})).status,200);
  return {session,order:order.body.order,product};
}

test('Balcão settles delivered table split after partial prepayment/refund with one sale and only fresh cash movements',async()=>{
  const x=await setup();try{
    const {session,product}=await deliveredTable(x);
    assert.equal((await x.request('restaurant/sessions/'+session.id+'/split','POST',{parts:2})).status,200);
    assert.equal((await x.request('cash/open','POST',{terminalId:'WEB-TEST',openingCents:0})).status,201);
    const pre=await x.request('restaurant/sessions/'+session.id+'/prepayments','POST',{terminalId:'WEB-TEST',method:'CASH',amountCents:900,payerIndex:1});assert.equal(pre.status,201,JSON.stringify(pre.body));
    const refunded=await x.request('restaurant/sessions/'+session.id+'/prepayments/'+pre.body.payment.id+'/refund','POST',{terminalId:'WEB-TEST',amountCents:200,reason:'Estorno parcial solicitado'});assert.equal(refunded.status,201,JSON.stringify(refunded.body));
    const list=await x.request('checkout/documents?branchId=b&query=comanda');assert.equal(list.status,200,JSON.stringify(list.body));
    assert.equal(list.body.documents.length,1);assert.equal(list.body.documents[0].totalCents,2500);
    const opened=await x.request('checkout/documents/command/'+session.id+'/open','POST',{terminalId:'WEB-TEST'});assert.equal(opened.status,200,JSON.stringify(opened.body));
    const sale=opened.body.sale;
    assert.equal((await x.db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE type='sale'").bind().first()).n,0);
    const settlement=await x.request('checkout/documents/settlement/'+sale.id+'?branchId=b');assert.equal(settlement.status,200,JSON.stringify(settlement.body));
    assert.deepEqual(settlement.body.settlement,{prepaidCents:700,amountDueCents:1800,shares:[{index:1,amountCents:550},{index:2,amountCents:1250}]});
    const key=crypto.randomUUID(),body={terminalId:'WEB-TEST',shares:settlement.body.settlement.shares.map(p=>({...p,method:'PIX'}))};
    const paid=await x.request('sales/'+sale.id+'/complete','POST',body,key);assert.equal(paid.status,200,JSON.stringify(paid.body));
    assert.equal((await x.request('sales/'+sale.id+'/complete','POST',body,key)).status,200);
    assert.equal((await x.db.prepare('SELECT COUNT(*) n FROM sales').bind().first()).n,1);
    assert.equal((await x.db.prepare('SELECT SUM(amount_cents) n FROM sale_payments WHERE sale_id=?').bind(sale.id).first()).n,2500);
    assert.equal((await x.db.prepare('SELECT SUM(amount_cents) n FROM cash_movements WHERE sale_id=?').bind(sale.id).first()).n,1800);
    const movements=(await x.db.prepare("SELECT product_id,delta_milli FROM inventory_movements WHERE type='sale'").bind().all()).results;
    assert.equal(movements.length,1);assert.equal(movements[0].product_id,product.id);assert.equal(movements[0].delta_milli,-1000);
    assert.equal((await x.request('checkout/documents?branchId=b&query=comanda')).body.documents.length,0);
  }finally{x.close();}
});

test('Balcão settlement removes fully prepaid shares and refuses stale shares without duplicate cash or sale',async()=>{
  const x=await setup();try{
    const {session}=await deliveredTable(x,{stock:false});
    assert.equal((await x.request('restaurant/sessions/'+session.id+'/split','POST',{parts:2})).status,200);
    assert.equal((await x.request('cash/open','POST',{terminalId:'WEB-TEST',openingCents:0})).status,201);
    const prepay=amount=>x.request('restaurant/sessions/'+session.id+'/prepayments','POST',{terminalId:'WEB-TEST',method:'PIX',amountCents:amount,payerIndex:amount===1250?1:2});
    assert.equal((await prepay(1250)).status,201);
    const opened=await x.request('checkout/documents/command/'+session.id+'/open','POST',{terminalId:'WEB-TEST'});assert.equal(opened.status,200,JSON.stringify(opened.body));
    const saleId=opened.body.sale.id;
    const read=()=>x.request('checkout/documents/settlement/'+saleId+'?branchId=b');
    const old=(await read()).body.settlement;
    assert.deepEqual(old,{prepaidCents:1250,amountDueCents:1250,shares:[{index:2,amountCents:1250}]});
    // The account is already in checkout; it no longer accepts advances.
    assert.equal((await prepay(500)).status,409);
    const stale=await x.request('sales/'+saleId+'/complete','POST',{terminalId:'WEB-TEST',shares:[{index:2,amountCents:1000,method:'PIX'}]});
    assert.equal(stale.status,409,JSON.stringify(stale.body));
    assert.equal((await x.db.prepare('SELECT COUNT(*) n FROM sale_payments WHERE sale_id=?').bind(saleId).first()).n,0);
    const fresh=(await read()).body.settlement;
    const body={terminalId:'WEB-TEST',shares:fresh.shares.map(p=>({...p,method:'PIX'}))};
    const paid=await x.request('sales/'+saleId+'/complete','POST',body);assert.equal(paid.status,200,JSON.stringify(paid.body));
    assert.equal((await x.db.prepare('SELECT SUM(amount_cents) n FROM cash_movements WHERE sale_id=?').bind(saleId).first()).n,fresh.amountDueCents);
    assert.equal((await x.db.prepare('SELECT COUNT(*) n FROM sales').bind().first()).n,1);
  }finally{x.close();}
});

test('Balcão closes a fully prepaid split with empty shares and no second receipt in cash movements',async()=>{
  const x=await setup();try{
    const {session}=await deliveredTable(x,{stock:false});
    assert.equal((await x.request('restaurant/sessions/'+session.id+'/split','POST',{parts:2})).status,200);
    assert.equal((await x.request('cash/open','POST',{terminalId:'WEB-TEST',openingCents:0})).status,201);
    for(const payerIndex of [1,2])assert.equal((await x.request('restaurant/sessions/'+session.id+'/prepayments','POST',{terminalId:'WEB-TEST',method:'PIX',amountCents:1250,payerIndex})).status,201);
    const opened=await x.request('checkout/documents/command/'+session.id+'/open','POST',{terminalId:'WEB-TEST'});assert.equal(opened.status,200,JSON.stringify(opened.body));
    const saleId=opened.body.sale.id;
    const settlement=await x.request('checkout/documents/settlement/'+saleId+'?branchId=b');assert.equal(settlement.status,200,JSON.stringify(settlement.body));
    assert.deepEqual(settlement.body.settlement,{prepaidCents:2500,amountDueCents:0,shares:[]});
    const paid=await x.request('sales/'+saleId+'/complete','POST',{terminalId:'WEB-TEST',shares:[]});assert.equal(paid.status,200,JSON.stringify(paid.body));
    assert.equal((await x.db.prepare('SELECT SUM(amount_cents) n FROM sale_payments WHERE sale_id=?').bind(saleId).first()).n,2500);
    assert.equal((await x.db.prepare('SELECT COUNT(*) n FROM cash_movements WHERE sale_id=?').bind(saleId).first()).n,0);
  }finally{x.close();}
});

test('Balcão opens delivered pickup from its immutable source and concurrent terminals cannot create two sales',async()=>{
  const x=await setup();try{
    const p=await x.request('products','POST',{name:'Pedido para retirada',sku:'PICKUP-PLATE',salePriceCents:1300,trackStock:false});assert.equal(p.status,201);
    const order=await x.request('restaurant/orders','POST',{fulfillment:'PICKUP',items:[{productId:p.body.product.id,quantity:2}]});assert.equal(order.status,201,JSON.stringify(order.body));
    const orderId=order.body.order.id;
    assert.equal((await x.request('checkout/documents?branchId=b&query=retirada')).body.documents.length,0);
    assert.equal((await x.request('checkout/documents/delivery/'+orderId+'/open','POST',{terminalId:'WEB-TEST'})).status,409);
    const ticket=(await x.request('restaurant/kitchen?branchId=b')).body.tickets[0];
    assert.equal((await x.request('restaurant/kitchen/'+ticket.id,'PATCH',{status:'PREPARING'})).status,200);
    assert.equal((await x.request('restaurant/kitchen/'+ticket.id,'PATCH',{status:'READY'})).status,200);
    assert.equal((await x.request('restaurant/orders/'+orderId+'/deliver','POST',{})).status,200);
    const list=await x.request('checkout/documents?branchId=b&query=retirada');assert.equal(list.status,200,JSON.stringify(list.body));assert.equal(list.body.documents[0].fulfillmentType,'PICKUP');
    const results=await Promise.all(['WEB-FIRST','WEB-SECOND'].map(terminalId=>x.request('checkout/documents/delivery/'+orderId+'/open','POST',{terminalId})));
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409],JSON.stringify(results));
    assert.equal(results.find(r=>r.status===200).body.sale.totalCents,2600);
    assert.equal((await x.db.prepare('SELECT COUNT(*) n FROM sales').bind().first()).n,1);
    assert.equal((await x.db.prepare('SELECT COUNT(*) n FROM restaurant_sale_links').bind().first()).n,1);
  }finally{x.close();}
});
