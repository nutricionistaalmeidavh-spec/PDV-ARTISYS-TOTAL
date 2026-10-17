import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createApi} from '../src/worker.mjs';
import {hashPassword} from '../src/password.mjs';

const origin='https://pdv-total.test';
const stamp='2026-10-17T15:00:00.000Z';
const pass='TestStrongPasswordForP1-2026';
let counter=0;
const key=()=> 'p1-mutation-'+(++counter);
const file=n=>readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8');
async function setup(){
  const db=openLocalDatabase();
  for(const n of ['0001_identity.sql','0002_commerce.sql','0003_cash_finance.sql',
    '0004_advanced_finance.sql','0005_vertical_parity.sql','0006_desktop_parity.sql',
    '0007_stock_transfers.sql','0008_transaction_reversals.sql'])db.exec(file(n));
  const hash=await hashPassword(pass);
  for(const [id,email] of [['manager','manager@example.test'],['viewer','viewer@example.test'],['outsider','outsider@example.test']]){
    await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').bind(id,email,id,hash,stamp).run();
  }
  for(const tenant of ['a','b']){
    await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind(tenant,'store-'+tenant,tenant,stamp).run();
    await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)').bind('branch-'+tenant,tenant,'MAIN','Principal',stamp).run();
  }
  for(const [tenant,user,role] of [['a','manager','OWNER'],['a','viewer','READ_ONLY'],['b','outsider','OWNER']]){
    await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)').bind(tenant,user,role,stamp).run();
  }
  const api=createApi({DB:db,AUTH_ENABLED:'true'},{now:()=>Date.parse(stamp)});
  async function call(who,tenant,path,method='GET',body=null,mutation=key()){
    const headers={origin,'content-type':'application/json'};
    if(who)headers.cookie=who;
    if(method!=='GET')headers['x-mutation-id']=mutation;
    const result=await api.fetch(new Request(origin+'/api/v1/tenants/'+tenant+'/'+path,{method,headers,
      ...(method!=='GET'?{body:JSON.stringify(body||{})}:{})}));
    return {status:result.status,body:await result.json()};
  }
  async function login(email){
    const response=await api.fetch(new Request(origin+'/api/v1/auth/login',{
      method:'POST',headers:{origin,'content-type':'application/json'},
      body:JSON.stringify({email,password:pass})}));
    assert.equal(response.status,200);
    return response.headers.get('set-cookie').split(';')[0];
  }
  const manager=await login('manager@example.test');
  const viewer=await login('viewer@example.test');
  const outsider=await login('outsider@example.test');
  const write=(path,body,mutation=key())=>call(manager,'a',path,'POST',{branchId:'branch-a',...body},mutation);
  const read=(path)=>call(manager,'a',path+'?branchId=branch-a');
  async function item(sku='P1-ITEM',price=1000,stock=10){
    const response=await write('products',{sku,name:'Item '+sku,salePriceCents:price});
    assert.equal(response.status,201,JSON.stringify(response.body));
    const id=response.body.product.id;
    assert.equal((await write('inventory/receipts',{productId:id,quantity:stock})).status,201);
    return id;
  }
  async function sale(productId,quantity=2,payments=[{method:'CASH',amountCents:2000}],sellerId='manager',customerId=null){
    const opened=await write('sales',{});assert.equal(opened.status,201,JSON.stringify(opened.body));
    const id=opened.body.sale.id;
    assert.equal((await write('sales/'+id+'/items',{productId,quantity})).status,200);
    if(customerId)assert.equal((await write('sales/'+id+'/customer',{customerId})).status,200);
    if(sellerId)assert.equal((await write('sales/'+id+'/seller',{sellerId})).status,200);
    const completed=await write('sales/'+id+'/complete',{payments});
    assert.equal(completed.status,200,JSON.stringify(completed.body));
    return id;
  }
  return {db,manager,viewer,outsider,call,write,read,item,sale,close:()=>db.close()};
}
async function scalar(db,sql,...args){return (await db.prepare(sql).bind(...args).first()).n;}

test('P1: completed sale cancellation reverses stock, commission and net cash exactly once, using the current cash session',async()=>{
  const x=await setup();try{
    const p=await x.item('P1-CASH',1000,10);
    assert.equal((await x.write('commissions/rules',{sellerId:'manager',commissionBps:1000})).status,201);
    const cash=(await x.write('cash/open',{openingCents:3000})).body.session;
    const sale=await x.sale(p,2,[{method:'CASH',amountCents:2500}]); // change 500
    assert.equal((await x.write('cash/sessions/'+cash.id+'/close',{countedCashCents:5000})).status,200);
    const current=(await x.write('cash/open',{openingCents:5000})).body.session;
    const mutation=key();
    const body={reason:'Cancelamento autorizado pelo gestor',refunds:[{method:'CASH',amountCents:2000}]};
    const result=await x.write('sales/'+sale+'/cancel',body,mutation);
    assert.equal(result.status,200,JSON.stringify(result.body));
    assert.equal(result.body.sale.status,'CANCELLED');
    assert.equal((await x.write('sales/'+sale+'/cancel',body,mutation)).status,200);
    assert.equal((await x.write('sales/'+sale+'/cancel',body)).status,409);
    assert.equal(await scalar(x.db,"SELECT COUNT(*) AS n FROM sale_returns WHERE tenant_id='a' AND sale_id=?",sale),1);
    assert.equal(await scalar(x.db,"SELECT SUM(delta_milli) AS n FROM inventory_movements WHERE tenant_id='a' AND type='return' AND product_id=?",p),2000);
    assert.equal(await scalar(x.db,"SELECT COALESCE(SUM(amount_cents),0) AS n FROM seller_commission_ledger WHERE sale_id=?",sale),0);
    assert.equal(await scalar(x.db,'SELECT COUNT(*) AS n FROM sale_refund_movements WHERE cash_session_id=?',current.id),1);
    assert.equal(await scalar(x.db,'SELECT COUNT(*) AS n FROM sale_refund_movements WHERE cash_session_id=?',cash.id),0,'do not rewrite a closed session');
    const after=await x.read('cash');
    assert.equal(after.body.session.expectedCashCents,3000);
    assert.equal((await x.read('sales/'+sale)).body.sale.status,'CANCELLED');
  }finally{x.close();}
});

test('P1: partial returns honor allocated discounts, individual quantities, and refund ceilings across retries',async()=>{
  const x=await setup();try{
    const p=await x.item('P1-PARTIAL',1000,10);
    await x.write('cash/open',{openingCents:3000});
    const opened=(await x.write('sales',{})).body.sale;
    await x.write('sales/'+opened.id+'/items',{productId:p,quantity:3});
    await x.write('sales/'+opened.id+'/discount',{discountCents:300});
    await x.write('sales/'+opened.id+'/complete',{payments:[{method:'PIX',amountCents:2700}]});
    const snap=(await x.read('sales/'+opened.id)).body.sale;
    const itemId=snap.items[0].id;
    const mutation=key(),first={reason:'Devolução parcial com comprovante',items:[{saleItemId:itemId,quantity:1}],refunds:[{method:'PIX',amountCents:900}]};
    assert.equal((await x.write('sales/'+opened.id+'/returns',first,mutation)).status,201);
    assert.equal((await x.write('sales/'+opened.id+'/returns',first,mutation)).status,201);
    assert.equal((await x.write('sales/'+opened.id+'/returns',first)).status,409,'same quantity cannot be double counted with wrong refund');
    const rest={reason:'Devolução dos itens restantes',items:[{saleItemId:itemId,quantity:2}],refunds:[{method:'PIX',amountCents:1800}]};
    assert.equal((await x.write('sales/'+opened.id+'/returns',rest)).status,201);
    const tooMany={...first,refunds:[{method:'PIX',amountCents:900}]};
    assert.equal((await x.write('sales/'+opened.id+'/returns',tooMany)).status,409);
    assert.equal(await scalar(x.db,"SELECT SUM(delta_milli) AS n FROM inventory_movements WHERE type='return' AND product_id=?",p),3000);
    assert.equal(await scalar(x.db,"SELECT COUNT(*) AS n FROM sale_returns WHERE sale_id=?",opened.id),2);
    assert.equal((await x.read('sales/'+opened.id)).body.sale.status,'COMPLETED','historical sale preserved by returns');
  }finally{x.close();}
});

test('P1: crediário cancellation reverses outstanding credit and earned commissions, but never generates a second sale',async()=>{
  const x=await setup();try{
    const p=await x.item('P1-CREDIT',1000,8);
    const customer=(await x.write('customers',{name:'Cliente P1',creditLimitCents:5000})).body.customer;
    await x.write('cash/open',{openingCents:0});
    assert.equal((await x.write('commissions/rules',{sellerId:'manager',commissionBps:1200})).status,201);
    const sale=await x.sale(p,2,[{method:'STORE_CREDIT',amountCents:2000}],'manager',customer.id);
    const denied=await x.call(x.viewer,'a','sales/'+sale+'/cancel','POST',{branchId:'branch-a',reason:'Não autorizado',refunds:[{method:'STORE_CREDIT',amountCents:2000}]});
    assert.equal(denied.status,403);
    const outsider=await x.call(x.outsider,'b','sales/'+sale+'/cancel','POST',{branchId:'branch-b',reason:'Outra empresa',refunds:[{method:'STORE_CREDIT',amountCents:2000}]});
    assert.equal(outsider.status,404);
    const cancelled=await x.write('sales/'+sale+'/cancel',{reason:'Cliente desistiu da compra',refunds:[{method:'STORE_CREDIT',amountCents:2000}]});
    assert.equal(cancelled.status,200,JSON.stringify(cancelled.body));
    assert.equal((await x.read('credit/'+customer.id)).body.credit.balanceCents,0);
    assert.equal(await scalar(x.db,"SELECT COALESCE(SUM(amount_cents),0) AS n FROM seller_commission_ledger WHERE sale_id=?",sale),0);
    assert.equal(await scalar(x.db,"SELECT COUNT(*) AS n FROM cash_movements WHERE sale_id=?",sale),0);
    assert.equal(await scalar(x.db,"SELECT COUNT(*) AS n FROM sales WHERE id=?",sale),1);
  }finally{x.close();}
});

test('P1: cash refund cannot use closed original session or overdraw current cash and never creates partial ledger entries',async()=>{
  const x=await setup();try{
    const p=await x.item('P1-NOCASH',1000,5);
    const opened=(await x.write('cash/open',{openingCents:1000})).body.session;
    const sale=await x.sale(p,2,[{method:'CASH',amountCents:2000}]);
    assert.equal((await x.write('cash/sessions/'+opened.id+'/close',{countedCashCents:3000})).status,200);
    const body={reason:'Devolução em dinheiro solicitada',refunds:[{method:'CASH',amountCents:2000}]};
    assert.equal((await x.write('sales/'+sale+'/cancel',body)).status,409);
    assert.equal(await scalar(x.db,'SELECT COUNT(*) AS n FROM sale_returns WHERE sale_id=?',sale),0);
    await x.write('cash/open',{openingCents:500});
    assert.equal((await x.write('sales/'+sale+'/cancel',body)).status,409);
    assert.equal(await scalar(x.db,'SELECT COUNT(*) AS n FROM sale_returns WHERE sale_id=?',sale),0);
  }finally{x.close();}
});

test('P1: financial settlement reversal reopens receivable with immutable original and prevents double reversal',async()=>{
  const x=await setup();try{
    const entry=(await x.write('finance/entries',{kind:'RECEIVABLE',description:'Recebimento a prazo',dueDate:'2026-10-17',amountCents:9000})).body.entry;
    const settlement=(await x.write('finance/entries/'+entry.id+'/settle',{amountCents:4000,method:'PIX'})).body.settlement;
    const url='finance/entries/'+entry.id+'/settlements/'+settlement.id+'/reverse';
    const body={reason:'Conciliação refeita pelo gestor'};
    assert.equal((await x.call(x.viewer,'a',url,'POST',{branchId:'branch-a',...body})).status,403);
    const mutation=key();
    const reversed=await x.write(url,body,mutation);
    assert.equal(reversed.status,200,JSON.stringify(reversed.body));
    assert.equal(reversed.body.result.entry.openCents,9000);
    assert.equal((await x.write(url,body,mutation)).status,200);
    assert.equal((await x.write(url,body)).status,409);
    assert.equal(await scalar(x.db,'SELECT COUNT(*) AS n FROM finance_settlements WHERE id=?',settlement.id),1);
    assert.equal(await scalar(x.db,'SELECT COUNT(*) AS n FROM finance_settlement_reversals WHERE settlement_id=?',settlement.id),1);
    const summary=(await x.read('finance/summary')).body.summary;
    assert.equal(summary.receivableOpenCents,9000);
    assert.equal(summary.receivableSettledCents,0);
  }finally{x.close();}
});
