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
const catalog=readFileSync(new URL('../migrations/0009_catalog_inventory.sql',import.meta.url),'utf8');
const purchasing=readFileSync(new URL('../migrations/0010_purchase_orders.sql',import.meta.url),'utf8');
const media=readFileSync(new URL('../migrations/0011_product_media.sql',import.meta.url),'utf8');
const notesMigration=readFileSync(new URL('../migrations/0012_sale_item_notes.sql',import.meta.url),'utf8');
const cashTerminalMigration=readFileSync(new URL('../migrations/0013_cash_terminals.sql',import.meta.url),'utf8');
const checkoutConfigurationMigration=readFileSync(new URL('../migrations/0014_checkout_configurations.sql',import.meta.url),'utf8');
const salesTargetsMigration=readFileSync(new URL('../migrations/0015_seller_sales_targets.sql',import.meta.url),'utf8');
const minimumMigration=readFileSync(new URL('../migrations/0016_inventory_minimum_levels.sql',import.meta.url),'utf8');
const minimumMigration=readFileSync(new URL('../migrations/0016_inventory_minimum_levels.sql',import.meta.url),'utf8');
// A fixed business date must reach the commerce adapter, not only session authentication.
// Otherwise UTC midnight makes period-filtered reports silently disappear in CI.
const NOW=Date.parse('2026-10-17T14:00:00Z');
const date='2026-10-17T14:00:00.000Z';
const password='SafeTestPasswordForPdv2026!';
let num=0;
const next=()=>('mutation-'+(++num)+'-long');
async function setup(){
  const db=openLocalDatabase();db.exec(identity);db.exec(commerce);db.exec(finance);db.exec(vertical);db.exec(parity);db.exec(transfers);db.exec(reversals);db.exec(catalog);db.exec(purchasing);db.exec(media);db.exec(notesMigration);db.exec(cashTerminalMigration);db.exec(checkoutConfigurationMigration);db.exec(salesTargetsMigration);db.exec(minimumMigration);db.exec(minimumMigration);
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

test('P3 discount matches desktop clamping, persists the applied cents and enforces RBAC',async()=>{
  const x=await setup();try{
    const pid=await x.id('Discountable item','DISC-BOUND',2);
    const opened=await x.write('a','sales',{branchId:'branch-a'});
    assert.equal(opened.status,201,opened.body.error);
    const sid=opened.body.sale.id,path=`sales/${sid}/discount`;
    const first=await x.write('a',`sales/${sid}/items`,{branchId:'branch-a',productId:pid,quantity:1});
    assert.equal(first.body.sale.subtotalCents,1000);
    const valid=await x.write('a',path,{branchId:'branch-a',discountCents:350});
    assert.equal(valid.status,200,valid.body.error);
    assert.equal(valid.body.sale.totalCents,650);
    const capped=await x.write('a',path,{branchId:'branch-a',discountCents:1001});
    assert.equal(capped.status,200,capped.body.error);
    assert.equal(capped.body.sale.discountCents,1000,'Desktop clamps excess to the subtotal');
    const stored=await x.db.prepare('SELECT discount_cents AS discountCents FROM sales WHERE id=?').bind(sid).first();
    assert.equal(stored.discountCents,1000,'Never retain unapplied discount that could leak into subsequent items');
    const extra=await x.write('a',`sales/${sid}/items`,{branchId:'branch-a',productId:pid,quantity:1});
    assert.equal(extra.status,200,extra.body.error);
    assert.equal(extra.body.sale.subtotalCents,2000);
    assert.equal(extra.body.sale.discountCents,1000,'New items cannot retroactively inflate an earlier discount');
    assert.equal(extra.body.sale.totalCents,1000);
    assert.equal((await x.write('a',path,{branchId:'branch-a',discountCents:25},{who:x.viewer})).status,403);
    assert.equal((await x.write('b',path,{branchId:'branch-b',discountCents:25},{who:x.other})).status,404);
    assert.equal((await x.write('a',path,{branchId:'branch-a',discountCents:-1})).status,400);
    assert.equal((await x.write('a',path,{branchId:'branch-a',discountCents:1.5})).status,400);
    const full=await x.write('a',path,{branchId:'branch-a',discountCents:2000});
    assert.equal(full.status,200,full.body.error);
    assert.equal(full.body.sale.totalCents,0,'A 100% discount remains valid when authorized');
    const reduced=await x.write('a',`sales/${sid}/items/${pid}`,{branchId:'branch-a',quantity:1},{method:'PUT'});
    assert.equal(reduced.status,200,reduced.body.error);
    assert.equal(reduced.body.sale.discountCents,1000);
    assert.equal((await x.db.prepare('SELECT discount_cents AS v FROM sales WHERE id=?').bind(sid).first()).v,1000,
      'A reduced line must persist the new cap, just like desktop recalculate()');
    const readded=await x.write('a',`sales/${sid}/items`,{branchId:'branch-a',productId:pid,quantity:1});
    assert.equal(readded.body.sale.discountCents,1000,'Adding items again must not resurrect the old excess');
    assert.equal(readded.body.sale.totalCents,1000);
    const removed=await x.write('a',`sales/${sid}/items/${pid}`,{branchId:'branch-a'},{method:'DELETE'});
    assert.equal(removed.status,200,removed.body.error);
    assert.equal(removed.body.sale.discountCents,0,'Empty cart resets applied discount');
    assert.equal((await x.db.prepare('SELECT discount_cents AS v FROM sales WHERE id=?').bind(sid).first()).v,0);
    const newItem=await x.write('a',`sales/${sid}/items`,{branchId:'branch-a',productId:pid,quantity:1});
    assert.equal(newItem.body.sale.totalCents,1000,'Discount does not reappear on the next cart');
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
    const today=date.slice(0,10);
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

test('P3 history supports seller, customer, product and payment filter with tenant-scoped page totals',async()=>{
 const x=await setup();try{
  const p1=await x.id('Cafe A','HISTORY-A',5);
  const p2=await x.id('Cafe B','HISTORY-B',5);
  await x.write('a','cash/open',{branchId:'branch-a',openingCents:100});
  const customer=await x.write('a','customers',{branchId:'branch-a',name:'Cliente Filtro'});
  assert.equal(customer.status,201,JSON.stringify(customer.body));
  async function sale(pid,sellerId,customerId,method){
   const opened=await x.write('a','sales',{branchId:'branch-a'});const id=opened.body.sale.id;
   if(sellerId)assert.equal((await x.write('a','sales/'+id+'/seller',{branchId:'branch-a',sellerId})).status,200);
   if(customerId)assert.equal((await x.write('a','sales/'+id+'/customer',{branchId:'branch-a',customerId})).status,200);
   await x.write('a','sales/'+id+'/items',{branchId:'branch-a',productId:pid,quantity:1});
   assert.equal((await x.write('a','sales/'+id+'/complete',{branchId:'branch-a',payments:[{method,amountCents:1000}]})).status,200);
   return id;
  }
  const a=await sale(p1,'viewer',customer.body.customer.id,'PIX');
  await sale(p2,'owner',null,'CASH');
  const query=(param)=>x.get('a','sales/history?branchId=branch-a&'+param);
  for(const param of ['sellerId=viewer','customerId='+customer.body.customer.id,
   'productId='+p1,'paymentMethod=PIX']){
   const r=await query(param);assert.equal(r.status,200,JSON.stringify(r.body));
   assert.equal(r.body.history.total,1,param);
   assert.equal(r.body.history.items[0].id,a,param);
  }
  const combined=await query('sellerId=viewer&customerId='+customer.body.customer.id+'&paymentMethod=PIX&limit=1&offset=0');
  assert.equal(combined.body.history.total,1);
  assert.equal((await query('sellerId=viewer&paymentMethod=CASH')).body.history.total,0);
  assert.equal((await query('paymentMethod=RANDOM')).status,400);
  assert.equal((await x.get('b','sales/history?branchId=branch-b&productId='+p1,x.other)).body.history.total,0);
 }finally{x.close();}
});

test('P3 full cash register search filters status/operator/time and paginates without changing legacy session list',async()=>{
 const x=await setup();try{
  const one=await x.write('a','cash/open',{branchId:'branch-a',openingCents:100});
  assert.equal(one.status,201,JSON.stringify(one.body));
  await x.write('a','cash/sessions/'+one.body.session.id+'/close',{branchId:'branch-a',countedCashCents:100});
  const two=await x.write('a','cash/open',{branchId:'branch-a',openingCents:200});
  assert.equal(two.status,201,JSON.stringify(two.body));
  const search=(args='')=>x.get('a','cash/sessions/search?branchId=branch-a&'+args);
  const closed=await search('status=CLOSED&operatorId=owner&from=2026-10-17&to=2026-10-17');
  assert.equal(closed.status,200,JSON.stringify(closed.body));
  assert.equal(closed.body.history.total,1);
  assert.equal(closed.body.history.items[0].id,one.body.session.id);
  const all=await search('limit=1&offset=1');
  assert.equal(all.body.history.total,2);
  assert.equal(all.body.history.items.length,1);
  assert.equal((await search('status=INVALID')).status,400);
  assert.equal((await x.get('a','cash/sessions?branchId=branch-a')).body.sessions.length,2);
  assert.equal((await x.get('b','cash/sessions/search?branchId=branch-b',x.other)).body.history.total,0);
 }finally{x.close();}
});

test('P4 comparative report compares periods with no division by zero or cross-tenant leak',async()=>{
 const x=await setup();try{
  const pid=await x.id('Comparativo','REPORT-P',3);
  await x.write('a','cash/open',{branchId:'branch-a',openingCents:0});
  const s=await x.write('a','sales',{branchId:'branch-a'});
  await x.write('a','sales/'+s.body.sale.id+'/items',{branchId:'branch-a',productId:pid,quantity:1});
  await x.write('a','sales/'+s.body.sale.id+'/complete',{branchId:'branch-a',payments:[{method:'PIX',amountCents:1000}]});
  const r=await x.get('a','reports/compare?branchId=branch-a&from=2026-10-17&to=2026-10-17&compareFrom=2026-10-16&compareTo=2026-10-16');
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.comparison.current.sales.totalCents,1000);
  assert.equal(r.body.comparison.previous.sales.totalCents,0);
  assert.equal(r.body.comparison.delta.totalCents,1000);
  assert.equal(r.body.comparison.delta.percentage,null,'no divide-by-zero percentage');
  assert.equal((await x.get('b','reports/compare?branchId=branch-b&from=2026-10-17&to=2026-10-17',x.other)).status,400);
  assert.equal((await x.get('a','reports/compare?branchId=branch-b&from=2026-10-17&to=2026-10-17&compareFrom=2026-10-16&compareTo=2026-10-16')).status,404);
 }finally{x.close();}
});

test('P4 historical margin snapshots cost at sale time, correctly nets refunds, and never rewrites cost after a later purchase',async()=>{
 const x=await setup();try{
  const product=(await x.write('a','products',{branchId:'branch-a',sku:'MARGIN-1',name:'Produto com custo',salePriceCents:1000,trackStock:true})).body.product;
  await x.write('a','inventory/receipts',{branchId:'branch-a',productId:product.id,quantity:3,unitCostCents:400});
  await x.write('a','cash/open',{branchId:'branch-a',openingCents:1000});
  const sale=(await x.write('a','sales',{branchId:'branch-a'})).body.sale;
  await x.write('a','sales/'+sale.id+'/items',{branchId:'branch-a',productId:product.id,quantity:2});
  await x.write('a','sales/'+sale.id+'/complete',{branchId:'branch-a',payments:[{method:'PIX',amountCents:2000}]});
  const path='reports/margins?branchId=branch-a&from=2026-10-17&to=2026-10-17';
  const original=await x.get('a',path);
  assert.equal(original.status,200,JSON.stringify(original.body));
  assert.equal(original.body.margin.revenueCents,2000);
  assert.equal(original.body.margin.costCents,800);
  assert.equal(original.body.margin.marginCents,1200);
  await x.write('a','inventory/receipts',{branchId:'branch-a',productId:product.id,quantity:1,unitCostCents:850});
  const afterPurchase=(await x.get('a',path)).body.margin;
  assert.equal(afterPurchase.costCents,800,'historical cost snapshots must not change after new acquisitions');
  const detail=(await x.get('a','sales/'+sale.id+'?branchId=branch-a')).body.sale;
  const ret=await x.write('a','sales/'+sale.id+'/returns',{
   branchId:'branch-a',reason:'Devolução de uma unidade',
   items:[{saleItemId:detail.items[0].id,quantity:1}],refunds:[{method:'PIX',amountCents:1000}]});
  assert.equal(ret.status,201,JSON.stringify(ret.body));
  const net=(await x.get('a',path)).body.margin;
  assert.equal(net.revenueCents,1000);
  assert.equal(net.costCents,400);
  assert.equal(net.marginCents,600);
  assert.equal(net.products.find(p=>p.productId===product.id).returnedCents,1000);
  assert.equal((await x.get('a','reports/margins?branchId=branch-b',x.other)).status,404);
 }finally{x.close();}
});

test('P4 historical margin does not claim proven profit for products without recorded acquisition costs',async()=>{
 const x=await setup();try{
  const product=await x.id('Custo desconhecido','COST-UNKNOWN',2);
  await x.write('a','cash/open',{branchId:'branch-a',openingCents:0});
  const opened=(await x.write('a','sales',{branchId:'branch-a'})).body.sale;
  await x.write('a','sales/'+opened.id+'/items',{branchId:'branch-a',productId:product,quantity:1});
  await x.write('a','sales/'+opened.id+'/complete',{branchId:'branch-a',payments:[{method:'PIX',amountCents:1000}]});
  const result=await x.get('a','reports/margins?branchId=branch-a&from=2026-10-17&to=2026-10-17');
  assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(result.body.margin.missingCostLines,1);
  assert.equal(result.body.margin.marginCents,null);
  assert.equal(result.body.margin.products.find(x=>x.productId===product).marginCents,null);
 }finally{x.close();}
});

test('P4 detailed report applies canonical seller/customer/product/payment filters and paginates before export',async()=>{
 const x=await setup();try{
  const p=await x.id('Relatório P4','RPT-DET-1',8);
  await x.write('a','cash/open',{branchId:'branch-a',openingCents:100});
  const first=(await x.write('a','sales',{branchId:'branch-a'})).body.sale;
  await x.write('a','sales/'+first.id+'/seller',{branchId:'branch-a',sellerId:'viewer'});
  await x.write('a','sales/'+first.id+'/items',{branchId:'branch-a',productId:p,quantity:2});
  await x.write('a','sales/'+first.id+'/complete',{branchId:'branch-a',payments:[{method:'PIX',amountCents:2000}]});
  const second=(await x.write('a','sales',{branchId:'branch-a'})).body.sale;
  await x.write('a','sales/'+second.id+'/items',{branchId:'branch-a',productId:p,quantity:1});
  await x.write('a','sales/'+second.id+'/complete',{branchId:'branch-a',payments:[{method:'CASH',amountCents:1000}]});
  const query='branchId=branch-a&from=2026-10-17&to=2026-10-17&sellerId=viewer&productId='+p+'&paymentMethod=PIX';
  const detailed=await x.get('a','reports/details?'+query);
  assert.equal(detailed.status,200,JSON.stringify(detailed.body));
  assert.equal(detailed.body.details.total,1);
  assert.equal(detailed.body.details.items[0].id,first.id);
  assert.equal(detailed.body.details.items[0].items[0].quantity,2);
  const csv=await x.get('a','reports/details.csv?'+query);
  assert.equal(csv.status,200,JSON.stringify(csv.body));
  assert.match(csv.body.csv,/RPT-DET-1/);
  assert.match(csv.body.csv,/PIX/);
  assert.doesNotMatch(csv.body.csv,/CASH/);
  assert.equal((await x.get('b','reports/details?branchId=branch-b',x.other)).body.details.total,0);
  assert.equal((await x.get('a','reports/details?branchId=branch-b')).status,404);
  assert.equal((await x.get('a','reports/details.csv?branchId=branch-a&paymentMethod=INVALID')).status,400);
 }finally{x.close();}
});
test('P4 stock coverage derives reserved availability and demand from immutable movement history, not static defaults',async()=>{
 const x=await setup();try{
  const p=await x.id('Produto de cobertura','RPT-COVER',5);
  await x.write('a','cash/open',{branchId:'branch-a',openingCents:100});
  const s=(await x.write('a','sales',{branchId:'branch-a'})).body.sale;
  await x.write('a','sales/'+s.id+'/items',{branchId:'branch-a',productId:p,quantity:2});
  await x.write('a','sales/'+s.id+'/complete',{branchId:'branch-a',payments:[{method:'PIX',amountCents:2000}]});
  const reserve=await x.write('a','inventory/reservations',{branchId:'branch-a',productId:p,quantity:1,reason:'Separado para retirada'});
  assert.equal(reserve.status,201,JSON.stringify(reserve.body));
  const report=await x.get('a','reports/stock-coverage?branchId=branch-a&asOf=2026-10-17&days=30');
  assert.equal(report.status,200,JSON.stringify(report.body));
  const line=report.body.coverage.products.find(row=>row.productId===p);
  assert.equal(line.quantity,3);
  assert.equal(line.reserved,1);
  assert.equal(line.available,2);
  assert.equal(line.consumed,2);
  assert.equal(line.daysCoverage,30);
  assert.equal(line.minimumQuantity,null,'no invented minimum quantity for products without policy');
  assert.equal((await x.get('b','reports/stock-coverage?branchId=branch-b&asOf=2026-10-17',x.other)).body.coverage.products.length,0);
  assert.equal((await x.get('a','reports/stock-coverage?branchId=branch-a&days=0')).status,400);
 }finally{x.close();}
});

test('P5 daily trend is zero-filled, uses canonical completed sales, validates period and isolates tenants',async()=>{
 const x=await setup();try{
  const p=await x.id('Tendência comprovada','P5-TREND',2);
  await x.write('a','cash/open',{branchId:'branch-a',openingCents:0});
  const s=(await x.write('a','sales',{branchId:'branch-a'})).body.sale;
  await x.write('a','sales/'+s.id+'/items',{branchId:'branch-a',productId:p,quantity:1});
  const paid=await x.write('a','sales/'+s.id+'/complete',
    {branchId:'branch-a',payments:[{method:'PIX',amountCents:1000}]});
  assert.equal(paid.status,200,paid.body.error);
  const url='reports/daily-trend?branchId=branch-a&from=2026-10-16&to=2026-10-18';
  const response=await x.get('a',url);
  assert.equal(response.status,200,JSON.stringify(response.body));
  assert.deepEqual(response.body.trend.points.map(p=>p.date),['2026-10-16','2026-10-17','2026-10-18']);
  assert.deepEqual(response.body.trend.points.map(p=>p.netCents),[0,1000,0]);
  assert.equal(response.body.trend.points[1].count,1);
  const other=await x.get('b','reports/daily-trend?branchId=branch-b&from=2026-10-16&to=2026-10-18',x.other);
  assert.equal(other.status,200);
  assert.equal(other.body.trend.points.reduce((n,p)=>n+p.netCents,0),0);
  assert.equal((await x.get('a','reports/daily-trend?branchId=branch-b&from=2026-10-16&to=2026-10-18')).status,404);
  assert.equal((await x.get('a','reports/daily-trend?branchId=branch-a&from=2026-01-01&to=2026-10-18')).status,400);
  assert.equal((await x.get('a','reports/daily-trend?branchId=branch-a&from=2026-10-18&to=2026-10-17')).status,400);
  assert.equal((await x.get('a','reports/daily-trend?branchId=branch-a&from=2026-02-30&to=2026-03-01')).status,400);
 }finally{x.close();}
});

test('P5 minimum stock settings are validated, atomic, idempotent and tenant/branch/RBAC isolated',async()=>{
 const x=await setup();try{
  const p=await x.id('Item com mínimo','P5-MIN',5);
  const route='reports/stock-minimum';
  const report=()=>x.get('a','reports/stock-coverage?branchId=branch-a&asOf=2026-10-17&days=30');
  const find=async()=>((await report()).body.coverage.products.find(item=>item.productId===p));
  assert.equal((await find()).minimumQuantity,null);
  const key=next();
  const configured=await x.write('a',route,{branchId:'branch-a',productId:p,minimumQuantity:6},{method:'PUT',key});
  assert.equal(configured.status,200,JSON.stringify(configured.body));
  assert.equal(configured.body.minimum.minimumQuantity,6);
  const replay=await x.write('a',route,{branchId:'branch-a',productId:p,minimumQuantity:6},{method:'PUT',key});
  assert.deepEqual(replay.body,configured.body);
  const under=await report(),row=under.body.coverage.products.find(item=>item.productId===p);
  assert.equal(row.minimumStatus,'BELOW_MINIMUM');
  assert.equal(under.body.coverage.belowMinimum,1);
  assert.equal(under.body.coverage.unknownMinimum,0);
  assert.equal((await x.write('a',route,{branchId:'branch-a',productId:p,minimumQuantity:0},{method:'PUT',who:x.viewer})).status,403);
  assert.equal((await x.write('b',route,{branchId:'branch-b',productId:p,minimumQuantity:4},{method:'PUT',who:x.other})).status,404);
  assert.equal((await x.write('a',route,{branchId:'branch-b',productId:p,minimumQuantity:4},{method:'PUT'})).status,404);
  assert.equal((await x.write('a',route,{branchId:'branch-a',productId:p,minimumQuantity:-1},{method:'PUT'})).status,400);
  assert.equal((await x.write('a',route,{branchId:'branch-a',productId:p,minimumQuantity:0.0001},{method:'PUT'})).status,400);
  assert.equal((await x.write('a',route,{branchId:'branch-a',productId:p,minimumQuantity:'5'},{method:'PUT'})).status,400);
  assert.equal((await x.write('a',route,{branchId:'branch-a',productId:p,minimumQuantity:5},{method:'PUT'})).status,200);
  assert.equal((await find()).minimumStatus,'AT_MINIMUM');
  assert.equal((await x.write('a',route,{branchId:'branch-a',productId:p,minimumQuantity:2},{method:'PUT'})).status,200);
  assert.equal((await find()).minimumStatus,'ABOVE_MINIMUM');
  assert.equal((await x.write('a',route,{branchId:'branch-a',productId:p,minimumQuantity:null},{method:'PUT'})).status,200);
  assert.equal((await find()).minimumStatus,'NOT_CONFIGURED');
  assert.equal((await x.get('b','reports/stock-coverage?branchId=branch-b&asOf=2026-10-17',x.other)).body.coverage.products.length,0);
 }finally{x.close();}
});

test('P3 line note is atomic and idempotent, preserved in completed sale and cannot be edited afterwards',async()=>{
 const x=await setup();try{
  const product=await x.id('Suco natural','ITEM-NOTE',5);
  await x.write('a','cash/open',{branchId:'branch-a',openingCents:0});
  const sale=(await x.write('a','sales',{branchId:'branch-a'})).body.sale;
  const added=await x.write('a','sales/'+sale.id+'/items',{branchId:'branch-a',productId:product,quantity:1});
  const item=added.body.sale.items[0];const url='sales/'+sale.id+'/items/'+item.id+'/note';
  const mutation=next();
  const updated=await x.write('a',url,{branchId:'branch-a',note:'Sem gelo; com limão'},{method:'PUT',key:mutation});
  assert.equal(updated.status,200,JSON.stringify(updated.body));
  assert.equal(updated.body.sale.items[0].note,'Sem gelo; com limão');
  const replay=await x.write('a',url,{branchId:'branch-a',note:'Sem gelo; com limão'},{method:'PUT',key:mutation});
  assert.deepEqual(replay.body,updated.body);
  assert.equal((await x.write('a',url,{branchId:'branch-a',note:'hack'},{method:'PUT',who:x.viewer})).status,403);
  assert.equal((await x.write('a',url,{branchId:'branch-b',note:'hack'},{method:'PUT'})).status,404);
  assert.equal((await x.write('a',url,{branchId:'branch-a',note:'x'.repeat(241)},{method:'PUT'})).status,400);
  const paid=await x.write('a','sales/'+sale.id+'/complete',{branchId:'branch-a',payments:[{method:'PIX',amountCents:1000}]});
  assert.equal(paid.status,200,JSON.stringify(paid.body));
  assert.equal((await x.get('a','sales/'+sale.id+'?branchId=branch-a')).body.sale.items[0].note,'Sem gelo; com limão');
  assert.equal((await x.write('a',url,{branchId:'branch-a',note:'Alterar após venda'},{method:'PUT'})).status,409);
  const history=await x.get('a','sales/history?branchId=branch-a');
  assert.equal(history.body.history.items[0].items[0].note,'Sem gelo; com limão');
 }finally{x.close();}
});

test('P3 home indicators are canonical live data, tenant-isolated and authorization-gated',async()=>{
 const x=await setup();try{
  const asOf=date.slice(0,10);
  const path='reports/home?branchId=branch-a&asOf='+asOf;
  const before=await x.get('a',path);
  assert.equal(before.status,200,JSON.stringify(before.body));
  assert.equal(before.body.home.salesCount,0);
  assert.equal(before.body.home.cashOpen,false);
  const p=await x.id('Produto para alerta','HOME-LIVE-1',1);
  const cash=await x.write('a','cash/open',{branchId:'branch-a',openingCents:1000});
  assert.equal(cash.status,201,JSON.stringify(cash.body));
  const sale=(await x.write('a','sales',{branchId:'branch-a'})).body.sale;
  await x.write('a','sales/'+sale.id+'/items',{branchId:'branch-a',productId:p,quantity:1});
  const completed=await x.write('a','sales/'+sale.id+'/complete',{branchId:'branch-a',payments:[{method:'PIX',amountCents:1000}]});
  assert.equal(completed.status,200,JSON.stringify(completed.body));
  const after=await x.get('a',path);
  assert.equal(after.status,200,JSON.stringify(after.body));
  assert.equal(after.body.home.salesCount,1);
  assert.equal(after.body.home.netSalesCents,1000);
  assert.equal(after.body.home.cashOpen,true);
  assert.equal(after.body.home.outOfStockCount,1);
  const other=await x.get('b','reports/home?branchId=branch-b&asOf='+asOf,x.other);
  assert.equal(other.status,200,JSON.stringify(other.body));
  assert.equal(other.body.home.salesCount,0);
  assert.equal(other.body.home.cashOpen,false);
  assert.equal((await x.get('a',path,x.viewer)).status,200);
  assert.equal((await x.get('a','reports/home?branchId=branch-b&asOf='+asOf)).status,404);
  assert.equal((await x.get('a','reports/home?branchId=branch-a&asOf=2026-02-30')).status,400);
 }finally{x.close();}
});

test('P3 independent terminal drawers link every sale to its originating open cash session',async()=>{
 const x=await setup();try{
  const product=await x.id('Item independente','TERMINAL-CASH',8);
  const openedA=await x.write('a','cash/open',{branchId:'branch-a',terminalId:'T-A',openingCents:1000});
  const openedB=await x.write('a','cash/open',{branchId:'branch-a',terminalId:'T-B',openingCents:500});
  assert.equal(openedA.status,201,JSON.stringify(openedA.body));
  assert.equal(openedB.status,201,JSON.stringify(openedB.body));
  const cashA=openedA.body.session.id,cashB=openedB.body.session.id;
  assert.notEqual(cashA,cashB);
  assert.equal((await x.get('a','cash?branchId=branch-a&terminalId=T-A')).body.session.id,cashA);
  assert.equal((await x.get('a','cash?branchId=branch-a&terminalId=T-B')).body.session.id,cashB);
  async function sale(terminalId){
   const opened=await x.write('a','sales',{branchId:'branch-a',terminalId});
   assert.equal(opened.status,201,JSON.stringify(opened.body));
   const id=opened.body.sale.id;
   await x.write('a','sales/'+id+'/items',{branchId:'branch-a',productId:product,quantity:1});
   const completed=await x.write('a','sales/'+id+'/complete',{branchId:'branch-a',payments:[{method:'CASH',amountCents:1000}]});
   assert.equal(completed.status,200,JSON.stringify(completed.body));
   return id;
  }
  const saleA=await sale('T-A'),saleB=await sale('T-B');
  const mapped=await x.db.prepare('SELECT cash_session_id AS cashId,terminal_id AS terminal FROM sales WHERE id=?')
   .bind(saleA).first();
  assert.equal(mapped.cashId,cashA);
  assert.equal(mapped.terminal,'T-A');
  assert.equal((await x.db.prepare('SELECT cash_session_id AS cashId FROM sales WHERE id=?').bind(saleB).first()).cashId,cashB);
  const balance=terminal=>x.get('a','cash?branchId=branch-a&terminalId='+terminal);
  assert.equal((await balance('T-A')).body.session.expectedCashCents,2000);
  assert.equal((await balance('T-B')).body.session.expectedCashCents,1500);
  const closed=await x.write('a','cash/sessions/'+cashA+'/close',{branchId:'branch-a',countedCashCents:2000});
  assert.equal(closed.status,200,JSON.stringify(closed.body));
  assert.equal((await balance('T-A')).body.session,null);
  assert.equal((await balance('T-B')).body.session.id,cashB);
  const history=await x.get('a','cash/sessions/search?branchId=branch-a&terminalId=T-A');
  assert.equal(history.body.history.total,1);
  assert.equal(history.body.history.items[0].id,cashA);
  const item=(await x.get('a','sales/'+saleA+'?branchId=branch-a')).body.sale.items[0];
  const refunded=await x.write('a','sales/'+saleA+'/returns',{branchId:'branch-a',terminalId:'T-B',
    reason:'Restituição noutro caixa',items:[{saleItemId:item.id,quantity:1}],refunds:[{method:'CASH',amountCents:1000}]});
  assert.equal(refunded.status,201,JSON.stringify(refunded.body));
  assert.equal((await balance('T-B')).body.session.expectedCashCents,500);
  assert.equal((await x.get('b','cash/sessions/search?branchId=branch-b&terminalId=T-A',x.other)).body.history.total,0);
  assert.equal((await x.get('a','cash?branchId=branch-a&terminalId=../../unsafe')).status,400);
 }finally{x.close();}
});

test('P3 cash credit repayments select the requested terminal, not the first open drawer',async()=>{
  const x=await setup();try{
    const p=await x.id('Crediário terminal','CREDIT-T-A',4);
    const customer=await x.write('a','customers',{branchId:'branch-a',name:'Consumidor caixa múltiplo',creditLimitCents:10000});
    assert.equal(customer.status,201,JSON.stringify(customer.body));
    const customerId=customer.body.customer.id;
    const cA=await x.write('a','cash/open',{branchId:'branch-a',terminalId:'T-A',openingCents:1000});
    const cB=await x.write('a','cash/open',{branchId:'branch-a',terminalId:'T-B',openingCents:500});
    const open=await x.write('a','sales',{branchId:'branch-a',terminalId:'T-A'});
    const saleId=open.body.sale.id;
    assert.equal((await x.write('a','sales/'+saleId+'/customer',{branchId:'branch-a',customerId})).status,200);
    assert.equal((await x.write('a','sales/'+saleId+'/items',{branchId:'branch-a',productId:p,quantity:1})).status,200);
    const charge=await x.write('a','sales/'+saleId+'/complete',{branchId:'branch-a',payments:[{method:'STORE_CREDIT',amountCents:1000}]});
    assert.equal(charge.status,200,JSON.stringify(charge.body));
    const route='credit/'+customerId+'/payments';
    const invalid=await x.write('a',route,{branchId:'branch-a',terminalId:'../T',method:'CASH',amountCents:200});
    assert.equal(invalid.status,400);
    const missing=await x.write('a',route,{branchId:'branch-a',terminalId:'T-Z',method:'CASH',amountCents:200});
    assert.equal(missing.status,409);
    const paid=await x.write('a',route,{branchId:'branch-a',terminalId:'T-B',method:'CASH',amountCents:400});
    assert.equal(paid.status,201,JSON.stringify(paid.body));
    const records=await x.db.prepare('SELECT cash_session_id AS cashId FROM customer_credit_receipts WHERE customer_id=?')
      .bind(customerId).all();
    assert.equal(records.results.length,1);
    assert.equal(records.results[0].cashId,cB.body.session.id);
    assert.equal((await x.get('a','cash?branchId=branch-a&terminalId=T-A')).body.session.expectedCashCents,1000);
    assert.equal((await x.get('a','cash?branchId=branch-a&terminalId=T-B')).body.session.expectedCashCents,900);
    assert.notEqual(cA.body.session.id,cB.body.session.id);
  }finally{x.close();}
});


test('P3 configured item derives variant/addition prices on server and preserves the chosen snapshot after catalogue changes',async()=>{
  const x=await setup();try{
    const productId=await x.id('Sanduíche configurável','CONFIG-BURGER',5);
    const path='products/'+productId+'/configuration';
    const catalogue={branchId:'branch-a',variants:[
      {id:'normal',name:'Normal',priceDeltaCents:0},
      {id:'large',name:'Grande',priceDeltaCents:300}
    ],groups:[{id:'extras',name:'Adicionais',selectionType:'MULTIPLE',
      minSelections:1,maxSelections:2,options:[
        {id:'cheese',name:'Queijo',priceDeltaCents:150},
        {id:'tomato',name:'Tomate',priceDeltaCents:70}
      ]}]};
    const saved=await x.write('a',path,catalogue,{method:'PUT'});
    assert.equal(saved.status,200,JSON.stringify(saved.body));
    assert.equal(saved.body.configuration.variants.length,2);
    assert.equal((await x.get('a',path+'?branchId=branch-a')).body.configuration.groups.length,1);
    const quote=await x.write('a','products/'+productId+'/configuration/price',{
      branchId:'branch-a',variantId:'large',selections:['cheese']});
    assert.equal(quote.status,200,JSON.stringify(quote.body));
    assert.equal(quote.body.quote.unitPriceCents,1450);
    assert.equal(quote.body.quote.configurationSnapshot.variant.name,'Grande');
    await x.write('a','cash/open',{branchId:'branch-a',openingCents:0});
    const opened=await x.write('a','sales',{branchId:'branch-a'});
    const saleId=opened.body.sale.id;
    const configuredPath='sales/'+saleId+'/items/configured';
    const key=next();
    const added=await x.write('a',configuredPath,{
      branchId:'branch-a',productId,variantId:'large',selections:['cheese'],quantity:2,
      unitPriceCents:1,note:'Ponto da carne: bem passado'
    },{key});
    assert.equal(added.status,200,JSON.stringify(added.body));
    assert.equal(added.body.sale.totalCents,2900,'client-supplied price must never be trusted');
    assert.equal(added.body.sale.items[0].configuration.variant.name,'Grande');
    assert.equal(added.body.sale.items[0].note,'Ponto da carne: bem passado');
    assert.deepEqual((await x.write('a',configuredPath,{
      branchId:'branch-a',productId,variantId:'large',selections:['cheese'],quantity:2,
      unitPriceCents:1,note:'Ponto da carne: bem passado'
    },{key})).body,added.body,'retries must not duplicate charged items');
    const paid=await x.write('a','sales/'+saleId+'/complete',{
      branchId:'branch-a',payments:[{method:'PIX',amountCents:2900}]});
    assert.equal(paid.status,200,JSON.stringify(paid.body));
    assert.equal((await x.get('a','inventory?branchId=branch-a')).body.stock.find(p=>p.productId===productId).quantity,3);
    const changed=await x.write('a',path,{...catalogue,
      groups:[{...catalogue.groups[0],maxSelections:1,options:[{id:'cheese',name:'Queijo novo',priceDeltaCents:999}]}]},{method:'PUT'});
    assert.equal(changed.status,200,JSON.stringify(changed.body));
    const historic=await x.get('a','sales/'+saleId+'?branchId=branch-a');
    assert.equal(historic.body.sale.items[0].unitPriceCents,1450);
    assert.equal(historic.body.sale.items[0].configuration.options[0].name,'Queijo');
    const report=await x.get('a','reports/details.csv?branchId=branch-a&from=2026-10-17&to=2026-10-17');
    assert.equal(report.status,200);
    assert.match(report.body.csv,/Grande/);
    assert.match(report.body.csv,/Queijo/);
    assert.doesNotMatch(report.body.csv,/Queijo novo/);

    assert.equal((await x.get('a','sales/history?branchId=branch-a')).body.history.items[0].items[0].configuration.variant.name,'Grande');
  }finally{x.close();}
});

test('P3 configured item rejects invalid groups, strangers, cross-tenant selections and different options for an existing SKU',async()=>{
  const x=await setup();try{
    const productId=await x.id('Pizza personalizável','PIZZA-CONFIG',4);
    const endpoint='products/'+productId+'/configuration';
    const config={branchId:'branch-a',variants:[],groups:[
      {id:'sabor',name:'Sabor',selectionType:'SINGLE',minSelections:1,maxSelections:1,options:[
        {id:'calabresa',name:'Calabresa',priceDeltaCents:200},
        {id:'marguerita',name:'Marguerita',priceDeltaCents:150}
      ]}
    ]};
    assert.equal((await x.write('a',endpoint,config,{method:'PUT',who:x.viewer})).status,403);
    assert.equal((await x.write('b',endpoint,{...config,branchId:'branch-b'},{method:'PUT',who:x.other})).status,404);
    assert.equal((await x.write('a',endpoint,config,{method:'PUT'})).status,200);
    assert.equal((await x.write('a',endpoint,{...config,groups:[{...config.groups[0],maxSelections:2}]},{method:'PUT'})).status,400);
    assert.equal((await x.write('a',endpoint+'/price',{branchId:'branch-a',selections:[]})).status,400);
    assert.equal((await x.write('a',endpoint+'/price',{branchId:'branch-a',selections:['from-another-product']})).status,400);
    assert.equal((await x.write('a',endpoint+'/price',{branchId:'branch-a',selections:['calabresa','marguerita']})).status,400);
    const sale=(await x.write('a','sales',{branchId:'branch-a'})).body.sale.id;
    const addition='sales/'+sale+'/items/configured';
    assert.equal((await x.write('a',addition,{branchId:'branch-a',productId,quantity:1,selections:['calabresa']})).status,200);
    assert.equal((await x.write('a',addition,{branchId:'branch-a',productId,quantity:1,selections:['marguerita']})).status,409,
      'two differently configured units must never be silently merged or undercharged');
    assert.equal((await x.write('a',addition,{branchId:'branch-a',productId,quantity:1,selections:['calabresa']})).status,200);
    const detail=await x.get('a','sales/'+sale+'?branchId=branch-a');
    assert.equal(detail.body.sale.items[0].quantity,2);
    assert.equal(detail.body.sale.items[0].unitPriceCents,1200);
    assert.equal((await x.get('b','products/'+productId+'/configuration?branchId=branch-b',x.other)).status,404);
  }finally{x.close();}
});

test('P4 seller monthly goals rank actual net sales after dated returns and never use another tenant ledger',async()=>{
 const x=await setup();try{
  const product=await x.id('Meta produto','GOAL-PRODUCT-1',5);
  const targetBody={branchId:'branch-a',sellerId:'viewer',month:'2026-10',targetCents:6000};
  const mutation=next();
  const saved=await x.write('a','reports/commission-targets',targetBody,{method:'PUT',key:mutation});
  assert.equal(saved.status,200,JSON.stringify(saved.body));
  assert.equal(saved.body.target.targetCents,6000);
  assert.deepEqual((await x.write('a','reports/commission-targets',targetBody,{method:'PUT',key:mutation})).body,saved.body);
  assert.equal((await x.write('a','reports/commission-targets',targetBody,{method:'PUT',who:x.viewer})).status,403);
  assert.equal((await x.write('a','reports/commission-targets',{...targetBody,month:'2026-13'},{method:'PUT'})).status,400);
  assert.equal((await x.write('a','reports/commission-targets',{...targetBody,sellerId:'other'},{method:'PUT'})).status,404);
  const rule=await x.write('a','commissions/rules',{branchId:'branch-a',sellerId:'viewer',commissionBps:500});
  assert.equal(rule.status,201,JSON.stringify(rule.body));
  await x.write('a','cash/open',{branchId:'branch-a',openingCents:0});
  const sale=(await x.write('a','sales',{branchId:'branch-a'})).body.sale.id;
  await x.write('a','sales/'+sale+'/seller',{branchId:'branch-a',sellerId:'viewer'});
  await x.write('a','sales/'+sale+'/items',{branchId:'branch-a',productId:product,quantity:2});
  assert.equal((await x.write('a','sales/'+sale+'/complete',{branchId:'branch-a',payments:[{method:'PIX',amountCents:2000}]})).status,200);
  const path='reports/commission-ranking?branchId=branch-a&month=2026-10';
  const before=await x.get('a',path);
  assert.equal(before.status,200,JSON.stringify(before.body));
  const viewerBefore=before.body.ranking.sellers.find(s=>s.sellerId==='viewer');
  assert.equal(viewerBefore.netSalesCents,2000);
  assert.equal(viewerBefore.targetCents,6000);
  assert.equal(viewerBefore.progressPercent,33.33);
  assert.equal(viewerBefore.commissionEarnedCents,100);
  const detail=(await x.get('a','sales/'+sale+'?branchId=branch-a')).body.sale;
  const reversed=await x.write('a','sales/'+sale+'/returns',{
    branchId:'branch-a',reason:'Uma unidade devolvida',
    items:[{saleItemId:detail.items[0].id,quantity:1}],refunds:[{method:'PIX',amountCents:1000}]
  });
  assert.equal(reversed.status,201,JSON.stringify(reversed.body));
  const after=(await x.get('a',path)).body.ranking;
  const viewer=after.sellers.find(s=>s.sellerId==='viewer');
  assert.equal(viewer.netSalesCents,1000);
  assert.equal(viewer.progressPercent,16.67);
  assert.equal(viewer.commissionReversedCents,50);
  assert.equal(viewer.commissionBalanceCents,50);
  assert.equal(after.sellers[0].sellerId,'viewer');
  const other=await x.get('b','reports/commission-ranking?branchId=branch-b&month=2026-10',x.other);
  assert.equal(other.status,200);
  assert.equal(other.body.ranking.sellers.length,0);
  assert.equal((await x.get('a','reports/commission-ranking?branchId=branch-b&month=2026-10')).status,404);
 }finally{x.close();}
});
