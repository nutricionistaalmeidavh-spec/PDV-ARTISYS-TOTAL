import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createApi} from '../src/worker.mjs';
import {hashPassword} from '../src/password.mjs';

const origin='https://pdv-total.test';
const identity=readFileSync(new URL('../migrations/0001_identity.sql',import.meta.url),'utf8');
const commerce=readFileSync(new URL('../migrations/0002_commerce.sql',import.meta.url),'utf8');
const finance=readFileSync(new URL('../migrations/0003_cash_finance.sql',import.meta.url),'utf8');
const vertical=readFileSync(new URL('../migrations/0005_vertical_parity.sql',import.meta.url),'utf8');
const parity=readFileSync(new URL('../migrations/0006_desktop_parity.sql',import.meta.url),'utf8');
const transfers=readFileSync(new URL('../migrations/0007_stock_transfers.sql',import.meta.url),'utf8');
const reversals=readFileSync(new URL('../migrations/0008_transaction_reversals.sql',import.meta.url),'utf8');
const NOW=Date.parse('2026-10-17T14:00:00Z');
const date='2026-10-17T14:00:00.000Z';
const password='SafeTestPasswordForPdv2026!';
let num=0;
const next=()=>('mutation-'+(++num)+'-long');
async function setup(){
  const db=openLocalDatabase();db.exec(identity);db.exec(commerce);db.exec(finance);db.exec(vertical);db.exec(parity);db.exec(transfers);db.exec(reversals);
  const pass=await hashPassword(password);
  for(const [id,email] of [['owner','owner@test.com'],['other','other@test.com'],['viewer','viewer@test.com']])
    await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
      .bind(id,email,id,pass,date).run();
  for(const id of ['a','b']){
    await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)')
      .bind(id,'store-'+id,'Store '+id,date).run();
    await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)')
      .bind('branch-'+id,id,'MAIN','Matriz',date).run();
  }
  for(const [tid,uid,role] of [['a','owner','OWNER'],['b','other','OWNER'],['a','viewer','READ_ONLY']])
    await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)')
      .bind(tid,uid,role,date).run();
  const api=createApi({DB:db,AUTH_ENABLED:'true'},{now:()=>NOW});
  async function call(path,{cookie='',body,method='GET',key,originHeader=true}={}){
    const headers={};if(cookie)headers.cookie=cookie;
    if(originHeader&&method!=='GET')headers.origin=origin;
    if(body!==undefined)headers['content-type']='application/json';
    if(key)headers['x-mutation-id']=key;
    const res=await api.fetch(new Request(origin+path,{
      method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})
    }));
    return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]||''};
  }
  const login=async(email)=>call('/api/v1/auth/login',{method:'POST',body:{email,password}});
  const owner=(await login('owner@test.com')).cookie;
  const other=(await login('other@test.com')).cookie;
  const viewer=(await login('viewer@test.com')).cookie;
  const path=(tenant,suffix)=>'/api/v1/tenants/'+tenant+'/'+suffix;
  const write=(tenant,suffix,body,{who=owner,key=next(),method='POST'}={})=>
    call(path(tenant,suffix),{cookie:who,body,method,key});
  const get=(tenant,suffix,who=owner)=>call(path(tenant,suffix),{cookie:who});
  const id=async(name,sku,stock=1)=>{
    const p=await write('a','products',{branchId:'branch-a',name,sku,salePriceCents:1000,trackStock:true});
    assert.equal(p.status,201,p.body.error);
    const r=await write('a','inventory/receipts',{branchId:'branch-a',productId:p.body.product.id,quantity:stock,type:'opening'});
    assert.equal(r.status,201,r.body.error);
    return p.body.product.id;
  };
  return {db,owner,other,viewer,call,write,get,path,id,close:()=>db.close()};
}

test('P3 commerce: tenant isolation, canonical permissions, unique SKU and no ambient data leak',async()=>{
  const x=await setup();try{
    const p=await x.write('a','products',{branchId:'branch-a',name:'Teclado',sku:'T1',salePriceCents:2490,trackStock:true});
    assert.equal(p.status,201,p.body.error);
    const seen=await x.get('a','products?branchId=branch-a');
    assert.deepEqual(seen.body.products.map(p=>p.name),['Teclado']);
    assert.equal((await x.get('b','products?branchId=branch-b',x.other)).body.products.length,0);
    assert.equal((await x.get('a','products?branchId=branch-b')).status,404);
    assert.equal((await x.get('b','products?branchId=branch-b')).status,404);
    assert.equal((await x.write('a','products',{branchId:'branch-a',name:'X',sku:'NO',salePriceCents:123}, {who:x.viewer})).status,403);
    assert.equal((await x.write('a','products',{branchId:'branch-a',name:'Teclado Novo',sku:'T1',salePriceCents:300})).status,409);
    assert.equal((await x.get('a','products?branchId=branch-a',x.viewer)).status,200);
  }finally{x.close();}
});

test('P3 immutable stock ledger: receipt is idempotent and balance is projection',async()=>{
  const x=await setup();try{
    const product=await x.write('a','products',{branchId:'branch-a',name:'Mouse',sku:'M1',salePriceCents:1500});
    const pid=product.body.product.id,key=next();
    const a=await x.write('a','inventory/receipts',{branchId:'branch-a',productId:pid,quantity:2.125},{key});
    assert.equal(a.status,201,a.body.error);
    const b=await x.write('a','inventory/receipts',{branchId:'branch-a',productId:pid,quantity:2.125},{key});
    assert.deepEqual(a.body,b.body);
    const stock=await x.get('a','inventory?branchId=branch-a');
    assert.equal(stock.body.stock[0].quantity,2.125);
    const cnt=await x.db.prepare('SELECT COUNT(*) AS n FROM inventory_movements WHERE product_id=?').bind(pid).first();
    assert.equal(cnt.n,1);
    await assert.rejects(x.db.prepare('DELETE FROM inventory_movements WHERE product_id=?').bind(pid).run(),/IMMUTABLE/);
  }finally{x.close();}
});

test('P3 lifecycle: open cash, open sale, add item exactly once, calculate original totals, pay, ledger once',async()=>{
  const x=await setup();try{
    const pid=await x.id('Cafe','CAFE',4);
    const cash=await x.write('a','cash/open',{branchId:'branch-a',openingCents:5000});
    assert.equal(cash.status,201,cash.body.error);
    const opened=await x.write('a','sales',{branchId:'branch-a'});
    assert.equal(opened.status,201,opened.body.error);
    const sid=opened.body.sale.id;
    const key=next();
    const added=await x.write('a',`sales/${sid}/items`,{branchId:'branch-a',productId:pid,quantity:2},{key});
    assert.equal(added.status,200,added.body.error);
    assert.equal(added.body.sale.totalCents,2000);
    const duplicate=await x.write('a',`sales/${sid}/items`,{branchId:'branch-a',productId:pid,quantity:2},{key});
    assert.equal(duplicate.body.sale.items[0].quantity,2,'retry must not double quantity');
    const completeKey=next();
    const paid=await x.write('a',`sales/${sid}/complete`,{branchId:'branch-a',payments:[{method:'CASH',amountCents:2500}]},{key:completeKey});
    assert.equal(paid.status,200,paid.body.error);
    assert.equal(paid.body.sale.totalCents,2000);
    assert.equal(paid.body.sale.changeCents,500);
    const replay=await x.write('a',`sales/${sid}/complete`,{branchId:'branch-a',payments:[{method:'CASH',amountCents:2500}]},{key:completeKey});
    assert.deepEqual(replay.body,paid.body);
    const changedKey=await x.write('a',`sales/${sid}/complete`,{branchId:'branch-a',payments:[{method:'PIX',amountCents:2000}]});
    assert.equal(changedKey.status,409);
    assert.equal((await x.get('a','inventory?branchId=branch-a')).body.stock[0].quantity,2);
    const stats=await x.db.prepare('SELECT (SELECT COUNT(*) FROM inventory_movements WHERE type=\'sale\') AS s,(SELECT COUNT(*) FROM domain_events WHERE type=\'sale.completed\') AS e,(SELECT COUNT(*) FROM sale_payments) AS p').bind().first();
    assert.deepEqual({...stats},{s:1,e:1,p:1});
    const cashNet=await x.db.prepare("SELECT amount_cents AS amount FROM cash_movements WHERE method='CASH'").bind().first();
    assert.equal(cashNet.amount,2000,'cash drawer receives only tendered cash minus change');
  }finally{x.close();}
});

test('P3 D1 batch rolls back full sale when two items exceed the last available unit',async()=>{
  const x=await setup();try{
    const a=await x.id('Last item','LAST',1);
    const b=await x.id('Second item','SECOND',1);
    await x.write('a','cash/open',{branchId:'branch-a',openingCents:0});
    const makeSale=async()=>{
      const opened=await x.write('a','sales',{branchId:'branch-a'}),sid=opened.body.sale.id;
      for(const pid of [a,b])assert.equal((await x.write('a',`sales/${sid}/items`,{branchId:'branch-a',productId:pid,quantity:1})).status,200);
      return sid;
    };
    const first=await makeSale(),second=await makeSale();
    assert.equal((await x.write('a',`sales/${first}/complete`,{branchId:'branch-a',payments:[{method:'PIX',amountCents:2000}]})).status,200);
    const result=await x.write('a',`sales/${second}/complete`,{branchId:'branch-a',payments:[{method:'PIX',amountCents:2000}]});
    assert.equal(result.status,409,JSON.stringify(result.body));
    assert.equal((await x.get('a',`sales/${second}?branchId=branch-a`)).body.sale.status,'OPEN');
    assert.equal((await x.get('a','inventory?branchId=branch-a')).body.stock.reduce((s,p)=>s+p.quantity,0),0);
    const total=await x.db.prepare('SELECT COUNT(*) AS n FROM domain_events').bind().first();
    assert.equal(total.n,1,'failed sale must not create a domain event');
    const pay=await x.db.prepare('SELECT COUNT(*) AS n FROM sale_payments').bind().first();
    assert.equal(pay.n,1,'failed sale must not create payments');
  }finally{x.close();}
});

test('P3 commercial mutations reject missing CSRF origin and membership crossing',async()=>{
  const x=await setup();try{
    const p=x.path('a','products');
    const request={branchId:'branch-a',name:'Produto',sku:'PROD',salePriceCents:100};
    assert.equal((await x.call(p,{cookie:x.owner,method:'POST',body:request,originHeader:false,key:next()})).status,403);
    assert.equal((await x.call(p,{cookie:x.other,method:'POST',body:request,key:next()})).status,404);
    assert.equal((await x.call(p,{cookie:x.owner,method:'POST',body:request})).status,400,'missing unique key fails closed');
  }finally{x.close();}
});

test('P3 cash: closing uses original cash rules, net change, supplies, withdrawals and immutable journal',async()=>{
  const x=await setup();try{
    const pid=await x.id('Produto de caixa','CAIXA01',2);
    const session=await x.write('a','cash/open',{branchId:'branch-a',openingCents:2000});
    assert.equal(session.status,201,session.body.error);
    const cashId=session.body.session.id;
    const supplyKey=next();
    const supply=await x.write('a',`cash/sessions/${cashId}/supply`,{branchId:'branch-a',amountCents:500,note:'Troco extra'},{key:supplyKey});
    assert.equal(supply.status,200,supply.body.error);
    assert.deepEqual((await x.write('a',`cash/sessions/${cashId}/supply`,{branchId:'branch-a',amountCents:500,note:'Troco extra'},{key:supplyKey})).body,supply.body);
    const withdrawal=await x.write('a',`cash/sessions/${cashId}/withdraw`,{branchId:'branch-a',amountCents:300});
    assert.equal(withdrawal.status,200,withdrawal.body.error);
    const sale=await x.write('a','sales',{branchId:'branch-a'});
    const sid=sale.body.sale.id;
    await x.write('a',`sales/${sid}/items`,{branchId:'branch-a',productId:pid,quantity:1});
    const paid=await x.write('a',`sales/${sid}/complete`,{branchId:'branch-a',payments:[{method:'CASH',amountCents:1500}]});
    assert.equal(paid.status,200,paid.body.error); // 1000 net cash; 500 change
    const live=await x.get('a','cash?branchId=branch-a');
    assert.equal(live.body.session.expectedCashCents,3200,'2000+500-300+1000 net sale');
    const wrong=await x.write('a',`cash/sessions/${cashId}/withdraw`,{branchId:'branch-a',amountCents:3201});
    assert.equal(wrong.status,409);
    const closeKey=next();
    const closed=await x.write('a',`cash/sessions/${cashId}/close`,{branchId:'branch-a',countedCashCents:3190},{key:closeKey});
    assert.equal(closed.status,200,closed.body.error);
    assert.equal(closed.body.result.expectedCashCents,3200);
    assert.equal(closed.body.result.divergenceCents,-10);
    assert.deepEqual((await x.write('a',`cash/sessions/${cashId}/close`,{branchId:'branch-a',countedCashCents:3190},{key:closeKey})).body,closed.body);
    assert.equal((await x.get('a','cash?branchId=branch-a')).body.session,null);
    const history=await x.get('a','cash/sessions?branchId=branch-a');
    assert.equal(history.body.sessions[0].status,'CLOSED');
    assert.equal(history.body.sessions[0].divergenceCents,-10);
    const movements=await x.get('a',`cash/sessions/${cashId}/movements?branchId=branch-a`);
    assert.deepEqual(movements.body.movements.map(m=>m.type).sort(),['SALE','SUPPLY','WITHDRAWAL']);
    assert.equal((await x.write('a',`cash/sessions/${cashId}/supply`,{branchId:'branch-a',amountCents:1})).status,409);
    const blocked=await x.write('a',`sales/${sid}/complete`,{branchId:'branch-a',payments:[{method:'CASH',amountCents:1000}]});
    assert.equal(blocked.status,409);
    assert.equal((await x.get('a',`cash/sessions/${cashId}/movements?branchId=branch-b`)).status,404);
    const cnt=await x.db.prepare('SELECT COUNT(*) AS n FROM cash_adjustments').bind().first();
    assert.equal(cnt.n,2,'retry should not create a third cash movement');
    await assert.rejects(x.db.prepare('DELETE FROM cash_adjustments').bind().run(),/IMMUTABLE/);
  }finally{x.close();}
});

test('P4 finance: manual payable/receivable ledger settles partially, prevents overpay, never double-posts sales',async()=>{
  const x=await setup();try{
    const body={branchId:'branch-a',kind:'PAYABLE',description:'Energia da loja',amountCents:28000,dueDate:'2026-10-25'};
    const key=next();
    const first=await x.write('a','finance/entries',body,{key});
    assert.equal(first.status,201,first.body.error);
    const id=first.body.entry.id;
    assert.equal((await x.write('a','finance/entries',body,{key})).body.entry.id,id);
    const paymentKey=next();
    const partial=await x.write('a',`finance/entries/${id}/settle`,{branchId:'branch-a',amountCents:8000,method:'PIX'},{key:paymentKey});
    assert.equal(partial.status,200,partial.body.error);
    assert.equal(partial.body.settlement.entry.status,'PARTIAL');
    assert.equal(partial.body.settlement.entry.openCents,20000);
    const replay=await x.write('a',`finance/entries/${id}/settle`,{branchId:'branch-a',amountCents:8000,method:'PIX'},{key:paymentKey});
    assert.equal(replay.status,200);
    assert.equal((await x.write('a',`finance/entries/${id}/settle`,{branchId:'branch-a',amountCents:20001,method:'PIX'})).status,400);
    const paid=await x.write('a',`finance/entries/${id}/settle`,{branchId:'branch-a',amountCents:20000,method:'BANK_TRANSFER'});
    assert.equal(paid.status,200,paid.body.error);
    assert.equal(paid.body.settlement.entry.status,'SETTLED');
    assert.equal((await x.write('a',`finance/entries/${id}/cancel`,{branchId:'branch-a'})).status,409);
    const summary=await x.get('a','finance/summary?branchId=branch-a');
    assert.equal(summary.body.summary.payableSettledCents,28000);
    assert.equal(summary.body.summary.payableOpenCents,0);
    assert.equal((await x.get('b','finance/entries?branchId=branch-b',x.other)).body.entries.length,0);
    assert.equal((await x.get('a','finance/entries?branchId=branch-a',x.viewer)).status,200);
    assert.equal((await x.write('a','finance/entries',body,{who:x.viewer})).status,403);
    assert.equal((await x.write('b','finance/entries',body)).status,404);
    const count=await x.db.prepare('SELECT COUNT(*) AS n FROM finance_settlements').bind().first();
    assert.equal(count.n,2);
    await assert.rejects(x.db.prepare('UPDATE finance_settlements SET amount_cents=1').bind().run(),/IMMUTABLE/);
  }finally{x.close();}
});

test('P4 reports: summed sales, noncash breakdown and bounded CSV are tenant scoped and read-only',async()=>{
  const x=await setup();try{
    const pid=await x.id('Copo descartável','COPO01',10);
    await x.write('a','cash/open',{branchId:'branch-a',openingCents:100});
    const s=await x.write('a','sales',{branchId:'branch-a'});
    const id=s.body.sale.id;
    await x.write('a',`sales/${id}/items`,{branchId:'branch-a',productId:pid,quantity:2});
    const paid=await x.write('a',`sales/${id}/complete`,{branchId:'branch-a',payments:[{method:'PIX',amountCents:2000}]});
    assert.equal(paid.status,200,paid.body.error);
    const report=await x.get('a','reports/summary?branchId=branch-a&from=2026-10-17&to=2026-10-17');
    assert.equal(report.status,200,report.body.error);
    assert.equal(report.body.report.sales.totalCents,2000);
    assert.equal(report.body.report.sales.count,1);
    assert.equal(report.body.report.methodTotals[0].method,'PIX');
    assert.equal(report.body.report.methodTotals[0].amountCents,2000);
    assert.equal(report.body.report.products[0].quantity,2);
    const csv=await x.get('a','reports/sales.csv?branchId=branch-a&from=2026-10-17&to=2026-10-17');
    assert.equal(csv.status,200);
    assert.match(csv.body.csv,/COPO|W-/);
    assert.equal((await x.get('b','reports/summary?branchId=branch-b',x.other)).body.report.sales.count,0);
    assert.equal((await x.get('a','reports/summary?branchId=branch-a',x.viewer)).status,200);
    assert.equal((await x.get('a','reports/summary?branchId=branch-b')).status,404);
    assert.equal((await x.get('a','reports/summary?branchId=branch-a&from=invalid')).status,400);
  }finally{x.close();}
});

test('P6 weighted product uses canonical KG line, precise payment and stock',async()=>{
  const x=await setup();try{
    const p=await x.write('a','products',{branchId:'branch-a',name:'Queijo por peso',sku:'QUEIJO-KG',unit:'KG',salePriceCents:3990,trackStock:true});
    assert.equal(p.status,201,p.body.error);
    assert.equal(p.body.product.unit,'KG');
    const id=p.body.product.id;
    await x.write('a','inventory/receipts',{branchId:'branch-a',productId:id,quantity:5,type:'opening'});
    await x.write('a','cash/open',{branchId:'branch-a',openingCents:0});
    const saleId=(await x.write('a','sales',{branchId:'branch-a'})).body.sale.id;
    const key=next(), body={branchId:'branch-a',productId:id,grams:1250,source:'SCALE'};
    const one=await x.write('a','sales/'+saleId+'/items/weighted',body,{key});
    assert.equal(one.status,200,one.body.error);
    assert.equal(one.body.sale.items[0].quantity,1.25);
    assert.equal(one.body.sale.totalCents,4988);
    const repeat=await x.write('a','sales/'+saleId+'/items/weighted',body,{key});
    assert.equal(repeat.body.sale.items[0].quantity,1.25,'retry must not add twice');
    const audit=await x.db.prepare('SELECT result_json FROM commerce_mutations WHERE tenant_id=? AND scope=? AND mutation_id=?')
      .bind('a','sale.add-item:'+saleId,key).first();
    assert.equal(JSON.parse(audit.result_json).weightSource,'SCALE');
    assert.equal(JSON.parse(audit.result_json).grams,1250);
    const paid=await x.write('a','sales/'+saleId+'/complete',{branchId:'branch-a',payments:[{method:'PIX',amountCents:4988}]});
    assert.equal(paid.status,200,paid.body.error);
    assert.equal((await x.get('a','inventory?branchId=branch-a')).body.stock[0].quantity,3.75);
    assert.equal((await x.db.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE type='sale'").bind().first()).n,1);
  }finally{x.close();}
});

test('P6 invalid weights, non-KG items and other-tenant users are rejected',async()=>{
  const x=await setup();try{
    const kg=await x.write('a','products',{branchId:'branch-a',name:'Tomate',sku:'TOMATE-KG',unit:'KG',salePriceCents:1000});
    const un=await x.write('a','products',{branchId:'branch-a',name:'Sabonete',sku:'SABONETE',unit:'UN',salePriceCents:1000});
    const sid=(await x.write('a','sales',{branchId:'branch-a'})).body.sale.id;
    const path='sales/'+sid+'/items/weighted';
    assert.equal((await x.write('a',path,{branchId:'branch-a',productId:kg.body.product.id,grams:1.25,source:'SCALE'})).status,400);
    assert.equal((await x.write('a',path,{branchId:'branch-a',productId:kg.body.product.id,grams:-10,source:'MANUAL'})).status,400);
    assert.equal((await x.write('a',path,{branchId:'branch-a',productId:kg.body.product.id,grams:150,source:'UNTRUSTED'})).status,400);
    assert.equal((await x.write('a',path,{branchId:'branch-a',productId:un.body.product.id,grams:150,source:'MANUAL'})).status,400);
    assert.equal((await x.write('b',path,{branchId:'branch-b',productId:kg.body.product.id,grams:150,source:'SCALE'},{who:x.other})).status,404);
    assert.equal((await x.write('a',path,{branchId:'branch-a',productId:kg.body.product.id,grams:150,source:'SCALE'},{who:x.viewer})).status,403);
    assert.equal((await x.get('a','sales/'+sid+'?branchId=branch-a')).body.sale.items.length,0);
  }finally{x.close();}
});


test('P6 gram-denominated weighted product prices in grams without kilogram conversion',async()=>{
  const x=await setup();try{
    const p=await x.write('a','products',{branchId:'branch-a',name:'Tempero por grama',sku:'TEMPERO-G',unit:'G',salePriceCents:10});
    assert.equal(p.status,201,p.body.error);
    await x.write('a','inventory/receipts',{branchId:'branch-a',productId:p.body.product.id,quantity:1000,type:'opening'});
    const sale=(await x.write('a','sales',{branchId:'branch-a'})).body.sale.id;
    const added=await x.write('a','sales/'+sale+'/items/weighted',{branchId:'branch-a',productId:p.body.product.id,grams:125,source:'MANUAL'});
    assert.equal(added.status,200,added.body.error);
    assert.equal(added.body.sale.items[0].quantity,125);
    assert.equal(added.body.sale.totalCents,1250);
  }finally{x.close();}
});

test('Desktop parity: price override requires manager permission and preserves original SKU/price in immutable audit',async()=>{
  const x=await setup();try{
    const pid=await x.id('Teclado Mecânico','TECLA-01',8);
    const opened=await x.write('a','sales',{branchId:'branch-a'});
    const sid=opened.body.sale.id;
    const added=await x.write('a',`sales/${sid}/items`,{branchId:'branch-a',productId:pid,quantity:2});
    assert.equal(added.status,200,added.body.error);
    const itemId=added.body.sale.items[0].id;
    const mutation=next();
    const uri=`sales/${sid}/items/${itemId}/price`;
    const body={branchId:'branch-a',unitPriceCents:850,reason:'Promoção autorizada pelo gerente'};
    assert.equal((await x.write('a',uri,body,{who:x.viewer,method:'PUT'})).status,403);
    assert.equal((await x.write('a',uri,{...body,reason:'a'},{method:'PUT'})).status,400);
    assert.equal((await x.write('a',uri,{...body,reason:'teste'},{who:x.other,method:'PUT'})).status,404);
    const changed=await x.write('a',uri,body,{key:mutation,method:'PUT'});
    assert.equal(changed.status,200,JSON.stringify(changed.body));
    assert.equal(changed.body.sale.items[0].unitPriceCents,850);
    assert.equal(changed.body.sale.items[0].catalogUnitPriceCents,1000);
    assert.equal(changed.body.sale.items[0].priceOverrideReason,body.reason);
    assert.equal(changed.body.sale.totalCents,1700);
    const replay=await x.write('a',uri,body,{key:mutation,method:'PUT'});
    assert.equal(replay.status,200);
    assert.equal(replay.body.sale.totalCents,1700);
    let rows=await x.db.prepare('SELECT old_price_cents AS old,new_price_cents AS next,reason FROM sale_item_price_overrides').bind().all();
    assert.equal(rows.results.length,1);
    assert.equal(rows.results[0].old,1000);
    assert.equal(rows.results[0].next,850);
    await assert.rejects(x.db.prepare('DELETE FROM sale_item_price_overrides').bind().run(),/IMMUTABLE/);
    await x.write('a','cash/open',{branchId:'branch-a',openingCents:0});
    const paid=await x.write('a',`sales/${sid}/complete`,{branchId:'branch-a',payments:[{method:'PIX',amountCents:1700}]});
    assert.equal(paid.status,200,paid.body.error);
    assert.equal((await x.write('a',uri,{...body,unitPriceCents:750},{method:'PUT'})).status,409);
    const result=await x.get('a',`sales/${sid}?branchId=branch-a`);
    assert.equal(result.body.sale.items[0].catalogUnitPriceCents,1000);
    assert.equal(result.body.sale.items[0].unitPriceCents,850);
  }finally{x.close();}
});

test('Desktop parity: stock adjustment has signed immutable ledger, reason, idempotency, oversell protection and filters',async()=>{
  const x=await setup();try{
    const pid=await x.id('Pote de vidro','POTE01',3.125);
    const path='inventory/adjustments';
    const key=next();
    const negative={branchId:'branch-a',productId:pid,quantityDelta:-1.125,reason:'Perda operacional validada'};
    assert.equal((await x.write('a',path,negative,{who:x.viewer})).status,403);
    assert.equal((await x.write('b',path,negative)).status,404);
    assert.equal((await x.write('a',path,{...negative,reason:'a'})).status,400);
    const moved=await x.write('a',path,negative,{key});
    assert.equal(moved.status,201,moved.body.error);
    assert.equal((await x.write('a',path,negative,{key})).body.movement.movementId,moved.body.movement.movementId);
    const stock=await x.get('a','inventory?branchId=branch-a');
    assert.equal(stock.body.stock[0].quantity,2);
    const failed=await x.write('a',path,{...negative,quantityDelta:-3});
    assert.equal(failed.status,409,JSON.stringify(failed.body));
    assert.equal((await x.get('a','inventory?branchId=branch-a')).body.stock[0].quantity,2);
    const records=await x.get('a',`inventory/movements?branchId=branch-a&productId=${pid}&limit=10`);
    assert.equal(records.status,200,JSON.stringify(records.body));
    assert.equal(records.body.movements.total,2);
    assert.equal(records.body.movements.items[0].quantityDelta,-1.125);
    assert.equal(records.body.movements.items[0].reason,negative.reason);
    assert.equal((await x.get('a','inventory/movements?branchId=branch-a&type=invalid')).status,400);
    assert.equal((await x.get('a','inventory/movements?branchId=branch-b')).status,404);
    assert.equal((await x.get('b','inventory/movements?branchId=branch-b',x.other)).body.movements.total,0);
    const count=await x.db.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE type='adjustment'").bind().first();
    assert.equal(count.n,1);
  }finally{x.close();}
});

test('Desktop parity: paginated sale history scopes status, date, operator, search, offset and tenant',async()=>{
  const x=await setup();try{
    const open1=await x.write('a','sales',{branchId:'branch-a'});
    const open2=await x.write('a','sales',{branchId:'branch-a'});
    assert.equal(open1.status,201);assert.equal(open2.status,201);
    const sid=open1.body.sale.id;
    const suspended=await x.write('a',`sales/${sid}/suspend`,{branchId:'branch-a'});
    assert.equal(suspended.status,200,suspended.body.error);
    const complete=await x.get('a','sales/history?branchId=branch-a&status=COMPLETED');
    assert.equal(complete.status,200);assert.equal(complete.body.history.total,0);
    const one=await x.get('a','sales/history?branchId=branch-a&status=OPEN&limit=1');
    assert.equal(one.status,200,JSON.stringify(one.body));
    assert.equal(one.body.history.total,1);
    assert.equal(one.body.history.items[0].status,'OPEN');
    const all=await x.get('a','sales/history?branchId=branch-a&limit=1&offset=1');
    assert.equal(all.body.history.total,2);
    assert.equal(all.body.history.items.length,1);
    const num=open1.body.sale.saleNumber;
    const searched=await x.get('a',`sales/history?branchId=branch-a&query=${encodeURIComponent(num)}`);
    assert.equal(searched.body.history.total,1);
    assert.equal(searched.body.history.items[0].id,sid);
    const someone=await x.get('a','sales/history?branchId=branch-a&operatorId=other');
    assert.equal(someone.body.history.total,0);
    const today=new Date().toISOString().slice(0,10);
    const time=await x.get('a',`sales/history?branchId=branch-a&from=${today}&to=${today}`);
    assert.equal(time.body.history.total,2);
    assert.equal((await x.get('a','sales/history?branchId=branch-a&limit=101')).status,400);
    assert.equal((await x.get('a','sales/history?branchId=branch-a&status=MADEUP')).status,400);
    assert.equal((await x.get('a','sales/history?branchId=branch-b')).status,404);
    assert.equal((await x.get('b','sales/history?branchId=branch-b',x.other)).body.history.total,0);
    assert.equal((await x.get('a','sales/history?branchId=branch-a',x.viewer)).status,200);
  }finally{x.close();}
});

test('product editing and deactivation retain canonical sale snapshots, enforce tenant RBAC and idempotency',async()=>{
  const x=await setup();try{
    const created=await x.write('a','products',{branchId:'branch-a',name:'Produto Original',sku:'ORIG1',salePriceCents:1000,unit:'UN',trackStock:false});
    assert.equal(created.status,201,created.body.error);
    const id=created.body.product.id;
    const open=await x.write('a','sales',{branchId:'branch-a'});
    assert.equal(open.status,201,open.body.error);
    await x.write('a',`sales/${open.body.sale.id}/items`,{branchId:'branch-a',productId:id,quantity:1});
    const body={branchId:'branch-a',name:'Produto Atualizado',sku:'NEW1',salePriceCents:2400,unit:'UN',active:false};
    const path=`products/${id}`,key=next();
    assert.equal((await x.write('a',path,body,{method:'PATCH'})).status,409,'Open sales must block deactivation');
    await x.write('a','cash/open',{branchId:'branch-a',openingCents:0});
    const done=await x.write('a',`sales/${open.body.sale.id}/complete`,{branchId:'branch-a',payments:[{method:'PIX',amountCents:1000}]});
    assert.equal(done.status,200,JSON.stringify(done.body));
    assert.equal((await x.write('a',path,{branchId:'branch-a',unit:'KG'},{method:'PATCH'})).status,409,'Historic unit must not be silently converted');
    await assert.rejects(x.db.prepare('UPDATE products SET unit=? WHERE tenant_id=? AND id=?').bind('KG','a',id).run(),/PRODUCT_UNIT_WITH_HISTORY/);
    assert.equal((await x.write('a',path,body,{who:x.viewer,method:'PATCH'})).status,403);
    assert.equal((await x.write('b',path,{...body,branchId:'branch-b'},{who:x.other,method:'PATCH'})).status,404);
    assert.equal((await x.write('a',path,{...body,name:'A'},{method:'PATCH'})).status,400);
    assert.equal((await x.write('a',path,{...body,unit:'INVALID'},{method:'PATCH'})).status,400);
    const updated=await x.write('a',path,body,{method:'PATCH',key});
    assert.equal(updated.status,200,JSON.stringify(updated.body));
    assert.equal(updated.body.product.name,'Produto Atualizado');
    assert.equal(updated.body.product.salePriceCents,2400);
    assert.equal(updated.body.product.active,false);
    const repeated=await x.write('a',path,body,{method:'PATCH',key});
    assert.deepEqual(repeated.body,updated.body);
    assert.equal((await x.get('a','products?branchId=branch-a')).body.products.length,0);
    assert.equal((await x.get('a','products?branchId=branch-a&includeInactive=true',x.viewer)).status,403);
    const inactive=await x.get('a','products?branchId=branch-a&includeInactive=true');
    assert.equal(inactive.body.products.length,1);
    assert.equal(inactive.body.products[0].active,false);
    const archived=await x.get('a',`sales/${open.body.sale.id}?branchId=branch-a`);
    assert.equal(archived.body.sale.items[0].productName,'Produto Original');
    assert.equal(archived.body.sale.items[0].unitPriceCents,1000);
    const reactivated=await x.write('a',path,{branchId:'branch-a',active:true},{method:'PATCH'});
    assert.equal(reactivated.status,200,JSON.stringify(reactivated.body));
    assert.equal((await x.get('a','products?branchId=branch-a')).body.products[0].sku,'NEW1');
  }finally{x.close();}
});

test('inventory transfer moves one immutable stock quantity across two tenant branches atomically',async()=>{
  const x=await setup();try{
    await x.db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)')
      .bind('branch-a-2','a','ALT','Filial 2',date).run();
    const pid=await x.id('Caixa de materiais','TRANSFER1',3.125);
    const path='inventory/transfers';
    const body={branchId:'branch-a',toBranchId:'branch-a-2',productId:pid,quantity:1.125,reason:'Reposição entre filiais'};
    assert.equal((await x.write('a',path,body,{who:x.viewer})).status,403);
    assert.equal((await x.write('a',path,{...body,toBranchId:'branch-b'})).status,404);
    assert.equal((await x.write('a',path,{...body,toBranchId:'branch-a'})).status,400);
    assert.equal((await x.write('a',path,{...body,quantity:0})).status,400);
    const key=next();
    const first=await x.write('a',path,body,{key});
    assert.equal(first.status,201,JSON.stringify(first.body));
    const again=await x.write('a',path,body,{key});
    assert.deepEqual(again.body,first.body);
    const src=await x.get('a','inventory?branchId=branch-a');
    const dst=await x.get('a','inventory?branchId=branch-a-2');
    assert.equal(src.body.stock[0].quantity,2);
    assert.equal(dst.body.stock[0].quantity,1.125);
    assert.equal((await x.write('a',path,{...body,quantity:5})).status,409);
    assert.equal((await x.get('a','inventory?branchId=branch-a')).body.stock[0].quantity,2);
    assert.equal((await x.get('a','inventory?branchId=branch-a-2')).body.stock[0].quantity,1.125);
    const history=await x.get('a','inventory/transfers?branchId=branch-a-2');
    assert.equal(history.status,200,JSON.stringify(history.body));
    assert.equal(history.body.transfers.length,1);
    const records=await x.db.prepare('SELECT count(*) AS n FROM inventory_transfers WHERE tenant_id=?').bind('a').first();
    assert.equal(records.n,1);
    await assert.rejects(x.db.prepare('DELETE FROM inventory_transfers').bind().run(),/IMMUTABLE/);
  }finally{x.close();}
});
