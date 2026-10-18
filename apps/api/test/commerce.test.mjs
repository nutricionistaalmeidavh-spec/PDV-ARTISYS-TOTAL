import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const requireDesktop=createRequire(import.meta.url);
const {createReportingService:createPinnedDesktopReportingService}=
  requireDesktop('../../../packages/core/js/domains/reports/reporting-service.js');
const desktopStockFixture=JSON.parse(readFileSync(
  new URL('../../../docs/parity/fixtures/p5-stock-shortage-desktop.json',import.meta.url),'utf8'));
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
const lotReceiptMigration=readFileSync(new URL('../migrations/0016_inventory_lot_receipts.sql',import.meta.url),'utf8');
const minimumMigration=readFileSync(new URL('../migrations/0017_inventory_minimum_levels.sql',import.meta.url),'utf8');
const storageMigration=readFileSync(new URL('../migrations/0019_inventory_storage_locations.sql',import.meta.url),'utf8');
const lotBalanceMigration=readFileSync(new URL('../migrations/0018_inventory_lot_balances.sql',import.meta.url),'utf8');
const configuredLinesMigration=readFileSync(new URL('../migrations/0020_sale_configured_lines.sql',import.meta.url),'utf8');
// A fixed business date must reach the commerce adapter, not only session authentication.
// Otherwise UTC midnight makes period-filtered reports silently disappear in CI.
const NOW=Date.parse('2026-10-17T14:00:00Z');
const date='2026-10-17T14:00:00.000Z';
const password='SafeTestPasswordForPdv2026!';
let num=0;
const next=()=>('mutation-'+(++num)+'-long');
async function setup(){
  const db=openLocalDatabase();db.exec(identity);db.exec(commerce);db.exec(finance);db.exec(vertical);db.exec(parity);db.exec(transfers);db.exec(reversals);db.exec(catalog);db.exec(purchasing);db.exec(media);db.exec(notesMigration);db.exec(cashTerminalMigration);db.exec(checkoutConfigurationMigration);db.exec(salesTargetsMigration);db.exec(lotReceiptMigration);db.exec(minimumMigration);db.exec(storageMigration);db.exec(lotBalanceMigration);db.exec(configuredLinesMigration);
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

test('P2 FEFO lot balances follow a sold item and its partial refund without duplicate stock',async()=>{
  const x=await setup();try{
    const product=(await x.write('a','products',{branchId:'branch-a',name:'Iogurte por lotes',
      sku:'BATCH-FEFO',salePriceCents:1000,trackStock:true}));
    assert.equal(product.status,201,product.body.error);
    const productId=product.body.product.id;
    const receipt=async(lotCode,quantity,expiresAt)=>x.write('a','inventory/receipts',{
      branchId:'branch-a',productId,quantity,lotCode,expiresAt,type:'purchase'});
    assert.equal((await receipt('LOTE-PRIMEIRO',2,'2098-01-01')).status,201);
    assert.equal((await receipt('LOTE-SEGUNDO',3,'2098-06-01')).status,201);
    const balances=async()=>((await x.get('a','inventory/lots?branchId=branch-a')).body.lots)
      .reduce((acc,lot)=>(acc[lot.lotCode]=lot.trackedBalance,acc),{});
    assert.deepEqual(await balances(),{'LOTE-PRIMEIRO':2,'LOTE-SEGUNDO':3});
    assert.equal((await x.write('a','cash/open',{branchId:'branch-a',openingCents:0})).status,201);
    const opened=await x.write('a','sales',{branchId:'branch-a'});
    assert.equal(opened.status,201,opened.body.error);
    const sid=opened.body.sale.id;
    const add=await x.write('a','sales/'+sid+'/items',{branchId:'branch-a',productId,quantity:4});
    assert.equal(add.status,200,add.body.error);
    const paid=await x.write('a','sales/'+sid+'/complete',{
      branchId:'branch-a',payments:[{method:'PIX',amountCents:4000}]});
    assert.equal(paid.status,200,paid.body.error);
    assert.deepEqual(await balances(),{'LOTE-PRIMEIRO':0,'LOTE-SEGUNDO':1});
    const stored=await x.db.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE type='sale' AND product_id=?")
      .bind(productId).first();
    assert.equal(stored.n,1,'one canonical stock movement despite two lot allocations');
    const sale=(await x.get('a','sales/'+sid+'?branchId=branch-a')).body.sale;
    const body={branchId:'branch-a',saleId:sid,reason:'Devolução parcial do lote',
      items:[{saleItemId:sale.items[0].id,quantity:2}],refunds:[{method:'PIX',amountCents:2000}]};
    const key=next();
    const refunded=await x.write('a','returns',body,{key});
    assert.equal(refunded.status,201,refunded.body.error);
    assert.deepEqual(await balances(),{'LOTE-PRIMEIRO':1,'LOTE-SEGUNDO':2});
    assert.deepEqual((await x.write('a','returns',body,{key})).body,refunded.body);
    assert.deepEqual(await balances(),{'LOTE-PRIMEIRO':1,'LOTE-SEGUNDO':2});
    assert.equal((await x.get('a','inventory?branchId=branch-a')).body.stock
      .find(p=>p.productId===productId).quantity,3);
    const foreign=await x.get('b','inventory/lots?branchId=branch-b',x.other);
    assert.equal(foreign.status,200,foreign.body.error);
    assert.deepEqual(foreign.body.lots,[]);
    await assert.rejects(x.db.prepare("DELETE FROM inventory_lot_entries WHERE tenant_id=?")
      .bind('a').run(),/LOT_LEDGER_IMMUTABLE/);
  }finally{x.close();}
});

test('P2 lot balances follow transfers, adjustments, counts and enforce nonnegative FEFO',async()=>{
  const x=await setup();try{
    await x.db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)')
      .bind('filial-a','a','FILIAL','Filial B','2026-10-17T14:00:00.000Z').run();
    const p=await x.write('a','products',{branchId:'branch-a',name:'Produto com validade',
      sku:'LOTE-TRANSFER',salePriceCents:400,trackStock:true});
    const productId=p.body.product.id;
    const receipt=await x.write('a','inventory/receipts',{
      branchId:'branch-a',productId,quantity:4,lotCode:'LOTE-FILIAL',expiresAt:'2099-05-01'});
    assert.equal(receipt.status,201,receipt.body.error);
    const transfer=await x.write('a','inventory/transfers',{
      branchId:'branch-a',toBranchId:'filial-a',productId,quantity:2,reason:'Reposição entre unidades'});
    assert.equal(transfer.status,201,transfer.body.error);
    const source=(await x.get('a','inventory/lots?branchId=branch-a')).body.lots;
    const target=(await x.get('a','inventory/lots?branchId=filial-a')).body.lots;
    assert.equal(source[0].trackedBalance,2);
    assert.equal(target[0].trackedBalance,2);
    const adjustment=await x.write('a','inventory/adjustments',{
      branchId:'filial-a',productId,quantityDelta:-1,reason:'Avaria documentada'});
    assert.equal(adjustment.status,201,adjustment.body.error);
    const count=await x.write('a','inventory/counts',{
      branchId:'filial-a',productId,expectedQuantity:1,countedQuantity:0,
      reason:'Inventário conferido na filial'});
    assert.equal(count.status,201,count.body.error);
    assert.equal((await x.get('a','inventory/lots?branchId=filial-a')).body.lots.length,0,
      'a depleted transferred lot is not listed outside its receipt branch');
    assert.equal((await x.get('a','inventory?branchId=filial-a')).body.stock.find(p=>p.productId===productId).quantity,0);
    const replay=await x.write('a','inventory/transfers',{
      branchId:'branch-a',toBranchId:'filial-a',productId,quantity:3,reason:'Tentativa excessiva'});
    assert.equal(replay.status,409,'no transfer can overdraft canonical product stock');
  }finally{x.close();}
});

test('P2 lot receipts annotate only canonical immutable movements, with idempotency and tenant isolation',async()=>{
  const x=await setup();try{
    const productId=await x.id('Leite pasteurizado','MILK-LOT',1),key=next();
    const data={branchId:'branch-a',productId,quantity:5,type:'purchase',
      lotCode:'out-2026/10',manufacturedAt:'2026-10-01',expiresAt:'2026-11-10'};
    const first=await x.write('a','inventory/receipts',data,{key});
    assert.equal(first.status,201,first.body.error);
    assert.equal(first.body.movement.lot.code,'OUT-2026/10');
    assert.deepEqual((await x.write('a','inventory/receipts',data,{key})).body,first.body);
    const result=await x.get('a','inventory/lots?branchId=branch-a');
    assert.equal(result.status,200,result.body.error);
    assert.equal(result.body.lots.length,1);
    assert.equal(result.body.lots[0].receivedQuantity,5);
    assert.equal(result.body.lots[0].lotCode,'OUT-2026/10');
    assert.equal(result.body.lots[0].expiresAt,'2026-11-10');
    const movement=await x.db.prepare('SELECT delta_milli FROM inventory_movements WHERE id=?').bind(first.body.movement.movementId).first();
    assert.equal(movement.delta_milli,5000);
    const count=await x.db.prepare('SELECT COUNT(*) AS n FROM inventory_lot_receipts WHERE movement_id=?').bind(first.body.movement.movementId).first();
    assert.equal(count.n,1,'lot record must not cause another inventory entry');
    await assert.rejects(x.db.prepare('DELETE FROM inventory_lot_receipts WHERE movement_id=?').bind(first.body.movement.movementId).run(),/IMMUTABLE/);
    assert.equal((await x.get('b','inventory/lots?branchId=branch-b',x.other)).body.lots.length,0);
    assert.equal((await x.get('a','inventory/lots?branchId=branch-a',x.viewer)).status,200);
    assert.equal((await x.write('a','inventory/receipts',data,{who:x.viewer})).status,403);
    assert.equal((await x.write('a','inventory/receipts',{...data,expiresAt:'2026-09-20'})).status,400);
    assert.equal((await x.write('a','inventory/receipts',{...data,lotCode:'',expiresAt:'2026-11-10'})).status,400);
    assert.equal((await x.get('a','inventory?branchId=branch-a')).body.stock.find(x=>x.productId===productId).quantity,6);
  }finally{x.close();}
});

test('P2 inventory count is tenant-scoped, idempotent, zero-aware and rejects stale stock',async()=>{
  const x=await setup();try{
    const productId=await x.id('Inventário físico','COUNT-1',5);
    const path='inventory/counts',key=next();
    const count={branchId:'branch-a',productId,expectedQuantity:5,countedQuantity:3,
      reason:'Contagem física conferida'};
    const first=await x.write('a',path,count,{key});
    assert.equal(first.status,201,first.body.error);
    assert.equal(first.body.count.quantityDelta,-2);
    assert.deepEqual((await x.write('a',path,count,{key})).body,first.body,
      'retry of the same mutation must return the prior result');
    const balance=async()=>((await x.get('a','inventory?branchId=branch-a')).body.stock
      .find(s=>s.productId===productId)?.quantity??0);
    assert.equal(await balance(),3);
    const movements=await x.db.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE tenant_id='a' AND product_id=? AND type='adjustment'").bind(productId).first();
    assert.equal(movements.n,1,'no duplicate ledger effects');
    assert.equal((await x.write('a',path,{...count,countedQuantity:0})).status,409,
      'stale expected balance must be rejected');
    assert.equal(await balance(),3);
    assert.equal((await x.write('a',path,{...count,expectedQuantity:3,countedQuantity:0})).status,201);
    assert.equal(await balance(),0,'physical zero is valid');
    const zero=await x.write('a',path,{...count,expectedQuantity:0,countedQuantity:0});
    assert.equal(zero.status,201,zero.body.error);
    assert.equal(zero.body.count.movementId,null,'no fake zero-delta ledger entry');
    assert.equal((await x.write('a',path,{...count,expectedQuantity:0,countedQuantity:2})).status,201);
    assert.equal(await balance(),2);
    assert.equal((await x.write('a',path,{...count,expectedQuantity:2,countedQuantity:1.0001})).status,400);
    assert.equal((await x.write('a',path,{...count,expectedQuantity:2,countedQuantity:1},{who:x.viewer})).status,403);
    assert.equal((await x.write('b',path,{...count,branchId:'branch-b',expectedQuantity:0,countedQuantity:1},{who:x.other})).status,404);
    assert.equal((await x.get('b','inventory?branchId=branch-b',x.other)).body.stock.length,0);
    // Distinct terminals reading the same snapshot must never both post
    // an adjustment for that snapshot, even with distinct mutation IDs.
    const competing=await Promise.all([
      x.write('a',path,{...count,expectedQuantity:2,countedQuantity:1},{key:next()}),
      x.write('a',path,{...count,expectedQuantity:2,countedQuantity:0},{key:next()})
    ]);
    assert.deepEqual(competing.map(r=>r.status).sort(),[201,409],
      'exactly one stale-snapshot adjustment can commit');
    assert.ok([0,1].includes(await balance()));
    const finalMovements=await x.db.prepare(
      "SELECT COUNT(*) AS n FROM inventory_movements WHERE tenant_id='a' AND product_id=? AND type='adjustment'"
    ).bind(productId).first();
    assert.equal(finalMovements.n,4,'one count per committed stock movement');

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

// P5 basic reports are compared to the byte-pinned desktop algorithm, not a
// hand-written claim of visual equality. Exact numeric fields only.
const p5ReportCoreFixture=JSON.parse(readFileSync(
 new URL('../../../docs/parity/fixtures/p5-report-core-desktop-pinned.json',import.meta.url),'utf8'));
function p5OriginalReport(){
 const {input:p,expected,desktop}=p5ReportCoreFixture;
 const source=readFileSync(new URL('../../../packages/core/js/domains/reports/reporting-service.js',import.meta.url));
 const sha=createHash('sha1').update('blob '+source.length+'\0').update(source).digest('hex');
 assert.equal(sha,desktop.blobSha,'P5 original desktop report algorithm was modified');
 const db={prepare(sql){
  if(sql==='PRAGMA table_info(sales)')return {all:()=>[]};
  if(sql.includes('FROM products p LEFT JOIN inventory_balances b'))
   return {all:()=>[{productId:'p5-item',sku:p.sku,name:'P5 item',unit:'UN',
     costCents:p.unitCostCents,salePriceCents:1000,minimumStock:0,quantity:p.stock}]};
  if(sql.includes("FROM cash_sessions WHERE status='CLOSED'"))
   return {all:()=>[{id:'p5-cash',terminalId:'DEFAULT',operatorId:'owner',
    expectedCashCents:p.openingCashCents,countedCashCents:p.countedCashCents,
    divergenceCents:p.countedCashCents-p.openingCashCents,openedAt:date,closedAt:date}]};
  if(sql.includes('FROM cash_movements cm JOIN cash_sessions'))
   return {all:()=>[]};
  if(sql.includes('FROM financial_entries fe'))
   return {all:()=>[{kind:'PAYABLE',amount_cents:p.payableCents,
    settled_cents:p.settledCents,due_at:p.dueDate}]};
  throw Error('Unknown original desktop SQL in P5 fixture: '+sql.slice(0,150));
 }};
 const original=createPinnedDesktopReportingService({db,now:()=>date});
 const stock=original.buildInventorySummary();
 const cash=original.buildCashSummary({from:'2026-10-17',to:'2026-10-17'});
 const finance=original.buildFinanceSummary({asOf:date});
 const observed={inventoryQuantity:stock.items[0].quantity,closedSessions:cash.closedSessions,
   expectedCashCents:cash.expectedCashCents,countedCashCents:cash.countedCashCents,
   divergenceCents:cash.divergenceCents,payableOpenCents:finance.payableOpenCents,
   payableSettledCents:finance.payableSettledCents};
 assert.deepEqual(observed,expected,'original pinned desktop P5 summary numeric fixture');
 return observed;
}
async function p5SeedBasicReport(x){
 const {input:p}=p5ReportCoreFixture;
 await x.id('P5 basic stock',p.sku,p.stock);
 const opened=await x.write('a','cash/open',{branchId:'branch-a',openingCents:p.openingCashCents});
 assert.equal(opened.status,201,JSON.stringify(opened.body));
 const closed=await x.write('a','cash/sessions/'+opened.body.session.id+'/close',
  {branchId:'branch-a',countedCashCents:p.countedCashCents});
 assert.equal(closed.status,200,JSON.stringify(closed.body));
 const fin=await x.write('a','finance/entries',
   {branchId:'branch-a',kind:'PAYABLE',description:'P5 fixture expense',
    amountCents:p.payableCents,dueDate:p.dueDate});
 assert.equal(fin.status,201,JSON.stringify(fin.body));
 const settled=await x.write('a','finance/entries/'+fin.body.entry.id+'/settle',
   {branchId:'branch-a',amountCents:p.settledCents,method:'PIX'});
 assert.equal(settled.status,200,JSON.stringify(settled.body));
 return {financeId:fin.body.entry.id,sessionId:opened.body.session.id};
}
const p5Summary=async x=>x.get('a','reports/summary?branchId=branch-a&from=2026-10-17&to=2026-10-17');

test('reports-060/nominal p5-report-core-desktop-pinned-v1 stock, closed cash and manual finance match original desktop',async()=>{
 const expected=p5OriginalReport();
 const x=await setup();try{
  await p5SeedBasicReport(x);
  const res=await p5Summary(x);
  assert.equal(res.status,200,JSON.stringify(res.body));
  const report=res.body.report;
  const row=report.inventory.find(v=>v.sku===p5ReportCoreFixture.input.sku);
  assert.ok(row,'canonical stock is visible in the basic report');
  const cash=report.cash.find(v=>v.status==='CLOSED');
  assert.ok(cash,'closed original cash session is in the basic report');
  const observed={inventoryQuantity:row.quantity,closedSessions:report.cash.filter(v=>v.status==='CLOSED').length,
   expectedCashCents:cash.expectedCashCents,countedCashCents:cash.countedCashCents,
   divergenceCents:cash.divergenceCents,payableOpenCents:report.finance.payableOpenCents,
   payableSettledCents:report.finance.payableSettledCents};
  assert.deepEqual(observed,expected,'P5 web API/SQLite matches original desktop basic operational summary');
 }finally{x.close();}
});

test('reports-060/authorization p5-report-core-desktop-pinned-v1 read only profile cannot mutate stock/cash/finance',async()=>{
 p5OriginalReport();
 const x=await setup();try{
  const ids=await p5SeedBasicReport(x);
  assert.equal((await x.get('a','reports/summary?branchId=branch-a',x.viewer)).status,200);
  assert.equal((await x.write('a','cash/open',{branchId:'branch-a',openingCents:1},{who:x.viewer})).status,403);
  assert.equal((await x.write('a','finance/entries',
   {branchId:'branch-a',kind:'PAYABLE',description:'Unauthorized bill',amountCents:1,dueDate:'2026-10-25'},{who:x.viewer})).status,403);
  assert.equal((await x.write('a','inventory/receipts',
   {branchId:'branch-a',productId:'p5-item',quantity:1,type:'opening'},{who:x.viewer})).status,403);
  assert.equal((await x.get('a','finance/entries?branchId=branch-a')).body.entries.length,1);
  assert.equal((await x.get('a','cash/sessions?branchId=branch-a')).body.sessions.length,1);
  assert.ok(ids.financeId);
 }finally{x.close();}
});

test('reports-060/tenant-isolation p5-report-core-desktop-pinned-v1 report core never leaks stock/cash/finance to other tenant',async()=>{
 p5OriginalReport();
 const x=await setup();try{
  await p5SeedBasicReport(x);
  const other=await x.get('b','reports/summary?branchId=branch-b&from=2026-10-17&to=2026-10-17',x.other);
  assert.equal(other.status,200,JSON.stringify(other.body));
  assert.deepEqual(other.body.report.inventory,[]);
  assert.deepEqual(other.body.report.cash,[]);
  assert.equal(other.body.report.finance.payableOpenCents,0);
  assert.equal((await x.get('a','reports/summary?branchId=branch-b')).status,404);
  assert.equal((await x.get('b','reports/summary?branchId=branch-a',x.other)).status,404);
 }finally{x.close();}
});

test('reports-060/failure-recovery p5-report-core-desktop-pinned-v1 rejected duplicate settlement preserves report totals',async()=>{
 const baseline=p5OriginalReport();
 const x=await setup();try{
  const {financeId}=await p5SeedBasicReport(x);
  const before=await p5Summary(x);
  assert.equal(before.status,200,JSON.stringify(before.body));
  const wrong=await x.write('a','finance/entries/'+financeId+'/settle',
    {branchId:'branch-a',amountCents:1100,method:'PIX'});
  assert.equal(wrong.status,400,'overpayment is rejected atomically');
  const after=await p5Summary(x);
  assert.equal(after.body.report.finance.payableOpenCents,baseline.payableOpenCents);
  assert.deepEqual(after.body.report.finance,before.body.report.finance,'failed write leaves report untouched');
  assert.equal((await x.get('a','finance/entries?branchId=branch-a')).body.entries.length,1);
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

test('P5 sales CSV rejects over-limit periods without silent truncation, scoped by company',async()=>{
  const x=await setup();try{
    const query='INSERT INTO sales(id,tenant_id,branch_id,operator_id,sale_number,status,total_cents,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?)';
    for(let i=0;i<3000;i++){
      const id='audit-'+i;
      await x.db.prepare(query).bind(id,'a','branch-a','owner','EXPORT-'+i,'COMPLETED',100,
        date,date).run();
    }
    const period='reports/sales.csv?branchId=branch-a&from=2026-10-17&to=2026-10-17';
    const full=await x.get('a',period);
    assert.equal(full.status,200,full.body.error);
    assert.match(full.body.csv,/EXPORT-2999/,'all 3000 permitted records are present');
    assert.equal((await x.get('b','reports/sales.csv?branchId=branch-b&from=2026-10-17&to=2026-10-17',x.other)).status,200);
    await x.db.prepare(query).bind('audit-3000','a','branch-a','owner','EXPORT-3000',
      'COMPLETED',100,date,date).run();
    const tooMany=await x.get('a',period);
    assert.equal(tooMany.status,413,'over-limit export must fail explicitly');
    assert.match(tooMany.body.error,/3000 vendas/);
    assert.equal((await x.get('a',period,x.viewer)).status,413,
      'read-only user sees the same honest nontruncating limit');
    assert.equal((await x.get('a','reports/sales.csv?branchId=branch-b&from=2026-10-17&to=2026-10-17')).status,404);
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

test('R1 checkout-017: removing a weighed line is retry safe and does not affect stock until payment',async()=>{
 const x=await setup();try{
  const created=await x.write('a','products',{branchId:'branch-a',name:'Café a granel',sku:'CAFE-KG-R1',unit:'KG',salePriceCents:2000,trackStock:true});
  assert.equal(created.status,201);
  const pid=created.body.product.id;
  await x.write('a','inventory/receipts',{branchId:'branch-a',productId:pid,quantity:3,type:'opening'});
  const opened=await x.write('a','sales',{branchId:'branch-a'});
  const id=opened.body.sale.id;
  const added=await x.write('a',`sales/${id}/items/weighted`,{branchId:'branch-a',productId:pid,grams:500,source:'MANUAL'});
  assert.equal(added.status,200,JSON.stringify(added.body));
  assert.equal(added.body.sale.items.length,1);
  const itemId=added.body.sale.items[0].id,mutation=next();
  assert.ok(itemId,'weighted sale line needs a stable ID for removal');
  const route=`sales/${id}/weight-items/${itemId}`;
  const removed=await x.write('a',route,{branchId:'branch-a'},{method:'DELETE',key:mutation});
  assert.equal(removed.status,200,JSON.stringify(removed.body));
  assert.equal(removed.body.sale.items.length,0);
  assert.equal((await x.write('a',route,{branchId:'branch-a'},{method:'DELETE',key:mutation})).status,200);
  const readded=await x.write('a',`sales/${id}/items/weighted`,{branchId:'branch-a',productId:pid,grams:750,source:'MANUAL'});
  assert.equal(readded.status,200);
  assert.equal(readded.body.sale.items[0].quantity,0.75);
  assert.equal((await x.write('a',route,{branchId:'branch-a'},{method:'DELETE',key:mutation})).status,200);
  assert.equal((await x.get('a',`sales/${id}?branchId=branch-a`)).body.sale.items[0].quantity,0.75,
    'replayed removal must not delete a newer weighing of same product');
  assert.equal((await x.get('a','inventory?branchId=branch-a')).body.stock.find(p=>p.productId===pid).quantity,3,
    'editing the open basket never changes the canonical stock ledger');
  assert.equal((await x.write('b',route,{branchId:'branch-b'},{method:'DELETE',who:x.other})).status,404);
  assert.equal((await x.write('a',route,{branchId:'branch-a'},{method:'DELETE',who:x.viewer})).status,403);
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
  const customer=await x.write('a','customers',{branchId:'branch-a',name:'Cliente Teste P5'});
  assert.equal(customer.status,201,JSON.stringify(customer.body));
  const first=(await x.write('a','sales',{branchId:'branch-a'})).body.sale;
  await x.write('a','sales/'+first.id+'/seller',{branchId:'branch-a',sellerId:'viewer'});
  const customerId=customer.body.customer.id;
  assert.equal((await x.write('a','sales/'+first.id+'/customer',{branchId:'branch-a',customerId})).status,200);
  await x.write('a','sales/'+first.id+'/items',{branchId:'branch-a',productId:p,quantity:2});
  await x.write('a','sales/'+first.id+'/complete',{branchId:'branch-a',payments:[{method:'PIX',amountCents:2000}]});
  const second=(await x.write('a','sales',{branchId:'branch-a'})).body.sale;
  await x.write('a','sales/'+second.id+'/items',{branchId:'branch-a',productId:p,quantity:1});
  await x.write('a','sales/'+second.id+'/complete',{branchId:'branch-a',payments:[{method:'CASH',amountCents:1000}]});
  const query='branchId=branch-a&from=2026-10-17&to=2026-10-17&sellerId=viewer&customerId='+customerId+'&productId='+p+'&paymentMethod=PIX';
  const detailed=await x.get('a','reports/details?'+query);
  assert.equal(detailed.status,200,JSON.stringify(detailed.body));
  assert.equal(detailed.body.details.total,1);
  assert.equal(detailed.body.details.items[0].id,first.id);
  assert.equal(detailed.body.details.items[0].sellerName,'viewer');
  assert.equal(detailed.body.details.items[0].customerName,'Cliente Teste P5');
  assert.equal(detailed.body.details.items[0].customerId,customerId);
  assert.equal(detailed.body.details.items[0].items[0].quantity,2);
  const csv=await x.get('a','reports/details.csv?'+query);
  assert.equal(csv.status,200,JSON.stringify(csv.body));
  assert.match(csv.body.csv,/RPT-DET-1/);
  assert.match(csv.body.csv,/PIX/);
  assert.match(csv.body.csv,/Cliente Teste P5/);
  assert.match(csv.body.csv,/"viewer"/);
  assert.match(csv.body.csv,/"Cliente ID";"Cliente"/);
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

test('P5 differential: reports-066/nominal runs exact published desktop inventory algorithm against web stock API',async()=>{
 const fixture=desktopStockFixture;
 assert.equal(fixture.desktop.commit,'7efea9c61f75be1536a1e516e917218f2b8bf2bf');
 const pinnedSource=readFileSync(new URL('../../../packages/core/js/domains/reports/reporting-service.js',import.meta.url));
 const blob=createHash('sha1').update('blob '+pinnedSource.length+'\0').update(pinnedSource).digest('hex');
 assert.equal(blob,fixture.desktop.sourceGitBlob,'Original desktop report source drifted from pinned published Git blob');
 const mockDb={prepare(sql){
   if(sql==='PRAGMA table_info(sales)')return {all:()=>[{name:'seller_id'},{name:'seller_name_snapshot'}]};
   assert.match(sql,/FROM products p LEFT JOIN inventory_balances b/);
   return {all:()=>fixture.products.map((p,i)=>({
     productId:'desktop-'+i,sku:p.sku,name:p.name,unit:'UN',
     quantity:p.quantity,minimumStock:p.minimumStock,costCents:p.costCents,salePriceCents:1000
   }))};
 }};
 const desktop=createPinnedDesktopReportingService({db:mockDb}).buildInventorySummary();
 for(const metric of ['lowStockCount','belowMinimumCount','zeroStockCount','suggestedPurchaseCostCents'])
   assert.equal(desktop[metric],fixture.expected[metric],'pinned desktop fixture mismatch: '+metric);
 assert.deepEqual(desktop.purchaseList.map(p=>({
   sku:p.sku,quantity:p.quantity,minimumStock:p.minimumStock,
   shortageToMinimum:p.shortageToMinimum,suggestedPurchaseCostCents:p.suggestedPurchaseCostCents
 })),fixture.expected.purchaseList);
 const x=await setup();try{
   for(const product of fixture.products){
     const productId=await x.id(product.name,product.sku,product.quantity);
     await x.db.prepare('UPDATE products SET last_cost_cents=? WHERE tenant_id=? AND id=?')
       .bind(product.costCents,'a',productId).run();
     const result=await x.write('a','reports/stock-minimum',{
       branchId:'branch-a',productId,minimumQuantity:product.minimumStock
     },{method:'PUT'});
     assert.equal(result.status,200,JSON.stringify(result.body));
   }
   const response=await x.get('a','reports/stock-coverage?branchId=branch-a&asOf=2026-10-17&days=30');
   assert.equal(response.status,200,JSON.stringify(response.body));
   const web=response.body.coverage;
   for(const metric of ['lowStockCount','belowMinimum','suggestedPurchaseCostCents']){
     const desktopKey=metric==='belowMinimum'?'belowMinimumCount':metric;
     assert.equal(web[metric],desktop[desktopKey],'desktop-versus-web metric '+metric);
   }
   const webShortages=web.products.filter(p=>p.minimumStatus!=='ABOVE_MINIMUM').map(p=>({
     sku:p.sku,quantity:p.quantity,minimumStock:p.minimumQuantity,
     shortageToMinimum:p.shortageToMinimum,suggestedPurchaseCostCents:p.suggestedPurchaseCostCents
   }));
   assert.deepEqual(webShortages,fixture.expected.purchaseList);
   const other=await x.get('b','reports/stock-coverage?branchId=branch-b',x.other);
   assert.equal(other.status,200);
   assert.equal(other.body.coverage.suggestedPurchaseCostCents,0);
   assert.equal(other.body.coverage.products.length,0);
 }finally{x.close();}
});

test('P5 replenishment does not pretend an unknown cost is a reliable quote',async()=>{
 const x=await setup();try{
   const productId=await x.id('Item sem aquisição','P5-UNKNOWN-PRICE',1);
   const saved=await x.write('a','reports/stock-minimum',
     {branchId:'branch-a',productId,minimumQuantity:4},{method:'PUT'});
   assert.equal(saved.status,200,saved.body.error);
   const report=await x.get('a','reports/stock-coverage?branchId=branch-a&asOf=2026-10-17');
   assert.equal(report.status,200,JSON.stringify(report.body));
   const item=report.body.coverage.products.find(p=>p.productId===productId);
   assert.equal(item.shortageToMinimum,3);
   assert.equal(item.suggestedPurchaseCostCents,null);
   assert.equal(item.purchaseCostBasis,'NO_RECORDED_COST');
   assert.equal(report.body.coverage.suggestedPurchaseCostCents,null);
   assert.equal(report.body.coverage.unpricedShortages,1);
 }finally{x.close();}
});

test('P5 staged D1 rollout keeps old reports usable and blocks writes until 0016 is deployed',async()=>{
 const x=await setup();try{
  const id=await x.id('Sem tabela opcional','P5-SAFE',3);
  x.db.exec('DROP TABLE inventory_minimum_levels');
  const old=await x.get('a','reports/stock-coverage?branchId=branch-a&asOf=2026-10-17');
  assert.equal(old.status,200,JSON.stringify(old.body));
  assert.equal(old.body.coverage.minimumPoliciesAvailable,false);
  assert.equal(old.body.coverage.products.find(p=>p.productId===id).minimumStatus,'NOT_CONFIGURED');
  const home=await x.get('a','reports/home?branchId=branch-a&asOf=2026-10-17');
  assert.equal(home.status,200,JSON.stringify(home.body));
  const attempt=await x.write('a','reports/stock-minimum',{branchId:'branch-a',productId:id,minimumQuantity:2},{method:'PUT'});
  assert.equal(attempt.status,503);
  assert.match(attempt.body.error,/atualização.*não foi aplicada|migração|banco/i);
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
  assert.equal(after.body.home.minimumUnconfiguredCount,1);
  assert.equal(after.body.home.belowMinimumCount,0);
  const other=await x.get('b','reports/home?branchId=branch-b&asOf='+asOf,x.other);
  assert.equal(other.status,200,JSON.stringify(other.body));
  assert.equal(other.body.home.salesCount,0);
  assert.equal(other.body.home.cashOpen,false);
  assert.equal((await x.get('a',path,x.viewer)).status,200);
  assert.equal((await x.get('a','reports/home?branchId=branch-b&asOf='+asOf)).status,404);
  assert.equal((await x.get('a','reports/home?branchId=branch-a&asOf=2026-02-30')).status,400);
 }finally{x.close();}
});

test('P5 home-003 commercial targets use only sellers with goals, with RBAC and branch isolation',async()=>{
 const x=await setup();try{
  const p=await x.id('Meta dashboard','HOME-GOAL-P5',5);
  await x.write('a','cash/open',{branchId:'branch-a',openingCents:0});
  const first=(await x.write('a','sales',{branchId:'branch-a'})).body.sale.id;
  await x.write('a','sales/'+first+'/items',{branchId:'branch-a',productId:p,quantity:1});
  assert.equal((await x.write('a','sales/'+first+'/complete',{
    branchId:'branch-a',payments:[{method:'PIX',amountCents:1000}]
  })).status,200);
  const homePath='reports/home?branchId=branch-a&asOf=2026-10-17';
  const without=(await x.get('a',homePath)).body.home;
  assert.equal(without.monthToDateNetSalesCents,1000);
  assert.equal(without.monthlyTargetCents,null);
  assert.equal(without.targetProgressPercent,null);
  const rule=await x.write('a','reports/commission-targets',{
    branchId:'branch-a',sellerId:'viewer',month:'2026-10',targetCents:6000
  },{method:'PUT'});
  assert.equal(rule.status,200,JSON.stringify(rule.body));
  let home=(await x.get('a',homePath)).body.home;
  assert.equal(home.monthlyTargetCents,6000);
  assert.equal(home.targetedSellerNetCents,0,'unrelated owner sales cannot inflate seller goals');
  assert.equal(home.targetProgressPercent,0);
  const second=(await x.write('a','sales',{branchId:'branch-a'})).body.sale.id;
  await x.write('a','sales/'+second+'/seller',{branchId:'branch-a',sellerId:'viewer'});
  await x.write('a','sales/'+second+'/items',{branchId:'branch-a',productId:p,quantity:1});
  assert.equal((await x.write('a','sales/'+second+'/complete',{
    branchId:'branch-a',payments:[{method:'PIX',amountCents:1000}]
  })).status,200);
  home=(await x.get('a',homePath)).body.home;
  assert.equal(home.monthToDateNetSalesCents,2000);
  assert.equal(home.targetedSellerNetCents,1000);
  assert.equal(home.targetProgressPercent,16.67);
  assert.equal(home.targetedSellers,1);
  assert.equal((await x.get('a',homePath,x.viewer)).status,200);
  const outside=(await x.get('b','reports/home?branchId=branch-b&asOf=2026-10-17',x.other)).body.home;
  assert.equal(outside.monthlyTargetCents,null);
  assert.equal(outside.targetedSellerNetCents,null);
  assert.equal((await x.write('a','reports/commission-targets',{
    branchId:'branch-a',sellerId:'viewer',month:'2026-10',targetCents:1
  },{who:x.viewer,method:'PUT'})).status,403);
 }finally{x.close();}
});

test('cash-046 P3 independent terminal drawers link every sale to its originating open cash session',async()=>{
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
    assert.equal((await x.write('a',addition,{branchId:'branch-a',productId,quantity:1,selections:['marguerita']})).status,200,
      'same SKU can have distinct validated configurations');
    assert.equal((await x.write('a',addition,{branchId:'branch-a',productId,quantity:1,selections:['calabresa']})).status,200);
    const detail=await x.get('a','sales/'+sale+'?branchId=branch-a');
    assert.equal(detail.body.sale.items.length,2,'two priced choice identities under one catalog SKU');
    const slices=new Map(detail.body.sale.items.map(i=>[i.configuration.options[0].id,i]));
    assert.equal(slices.get('calabresa').quantity,2);
    assert.equal(slices.get('marguerita').quantity,1);
    assert.equal(slices.get('calabresa').unitPriceCents,1200);
    assert.equal(slices.get('marguerita').unitPriceCents,1150);
    assert.equal(detail.body.sale.subtotalCents,3550);
    assert.equal(new Set(detail.body.sale.items.map(i=>i.productId)).size,1);
    assert.equal(new Set(detail.body.sale.items.map(i=>i.parentItemId)).size,1);
    await x.write('a','cash/open',{branchId:'branch-a',openingCents:0});
    assert.equal((await x.write('a','sales/'+sale+'/complete',{
      branchId:'branch-a',payments:[{method:'PIX',amountCents:3550}]})).status,200);
    assert.equal((await x.get('a','inventory?branchId=branch-a')).body.stock
      .find(i=>i.productId===productId).quantity,1);
    const reportBefore=await x.get('a','reports/summary?branchId=branch-a&from=2026-10-17&to=2026-10-17');
    assert.equal(reportBefore.status,200,reportBefore.body.error);
    assert.equal(reportBefore.body.report.products.find(p=>p.productId===productId).grossCents,3550);
    const marginsBefore=await x.get('a','reports/margins?branchId=branch-a&from=2026-10-17&to=2026-10-17');
    assert.equal(marginsBefore.status,200,marginsBefore.body.error);
    assert.equal(marginsBefore.body.margin.revenueCents,3550);
    assert.equal(marginsBefore.body.margin.costCents,0);
    const returned={branchId:'branch-a',saleId:sale,
      reason:'Cliente devolveu somente a configuração marguerita',
      items:[{saleItemId:slices.get('marguerita').id,quantity:1}],
      refunds:[{method:'PIX',amountCents:1150}]};
    const quote=await x.write('a','sales/'+sale+'/returns/quote',returned);
    assert.equal(quote.status,200,quote.body.error);
    assert.equal(quote.body.quote.amountCents,1150);
    const refund=await x.write('a','returns',returned);
    assert.equal(refund.status,201,refund.body.error);
    assert.equal((await x.get('a','inventory?branchId=branch-a')).body.stock
      .find(i=>i.productId===productId).quantity,2);
    const historic=await x.get('a','sales/'+sale+'?branchId=branch-a');
    assert.equal(historic.body.sale.items.length,2);
    assert.equal(historic.body.sale.netTotalCents,2400);
    const marginsAfter=await x.get('a','reports/margins?branchId=branch-a&from=2026-10-17&to=2026-10-17');
    assert.equal(marginsAfter.status,200,marginsAfter.body.error);
    assert.equal(marginsAfter.body.margin.revenueCents,2400);
    assert.equal(marginsAfter.body.margin.returnedCents,1150);
    const summaryAfter=await x.get('a','reports/summary?branchId=branch-a&from=2026-10-17&to=2026-10-17');
    assert.equal(summaryAfter.status,200,summaryAfter.body.error);
    assert.equal(summaryAfter.body.report.products.find(p=>p.productId===productId).grossCents,3550);
    assert.equal(summaryAfter.body.report.products.find(p=>p.productId===productId).refundedCents,1150);
    assert.equal((await x.db.prepare('SELECT COUNT(*) AS n FROM sale_items WHERE sale_id=?')
      .bind(sale).first()).n,1,'the historical FK parent remains exactly one');
    assert.equal((await x.db.prepare('SELECT COUNT(*) AS n FROM sale_configured_lines WHERE sale_id=?')
      .bind(sale).first()).n,2);
    assert.equal((await x.db.prepare('SELECT COUNT(*) AS n FROM sale_configured_return_lines WHERE sale_id=?')
      .bind(sale).first()).n,1);
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

test('P1 restored category management API enforces tenant scope and products.manage permission',async()=>{
 const x=await setup();try{
   const first=await x.write('a','products/categories',{branchId:'branch-a',name:'Categoria A'});
   assert.equal(first.status,201,first.body.error);
   const id=first.body.category.id;
   const product=await x.write('a','products',{branchId:'branch-a',name:'Produto de teste',sku:'CATEGORY-TEST',salePriceCents:500,categoryId:id});
   assert.equal(product.status,201,product.body.error);
   const address='products/categories/'+id;
   assert.equal((await x.write('a',address,{branchId:'branch-a',name:'Invasão'},{method:'PATCH',who:x.viewer})).status,403);
   assert.equal((await x.write('b',address,{branchId:'branch-b',name:'Invasão'},{method:'PATCH',who:x.other})).status,404);
   const k=next();
   const rename=await x.write('a',address,{branchId:'branch-a',name:'Categoria renomeada'},{method:'PATCH',key:k});
   assert.equal(rename.status,200,rename.body.error);
   assert.equal(rename.body.category.id,id);
   assert.equal(rename.body.category.name,'Categoria renomeada');
   assert.deepEqual((await x.write('a',address,{branchId:'branch-a',name:'Categoria renomeada'},{method:'PATCH',key:k})).body,rename.body);
   const listed=await x.get('a','products?branchId=branch-a');
   assert.equal(listed.body.products.find(p=>p.id===product.body.product.id).categoryId,id);
   const all=await x.get('a','products/categories?branchId=branch-a');
   assert.equal(all.body.categories.length,1);
   assert.equal(all.body.categories[0].name,'Categoria renomeada');
 }finally{x.close();}
});

// Cross-platform certification is executable evidence, not an imported-file assertion.
// Original modules below have immutable blob IDs from PDV-ARTISYS@7efea9c.
const certifiedCheckoutFixture=JSON.parse(readFileSync(
  new URL('../../../docs/parity/fixtures/checkout-core-desktop-v1.json',import.meta.url),'utf8'
));
const originalRequire=createRequire(import.meta.url);
const desktopPricing=originalRequire('../../../packages/core/js/domains/sales/pricing.js');
const desktopPayments=originalRequire('../../../packages/core/js/domains/payments/payment-rules.js');
const desktopAuthorization=originalRequire('../../../packages/core/js/core/auth/authorization-service.js');
const desktopProfiles=originalRequire('../../../packages/core/js/core/auth/default-profiles.js');
function assertCheckoutDesktopSourcePinned(){
  assert.equal(certifiedCheckoutFixture.desktop.commit,'7efea9c61f75be1536a1e516e917218f2b8bf2bf');
  assert.equal(certifiedCheckoutFixture.desktop.repo,'nutricionistaalmeidavh-spec/PDV-ARTISYS');
  for(const [file,expectedHash] of Object.entries(certifiedCheckoutFixture.desktop.sourceBlobs)){
    const bytes=readFileSync(new URL('../../../packages/core/'+file,import.meta.url));
    const sha=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
    assert.equal(sha,expectedHash,'Original desktop blob drifted: '+file);
  }
}
function checkoutGolden(id){
  const row=certifiedCheckoutFixture.cases.find(c=>c.id===id);
  assert.ok(row,'missing golden vector '+id);
  return row;
}

test('checkout-007/nominal checkout-discount-desktop-nominal-v1 compares desktop and authoritative SQL',async()=>{
  assertCheckoutDesktopSourcePinned();
  const vector=checkoutGolden('checkout-discount-desktop-nominal-v1');
  const reference=desktopPricing.calculateSaleTotals(vector.input);
  assert.deepEqual(reference,vector.expected);
  const x=await setup();
  try{
    const productId=await x.id('Desktop discount','P0-DISCOUNT',2);
    const opened=await x.write('a','sales',{branchId:'branch-a'});
    assert.equal(opened.status,201,opened.body.error);
    const saleId=opened.body.sale.id;
    const added=await x.write('a','sales/'+saleId+'/items',{branchId:'branch-a',productId,quantity:1});
    assert.equal(added.status,200,added.body.error);
    const applied=await x.write('a','sales/'+saleId+'/discount',{
      branchId:'branch-a',discountCents:vector.input.discountCents
    });
    assert.equal(applied.status,200,applied.body.error);
    const observed={subtotalCents:applied.body.sale.subtotalCents,
      discountCents:applied.body.sale.discountCents,totalCents:applied.body.sale.totalCents};
    assert.deepEqual(observed,reference,'API/SQLite totals match the pinned desktop golden vector');
    const persisted=await x.db.prepare('SELECT discount_cents AS cents FROM sales WHERE id=? AND tenant_id=?')
      .bind(saleId,'a').first();
    assert.equal(persisted.cents,reference.discountCents);
  }finally{x.close();}
});

test('checkout-007/authorization checkout-discount-desktop-authorization-v1 compares original role policy with API',async()=>{
  assertCheckoutDesktopSourcePinned();
  const vector=checkoutGolden('checkout-discount-desktop-authorization-v1');
  const originalAuth=desktopAuthorization.createAuthorizationService({
    resolvePermissions:p=>desktopProfiles.DEFAULT_PROFILE_PERMISSIONS[
      p.id==='permitted'?vector.permittedProfile:vector.deniedProfile
    ]
  });
  assert.equal(originalAuth.can({principal:{kind:'human',id:'permitted'},capability:vector.capability}),true);
  assert.equal(originalAuth.can({principal:{kind:'human',id:'denied'},capability:vector.capability}),false);
  const x=await setup();
  try{
    const productId=await x.id('Desktop RBAC','P0-AUTH',2);
    const opened=await x.write('a','sales',{branchId:'branch-a'});
    assert.equal(opened.status,201,opened.body.error);
    const saleId=opened.body.sale.id;
    const added=await x.write('a','sales/'+saleId+'/items',{branchId:'branch-a',productId,quantity:1});
    assert.equal(added.status,200,added.body.error);
    const before=await x.db.prepare('SELECT discount_cents AS cents FROM sales WHERE id=?').bind(saleId).first();
    const denied=await x.write('a','sales/'+saleId+'/discount',
      {branchId:'branch-a',discountCents:150},{who:x.viewer});
    assert.equal(denied.status,vector.expectedDeniedHttp);
    const after=await x.db.prepare('SELECT discount_cents AS cents FROM sales WHERE id=?').bind(saleId).first();
    assert.deepEqual(after,before,'denial cannot mutate financial records');
    const accepted=await x.write('a','sales/'+saleId+'/discount',
      {branchId:'branch-a',discountCents:150});
    const observed={authorized:accepted.status===vector.expectedAllowedHttp,
      denied:denied.status===vector.expectedDeniedHttp,unmodified:after.cents===before.cents};
    const reference={authorized:true,denied:true,unmodified:true};
    assert.deepEqual(observed,reference,'API permissions and invariance match byte-pinned desktop roles');
  }finally{x.close();}
});

test('checkout-008/nominal checkout-payment-desktop-nominal-v1 compares mixed tender and cash ledger',async()=>{
  assertCheckoutDesktopSourcePinned();
  const vector=checkoutGolden('checkout-payment-desktop-nominal-v1');
  const reference=desktopPayments.resolvePayment(vector.input);
  assert.deepEqual(reference,vector.expected);
  const x=await setup();
  try{
    const productId=await x.id('Desktop mixed payment','P0-MIXED',2);
    const cash=await x.write('a','cash/open',{branchId:'branch-a',openingCents:0});
    assert.equal(cash.status,201,cash.body.error);
    const opened=await x.write('a','sales',{branchId:'branch-a'});
    assert.equal(opened.status,201,opened.body.error);
    const saleId=opened.body.sale.id;
    const added=await x.write('a','sales/'+saleId+'/items',{branchId:'branch-a',productId,quantity:1});
    assert.equal(added.status,200,added.body.error);
    const completed=await x.write('a','sales/'+saleId+'/complete',{
      branchId:'branch-a',payments:vector.input.payments
    });
    assert.equal(completed.status,200,JSON.stringify(completed.body));
    const payments=await x.db.prepare('SELECT COUNT(*) AS n FROM sale_payments WHERE sale_id=?')
      .bind(saleId).first();
    const netCash=await x.db.prepare(
      "SELECT COALESCE(SUM(amount_cents),0) AS cents FROM cash_movements WHERE tenant_id='a' AND method='CASH'"
    ).bind().first();
    const observed={totalCents:completed.body.sale.totalCents,
      changeCents:completed.body.sale.changeCents,storedPayments:payments.n,netCashCents:netCash.cents};
    const expected={totalCents:reference.totalCents,changeCents:reference.changeDueCents,
      storedPayments:vector.expectedStoredPayments,netCashCents:vector.expectedCashMovementCents};
    assert.deepEqual(observed,expected,'API payment and persisted ledger equal the pinned desktop golden vector');
  }finally{x.close();}
});

test('P1 HTTP shelf addresses honor inventory RBAC, tenant and branch and never mutate stock',async()=>{
 const x=await setup();try{
   const p=await x.write('a','products',{branchId:'branch-a',name:'Produto localizável',sku:'BIN-RBAC-1',salePriceCents:1000});
   assert.equal(p.status,201,p.body.error);
   const id=p.body.product.id;
   const addr='inventory/locations';
   assert.equal((await x.write('a',addr,{branchId:'branch-a',code:'A-02',name:'Prateleira'},{who:x.viewer})).status,403);
   const loc=await x.write('a',addr,{branchId:'branch-a',code:'A-02',name:'Prateleira'});
   assert.equal(loc.status,201,loc.body.error);
   const locId=loc.body.location.id;
   assert.equal((await x.get('a',addr+'?branchId=branch-a')).body.locations[0].code,'A-02');
   assert.equal((await x.write('a',addr+'/assign',{branchId:'branch-a',productId:id,locationId:locId},{who:x.viewer})).status,403);
   assert.equal((await x.write('b',addr+'/assign',{branchId:'branch-b',productId:id,locationId:locId},{who:x.other})).status,404);
   const mapped=await x.write('a',addr+'/assign',{branchId:'branch-a',productId:id,locationId:locId});
   assert.equal(mapped.status,200,mapped.body.error);
   assert.equal((await x.get('a',addr+'/assign?branchId=branch-a')).body.assignments[0].locationCode,'A-02');
   assert.equal((await x.get('a','inventory?branchId=branch-a')).body.stock.find(v=>v.productId===id).quantity,0);
   assert.equal((await x.db.prepare('SELECT COUNT(*) AS n FROM inventory_movements').bind().first()).n,0);
 }finally{x.close();}
});



// P6 10 independent scenario executions. These compare immutable desktop
// policy/price/payment source blobs (verified by assertCheckoutDesktopSourcePinned)
// against authenticated API calls and actual SQLite rows, not mock outputs.
function desktopV2(id,scenarioId){
  assertCheckoutDesktopSourcePinned();
  const row=checkoutGolden(id);
  assert.equal(row.scenarioId,scenarioId);
  return row;
}
function referenceAuth(capability,permittedProfile='ADMINISTRATOR',deniedProfile='READ_ONLY'){
  const service=desktopAuthorization.createAuthorizationService({
    resolvePermissions:principal=>desktopProfiles.DEFAULT_PROFILE_PERMISSIONS[
      principal.id==='permitted'?permittedProfile:deniedProfile]||[]
  });
  assert.equal(service.can({principal:{kind:'human',id:'permitted'},capability}),true);
  assert.equal(service.can({principal:{kind:'human',id:'denied'},capability}),false);
}
async function certifiedSale(x,sku,quantity=1){
  const productId=await x.id('Certificacao '+sku,sku,6);
  const opened=await x.write('a','sales',{branchId:'branch-a'});
  assert.equal(opened.status,201,opened.body.error);
  const saleId=opened.body.sale.id;
  const added=await x.write('a','sales/'+saleId+'/items',{branchId:'branch-a',productId,quantity});
  assert.equal(added.status,200,added.body.error);
  return {productId,saleId,opened,added};
}
function saleTotals(sale){
  return {subtotalCents:sale.subtotalCents,discountCents:sale.discountCents,totalCents:sale.totalCents};
}

test('checkout-007/tenant-isolation discount-tenant-desktop-v2 excludes another company from price changes',async()=>{
  const vector=desktopV2('discount-tenant-desktop-v2','checkout-007/tenant-isolation');
  const reference=desktopPricing.calculateSaleTotals(vector.input);
  assert.deepEqual(reference,vector.expected);
  const x=await setup();try{
    const {saleId}=await certifiedSale(x,'CERT-DISC-TENANT');
    const foreign=await x.write('b','sales/'+saleId+'/discount',
      {branchId:'branch-b',discountCents:vector.input.discountCents},{who:x.other});
    assert.equal(foreign.status,vector.foreignTenantStatus);
    const unchanged=await x.db.prepare('SELECT discount_cents AS cents FROM sales WHERE id=?').bind(saleId).first();
    assert.equal(unchanged.cents,0,'foreign tenant cannot mutate seller price or discount');
    const own=await x.write('a','sales/'+saleId+'/discount',
      {branchId:'branch-a',discountCents:vector.input.discountCents});
    assert.equal(own.status,200,own.body.error);
    assert.deepEqual(saleTotals(own.body.sale),reference,'isolated tenant follows original desktop pricing');
  }finally{x.close();}
});

test('checkout-007/failure-recovery discount-recovery-desktop-v2 replays idempotently and rejects invalid amounts',async()=>{
  const vector=desktopV2('discount-recovery-desktop-v2','checkout-007/failure-recovery');
  const reference=desktopPricing.calculateSaleTotals(vector.input);
  assert.deepEqual(reference,vector.expected);
  assert.throws(()=>desktopPricing.calculateSaleTotals({...vector.input,discountCents:vector.invalidDiscountCents}));
  const x=await setup();try{
    const {saleId}=await certifiedSale(x,'CERT-DISC-RETRY');
    const payload={branchId:'branch-a',discountCents:vector.input.discountCents};
    const key=next();
    const first=await x.write('a','sales/'+saleId+'/discount',payload,{key});
    assert.equal(first.status,200,first.body.error);
    const replay=await x.write('a','sales/'+saleId+'/discount',payload,{key});
    assert.deepEqual(replay.body,first.body,'retry returns original mutation response');
    const invalid=await x.write('a','sales/'+saleId+'/discount',
      {...payload,discountCents:vector.invalidDiscountCents});
    assert.equal(invalid.status,400);
    const persisted=await x.db.prepare('SELECT discount_cents AS cents FROM sales WHERE id=?').bind(saleId).first();
    assert.equal(persisted.cents,reference.discountCents);
    assert.deepEqual(saleTotals(first.body.sale),reference,'failed mutation leaves desktop-equivalent amount');
  }finally{x.close();}
});

test('checkout-008/authorization payment-authorization-desktop-v2 refuses readonly completion without ledger effects',async()=>{
  const vector=desktopV2('payment-authorization-desktop-v2','checkout-008/authorization');
  referenceAuth(vector.capability,vector.permittedProfile,vector.deniedProfile);
  const x=await setup();try{
    const {saleId}=await certifiedSale(x,'CERT-PAY-AUTH');
    const cash=await x.write('a','cash/open',{branchId:'branch-a',openingCents:0});
    assert.equal(cash.status,201,cash.body.error);
    const payload={branchId:'branch-a',payments:[{method:'PIX',amountCents:1000}]};
    const denied=await x.write('a','sales/'+saleId+'/complete',payload,{who:x.viewer});
    assert.equal(denied.status,vector.expectedDeniedHttp);
    const state=await x.db.prepare('SELECT status FROM sales WHERE id=?').bind(saleId).first();
    const count=await x.db.prepare('SELECT COUNT(*) AS n FROM sale_payments WHERE sale_id=?').bind(saleId).first();
    assert.deepEqual({status:state.status,payments:count.n},{status:'OPEN',payments:0},
      'unauthorized payment cannot finalize sale or create a financial posting');
    const accepted=await x.write('a','sales/'+saleId+'/complete',payload);
    assert.equal(accepted.status,200,accepted.body.error);
  }finally{x.close();}
});

test('checkout-008/tenant-isolation payment-tenant-desktop-v2 forbids foreign settlements',async()=>{
  const vector=desktopV2('payment-tenant-desktop-v2','checkout-008/tenant-isolation');
  const reference=desktopPayments.resolvePayment(vector.input);
  assert.deepEqual(reference,vector.expected);
  const x=await setup();try{
    const {saleId}=await certifiedSale(x,'CERT-PAY-TENANT');
    assert.equal((await x.write('a','cash/open',{branchId:'branch-a',openingCents:0})).status,201);
    const foreign=await x.write('b','sales/'+saleId+'/complete',
      {branchId:'branch-b',payments:vector.input.payments},{who:x.other});
    assert.equal(foreign.status,vector.foreignTenantStatus);
    const count=await x.db.prepare('SELECT COUNT(*) AS n FROM sale_payments WHERE sale_id=?').bind(saleId).first();
    assert.equal(count.n,0,'foreign settlement must not enter the original tenant ledger');
    const own=await x.write('a','sales/'+saleId+'/complete',
      {branchId:'branch-a',payments:vector.input.payments});
    assert.equal(own.status,200,own.body.error);
    assert.equal(own.body.sale.totalCents,reference.totalCents);
    assert.equal(own.body.sale.changeCents,reference.changeDueCents);
  }finally{x.close();}
});

test('checkout-008/failure-recovery payment-recovery-desktop-v2 pays exactly once on retry',async()=>{
  const vector=desktopV2('payment-recovery-desktop-v2','checkout-008/failure-recovery');
  const reference=desktopPayments.resolvePayment(vector.input);
  assert.deepEqual(reference,vector.expected);
  const x=await setup();try{
    const {saleId}=await certifiedSale(x,'CERT-PAY-RETRY');
    assert.equal((await x.write('a','cash/open',{branchId:'branch-a',openingCents:0})).status,201);
    const payload={branchId:'branch-a',payments:vector.input.payments},key=next();
    const initial=await x.write('a','sales/'+saleId+'/complete',payload,{key});
    assert.equal(initial.status,200,initial.body.error);
    const retry=await x.write('a','sales/'+saleId+'/complete',payload,{key});
    assert.deepEqual(retry.body,initial.body,'idempotent payment returns the identical original confirmation');
    const second=await x.write('a','sales/'+saleId+'/complete',payload,{key:next()});
    assert.equal(second.status,409,'second independently keyed settlement cannot double charge');
    const count=await x.db.prepare('SELECT COUNT(*) AS n FROM sale_payments WHERE sale_id=?').bind(saleId).first();
    const events=await x.db.prepare("SELECT COUNT(*) AS n FROM domain_events WHERE aggregate_id=? AND type='sale.completed'").bind(saleId).first();
    const cash=await x.db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM cash_movements WHERE method='CASH'").bind().first();
    assert.deepEqual({payments:count.n,events:events.n,cashCents:cash.cents,change:initial.body.sale.changeCents},
      {payments:1,events:1,cashCents:reference.totalCents,change:reference.changeDueCents},
      'the retry creates exactly one desktop-equivalent posting');
  }finally{x.close();}
});

test('checkout-005/nominal sale-open-desktop-v2 creates one open sale with original zero totals',async()=>{
  const vector=desktopV2('sale-open-desktop-v2','checkout-005/nominal');
  const reference=desktopPricing.calculateSaleTotals(vector.input);
  assert.deepEqual(reference,vector.expected);
  const x=await setup();try{
    const opened=await x.write('a','sales',{branchId:'branch-a'});
    assert.equal(opened.status,201,opened.body.error);
    const saleId=opened.body.sale.id;
    const record=await x.db.prepare('SELECT status,subtotal_cents AS subtotalCents,discount_cents AS discountCents,total_cents AS totalCents FROM sales WHERE id=?').bind(saleId).first();
    assert.equal(record.status,vector.expectedStatus);
    assert.deepEqual({subtotalCents:record.subtotalCents,discountCents:record.discountCents,totalCents:record.totalCents},
      reference,'new sale state persists original desktop empty cart totals');
  }finally{x.close();}
});

test('checkout-005/authorization sale-open-authorization-desktop-v2 honors desktop sales.create profile',async()=>{
  const vector=desktopV2('sale-open-authorization-desktop-v2','checkout-005/authorization');
  referenceAuth(vector.capability,vector.permittedProfile,vector.deniedProfile);
  const x=await setup();try{
    const denied=await x.write('a','sales',{branchId:'branch-a'},{who:x.viewer});
    assert.equal(denied.status,vector.expectedDeniedHttp);
    const before=await x.db.prepare('SELECT COUNT(*) AS n FROM sales WHERE tenant_id=?').bind('a').first();
    assert.equal(before.n,0,'readonly user cannot open or persist a sale');
    const accepted=await x.write('a','sales',{branchId:'branch-a'});
    assert.equal(accepted.status,vector.expectedAllowedHttp);
    const after=await x.db.prepare('SELECT COUNT(*) AS n FROM sales WHERE tenant_id=?').bind('a').first();
    assert.deepEqual({before:before.n,after:after.n},{before:0,after:1},
      'original desktop permission separates allowed and denied actors in the API');
  }finally{x.close();}
});

test('checkout-005/tenant-isolation sale-open-tenant-desktop-v2 never reveals another tenant sale',async()=>{
  const vector=desktopV2('sale-open-tenant-desktop-v2','checkout-005/tenant-isolation');
  const readable=desktopAuthorization.createAuthorizationService({
    resolvePermissions:principal=>desktopProfiles.DEFAULT_PROFILE_PERMISSIONS[
      principal.id==='owner'?vector.permittedProfile:vector.deniedProfile]||[]
  });
  assert.equal(readable.can({principal:{kind:'human',id:'owner'},capability:vector.capability}),true);
  assert.equal(readable.can({principal:{kind:'human',id:'viewer'},capability:vector.capability}),true,
    'desktop READ_ONLY permits sales.view; tenant scoping is an independent API constraint');
  const x=await setup();try{
    const opened=await x.write('a','sales',{branchId:'branch-a'});
    assert.equal(opened.status,201,opened.body.error);
    const saleId=opened.body.sale.id;
    const foreign=await x.get('b','sales/'+saleId+'?branchId=branch-b',x.other);
    assert.equal(foreign.status,vector.foreignTenantStatus);
    const wrongBranch=await x.get('a','sales/'+saleId+'?branchId=branch-b');
    assert.equal(wrongBranch.status,404);
    const owner=await x.get('a','sales/'+saleId+'?branchId=branch-a');
    assert.equal(owner.status,200,owner.body.error);
    const persisted=await x.db.prepare('SELECT tenant_id AS tenantId FROM sales WHERE id=?').bind(saleId).first();
    assert.deepEqual({tenantId:persisted.tenantId,visible:owner.body.sale.id,foreignStatus:foreign.status},
      {tenantId:'a',visible:saleId,foreignStatus:404},'sale and customer metadata stay in the owning company');
  }finally{x.close();}
});

test('checkout-005/failure-recovery sale-open-recovery-desktop-v2 does not duplicate a timed out open',async()=>{
  const vector=desktopV2('sale-open-recovery-desktop-v2','checkout-005/failure-recovery');
  const reference=desktopPricing.calculateSaleTotals(vector.input);
  assert.deepEqual(reference,vector.expected);
  const x=await setup();try{
    const key=next(),body={branchId:'branch-a'};
    const opened=await x.write('a','sales',body,{key});
    assert.equal(opened.status,201,opened.body.error);
    const retry=await x.write('a','sales',body,{key});
    assert.deepEqual(retry.body,opened.body,'same request key reuses previously opened sale');
    const count=await x.db.prepare('SELECT COUNT(*) AS n FROM sales WHERE tenant_id=?').bind('a').first();
    assert.equal(count.n,vector.expectedPersistedRows,'network retry cannot duplicate a new sale');
    assert.deepEqual(saleTotals(opened.body.sale),reference,'reopened response keeps the original desktop empty total');
  }finally{x.close();}
});

test('checkout-006/nominal sale-items-desktop-v2 adds updates and removes with original pricing',async()=>{
  const vector=desktopV2('sale-items-desktop-v2','checkout-006/nominal');
  const original={
    initial:desktopPricing.calculateSaleTotals(vector.initial),
    updated:desktopPricing.calculateSaleTotals(vector.updated),
    empty:desktopPricing.calculateSaleTotals(vector.empty)
  };
  assert.deepEqual(original,vector.expected);
  const x=await setup();try{
    const {productId,saleId,added}=await certifiedSale(x,'CERT-ITEMS',2);
    assert.deepEqual(saleTotals(added.body.sale),original.initial);
    const updated=await x.write('a','sales/'+saleId+'/items/'+productId,
      {branchId:'branch-a',quantity:3},{method:'PUT'});
    assert.equal(updated.status,200,updated.body.error);
    assert.deepEqual(saleTotals(updated.body.sale),original.updated);
    const removed=await x.write('a','sales/'+saleId+'/items/'+productId,
      {branchId:'branch-a'},{method:'DELETE'});
    assert.equal(removed.status,200,removed.body.error);
    const record=await x.db.prepare('SELECT COUNT(*) AS n FROM sale_items WHERE sale_id=?').bind(saleId).first();
    assert.equal(record.n,0,'deleted item must disappear from authoritative SQLite');
    assert.deepEqual(saleTotals(removed.body.sale),original.empty,'all item mutations match the desktop golden totals');
  }finally{x.close();}
});


// P6 certification round: independently executed 20 scenarios (5 contracts x 4).
// Original desktop modules are byte-pinned in checkout-core-desktop-v1.json.
const desktopStockP6=originalRequire('../../../packages/core/js/domains/inventory/inventory-rules.js');
const desktopCashP6=originalRequire('../../../packages/core/js/domains/cash/cash-rules.js');
function p6Fixture(id){
  assertCheckoutDesktopSourcePinned();
  const row=checkoutGolden(id);
  assert.equal(row.desktopCommit,certifiedCheckoutFixture.desktop.commit);
  return row;
}
function p6Policy(capability,deniedProfile='READ_ONLY'){
  const authz=desktopAuthorization.createAuthorizationService({
    resolvePermissions:p=>desktopProfiles.DEFAULT_PROFILE_PERMISSIONS[
      p.id==='permitted'?'ADMINISTRATOR':deniedProfile
    ]||[]
  });
  assert.equal(authz.can({principal:{kind:'human',id:'permitted'},capability}),true);
  assert.equal(authz.can({principal:{kind:'human',id:'denied'},capability}),false);
}

test('products-020/nominal product-create-price-sku-v4 audited API SQLite comparison',async()=>{
 const fixture=p6Fixture('product-create-price-sku-v4');
 assert.equal(fixture.scenarioId,'products-020/nominal');
 const x=await setup();try{

 const input={branchId:'branch-a',name:'Produto Certificado',sku:'prd-case',salePriceCents:1000,unit:'UN'};
 const result=await x.write('a','products',input);
 assert.equal(result.status,201,result.body.error);
 const persisted=await x.db.prepare('SELECT name,sku,sale_price_cents AS price FROM products WHERE id=? AND tenant_id=?').bind(result.body.product.id,'a').first();
 assert.deepEqual({name:persisted.name,sku:persisted.sku,price:persisted.price},
   {name:input.name,sku:'PRD-CASE',price:input.salePriceCents},'canonical desktop catalog values persist in one authoritative row');
 const listed=await x.get('a','products?branchId=branch-a');
 assert.equal(listed.body.products[0].id,result.body.product.id);

 }finally{x.close();}
});

test('products-020/authorization product-create-rbac-v4 audited API SQLite comparison',async()=>{
 const fixture=p6Fixture('product-create-rbac-v4');
 assert.equal(fixture.scenarioId,'products-020/authorization');
 const x=await setup();try{

 p6Policy('products.manage','READ_ONLY');
 const input={branchId:'branch-a',name:'Permission product',sku:'AUTH-P',salePriceCents:1000};
 const denied=await x.write('a','products',input,{who:x.viewer});
 assert.equal(denied.status,403);
 const row=await x.db.prepare('SELECT COUNT(*) AS n FROM products WHERE tenant_id=?').bind('a').first();
 assert.equal(row.n,0,'read-only desktop profile cannot write catalog rows');
 const accepted=await x.write('a','products',input);
 assert.equal(accepted.status,201,accepted.body.error);

 }finally{x.close();}
});

test('products-020/tenant-isolation product-cross-tenant-v4 audited API SQLite comparison',async()=>{
 const fixture=p6Fixture('product-cross-tenant-v4');
 assert.equal(fixture.scenarioId,'products-020/tenant-isolation');
 const x=await setup();try{

 const input={branchId:'branch-a',name:'Hidden product',sku:'TEN-C',salePriceCents:1000};
 const a=await x.write('a','products',input);assert.equal(a.status,201,a.body.error);
 const hidden=await x.get('b','products?branchId=branch-b',x.other);
 assert.equal(hidden.status,200,hidden.body.error);
 assert.equal(hidden.body.products.some(p=>p.id===a.body.product.id),false);
 const denied=await x.get('a','products?branchId=branch-b');
 assert.equal(denied.status,404);
 const sql=await x.db.prepare('SELECT tenant_id AS tenant FROM products WHERE id=?').bind(a.body.product.id).first();
 assert.equal(sql.tenant,'a','product is owned by original tenant, never exposed across company boundary');

 }finally{x.close();}
});

test('products-020/failure-recovery product-idempotent-sku-v4 audited API SQLite comparison',async()=>{
 const fixture=p6Fixture('product-idempotent-sku-v4');
 assert.equal(fixture.scenarioId,'products-020/failure-recovery');
 const x=await setup();try{

 const payload={branchId:'branch-a',name:'Unico SKU',sku:'UNIQUE-C',salePriceCents:1000},key=next();
 const one=await x.write('a','products',payload,{key});assert.equal(one.status,201,one.body.error);
 const retry=await x.write('a','products',payload,{key});
 assert.deepEqual(retry.body,one.body,'same mutation key reuses the committed catalog result');
 const collision=await x.write('a','products',{...payload,name:'Another product'},{key:next()});
 assert.equal(collision.status,409);
 const count=await x.db.prepare('SELECT COUNT(*) AS n FROM products WHERE tenant_id=? AND sku=?').bind('a','UNIQUE-C').first();
 assert.equal(count.n,1,'retry or SKU race cannot duplicate the catalog');

 }finally{x.close();}
});

test('products-021/nominal stock-ledger-quantity-v4 audited API SQLite comparison',async()=>{
 const fixture=p6Fixture('stock-ledger-quantity-v4');
 assert.equal(fixture.scenarioId,'products-021/nominal');
 const x=await setup();try{

 const pid=await x.id('Stock reference','STOCK-P0',2.125);
 const expected=desktopStockP6.applyStockDelta(0,2.125);
 assert.deepEqual(expected,{before:0,after:2.125,delta:2.125});
 const stock=await x.get('a','inventory?branchId=branch-a');
 assert.equal(stock.status,200,stock.body.error);
 const actual=stock.body.stock.find(row=>row.productId===pid)?.quantity;
 assert.equal(actual,expected.after,'stock projection equals desktop 3-decimal inventory engine');
 const ledger=await x.db.prepare('SELECT SUM(delta_milli) AS quantityMilli FROM inventory_movements WHERE product_id=?').bind(pid).first();
 assert.equal(ledger.quantityMilli,2125);

 }finally{x.close();}
});

test('products-021/authorization stock-view-adjust-rbac-v4 audited API SQLite comparison',async()=>{
 const fixture=p6Fixture('stock-view-adjust-rbac-v4');
 assert.equal(fixture.scenarioId,'products-021/authorization');
 const x=await setup();try{

 p6Policy('inventory.view','KITCHEN');
 const pid=await x.id('Readonly stock','STOCK-VIEW',2);
 const readonly=await x.get('a','inventory?branchId=branch-a',x.viewer);
 assert.equal(readonly.status,200,readonly.body.error);
 const denied=await x.write('a','inventory/adjustments',{branchId:'branch-a',productId:pid,quantityDelta:-1,reason:'Not authorized'},{who:x.viewer});
 assert.equal(denied.status,403);
 const after=await x.get('a','inventory?branchId=branch-a');
 assert.equal(after.body.stock.find(s=>s.productId===pid).quantity,desktopStockP6.applyStockDelta(0,2).after,
   'view-only actor cannot modify original desktop stock projection');

 }finally{x.close();}
});

test('products-021/tenant-isolation stock-tenant-branch-v4 audited API SQLite comparison',async()=>{
 const fixture=p6Fixture('stock-tenant-branch-v4');
 assert.equal(fixture.scenarioId,'products-021/tenant-isolation');
 const x=await setup();try{

 const pid=await x.id('Company A stock','STOCK-TENANT',2.125);
 const own=await x.get('a','inventory?branchId=branch-a');
 assert.equal(own.status,200);
 const foreign=await x.get('b','inventory?branchId=branch-b',x.other);
 assert.equal(foreign.status,200);
 assert.equal(foreign.body.stock.some(p=>p.productId===pid),false);
 const blocked=await x.get('a','inventory?branchId=branch-b');
 assert.equal(blocked.status,404);
 const sum=await x.db.prepare('SELECT SUM(delta_milli) AS milli FROM inventory_movements WHERE tenant_id=? AND product_id=?').bind('a',pid).first();
 assert.equal(sum.milli,2125,'stock journal retains tenant-specific ownership and exact precision');

 }finally{x.close();}
});

test('products-021/failure-recovery stock-idempotent-negative-v4 audited API SQLite comparison',async()=>{
 const fixture=p6Fixture('stock-idempotent-negative-v4');
 assert.equal(fixture.scenarioId,'products-021/failure-recovery');
 const x=await setup();try{

 const pid=await x.id('Stock retry','STOCK-RETRY',2.125);
 const expected=desktopStockP6.applyStockDelta(2.125,-1.125);
 assert.equal(expected.after,1);
 const body={branchId:'branch-a',productId:pid,quantityDelta:-1.125,reason:'Valid breakage reconciliation'},key=next();
 const first=await x.write('a','inventory/adjustments',body,{key});
 assert.equal(first.status,201,first.body.error);
 const retry=await x.write('a','inventory/adjustments',body,{key});
 assert.deepEqual(retry.body,first.body);
 assert.throws(()=>desktopStockP6.applyStockDelta(1,-2));
 const negative=await x.write('a','inventory/adjustments',{...body,quantityDelta:-2},{key:next()});
 assert.equal(negative.status,409);
 const stock=await x.get('a','inventory?branchId=branch-a');
 assert.equal(stock.body.stock.find(p=>p.productId===pid).quantity,expected.after,
   'failed negative adjustment and retry cannot double-consume remaining stock');

 }finally{x.close();}
});

test('cash-040/nominal cash-initial-balance-v4 audited API SQLite comparison',async()=>{
 const fixture=p6Fixture('cash-initial-balance-v4');
 assert.equal(fixture.scenarioId,'cash-040/nominal');
 const x=await setup();try{

 const vector=desktopCashP6.calculateCashClosing({initialCashCents:2000,countedByMethod:{CASH:2000}});
 assert.equal(vector.expectedCashCents,2000);
 assert.equal(vector.status,'balanced');
 const opened=await x.write('a','cash/open',{branchId:'branch-a',openingCents:2000});
 assert.equal(opened.status,201,opened.body.error);
 const state=await x.get('a','cash?branchId=branch-a');
 assert.equal(state.status,200,state.body.error);
 assert.equal(state.body.session.expectedCashCents,vector.expectedCashCents);
 const row=await x.db.prepare('SELECT opening_cents AS cents FROM cash_sessions WHERE id=?').bind(opened.body.session.id).first();
 assert.equal(row.cents,vector.expectedCashCents,'cash opening stored at exactly the original desktop cent amount');

 }finally{x.close();}
});

test('cash-040/authorization cash-open-rbac-v4 audited API SQLite comparison',async()=>{
 const fixture=p6Fixture('cash-open-rbac-v4');
 assert.equal(fixture.scenarioId,'cash-040/authorization');
 const x=await setup();try{

 p6Policy('cash.open','READ_ONLY');
 const denied=await x.write('a','cash/open',{branchId:'branch-a',openingCents:2000},{who:x.viewer});
 assert.equal(denied.status,403);
 const before=await x.db.prepare('SELECT COUNT(*) AS n FROM cash_sessions WHERE tenant_id=?').bind('a').first();
 assert.equal(before.n,0);
 const accepted=await x.write('a','cash/open',{branchId:'branch-a',openingCents:2000});
 assert.equal(accepted.status,201,accepted.body.error);
 const after=await x.db.prepare('SELECT COUNT(*) AS n FROM cash_sessions WHERE tenant_id=?').bind('a').first();
 assert.equal(after.n,1,'only owner with original desktop cash.open capability creates a cash session');

 }finally{x.close();}
});

test('cash-040/tenant-isolation cash-cross-tenant-v4 audited API SQLite comparison',async()=>{
 const fixture=p6Fixture('cash-cross-tenant-v4');
 assert.equal(fixture.scenarioId,'cash-040/tenant-isolation');
 const x=await setup();try{

 const opened=await x.write('a','cash/open',{branchId:'branch-a',openingCents:2000});
 assert.equal(opened.status,201);
 const hidden=await x.get('b','cash?branchId=branch-b',x.other);
 assert.equal(hidden.status,200);
 assert.equal(hidden.body.session,null);
 const foreign=await x.get('a','cash?branchId=branch-b');
 assert.equal(foreign.status,404);
 const row=await x.db.prepare('SELECT tenant_id AS tenant,opening_cents AS cents FROM cash_sessions WHERE id=?').bind(opened.body.session.id).first();
 assert.deepEqual({tenant:row.tenant,cents:row.cents},{tenant:'a',cents:2000},
   'the original desktop drawer amount cannot escape its tenant scope');

 }finally{x.close();}
});

test('cash-040/failure-recovery cash-single-drawer-v4 audited API SQLite comparison',async()=>{
 const fixture=p6Fixture('cash-single-drawer-v4');
 assert.equal(fixture.scenarioId,'cash-040/failure-recovery');
 const x=await setup();try{

 const baseline=desktopCashP6.calculateCashClosing({initialCashCents:2000});
 assert.equal(baseline.expectedCashCents,2000);
 const body={branchId:'branch-a',openingCents:2000},key=next();
 const open=await x.write('a','cash/open',body,{key});
 assert.equal(open.status,201,open.body.error);
 const replay=await x.write('a','cash/open',body,{key});
 assert.deepEqual(replay.body,open.body);
 const another=await x.write('a','cash/open',body,{key:next()});
 assert.equal(another.status,409);
 const row=await x.db.prepare("SELECT COUNT(*) AS n FROM cash_sessions WHERE tenant_id='a' AND branch_id='branch-a' AND status='OPEN'").bind().first();
 assert.equal(row.n,1,'duplicate terminal opening cannot create two authoritative drawers');

 }finally{x.close();}
});

test('history-033/nominal sale-history-status-v4 audited API SQLite comparison',async()=>{
 const fixture=p6Fixture('sale-history-status-v4');
 assert.equal(fixture.scenarioId,'history-033/nominal');
 const x=await setup();try{

 const a=await x.write('a','sales',{branchId:'branch-a'}),b=await x.write('a','sales',{branchId:'branch-a'});
 assert.equal(a.status,201);
 assert.equal(b.status,201);
 const suspend=await x.write('a','sales/'+a.body.sale.id+'/suspend',{branchId:'branch-a'});
 assert.equal(suspend.status,200,suspend.body.error);
 const listed=await x.get('a','sales/history?branchId=branch-a');
 assert.equal(listed.status,200,listed.body.error);
 const statuses=new Set(listed.body.history.items.map(row=>row.status));
 assert.deepEqual([...statuses].sort(),['OPEN','SUSPENDED'],
   'desktop sale-service OPEN/SUSPENDED state persists into canonical history');
 const original=await x.db.prepare('SELECT COUNT(*) AS n FROM sales WHERE tenant_id=?').bind('a').first();
 assert.equal(original.n,2);

 }finally{x.close();}
});

test('history-033/authorization sale-history-read-rbac-v4 audited API SQLite comparison',async()=>{
 const fixture=p6Fixture('sale-history-read-rbac-v4');
 assert.equal(fixture.scenarioId,'history-033/authorization');
 const x=await setup();try{

 const opened=await x.write('a','sales',{branchId:'branch-a'});
 assert.equal(opened.status,201);
 const readOnly=await x.get('a','sales/history?branchId=branch-a',x.viewer);
 assert.equal(readOnly.status,200,'desktop READ_ONLY profile grants sales.view');
 p6Policy('sales.view','KITCHEN');
 await x.db.prepare('UPDATE tenant_memberships SET profile_key=? WHERE tenant_id=? AND user_id=?').bind('KITCHEN','a','viewer').run();
 const denied=await x.get('a','sales/history?branchId=branch-a',x.viewer);
 assert.equal(denied.status,403);
 const rows=await x.db.prepare('SELECT COUNT(*) AS n FROM sales WHERE tenant_id=?').bind('a').first();
 assert.equal(rows.n,1,'read access policy cannot mutate the desktop sale history');

 }finally{x.close();}
});

test('history-033/tenant-isolation sale-history-tenant-v4 audited API SQLite comparison',async()=>{
 const fixture=p6Fixture('sale-history-tenant-v4');
 assert.equal(fixture.scenarioId,'history-033/tenant-isolation');
 const x=await setup();try{

 const opened=await x.write('a','sales',{branchId:'branch-a'});
 assert.equal(opened.status,201);
 const foreign=await x.get('b','sales/history?branchId=branch-b',x.other);
 assert.equal(foreign.status,200);
 assert.equal(foreign.body.history.total,0);
 const wrongBranch=await x.get('a','sales/history?branchId=branch-b');
 assert.equal(wrongBranch.status,404);
 const correct=await x.get('a','sales/history?branchId=branch-a');
 assert.equal(correct.body.history.total,1);
 const persisted=await x.db.prepare('SELECT tenant_id AS tenant FROM sales WHERE id=?').bind(opened.body.sale.id).first();
 assert.equal(persisted.tenant,'a','desktop sale journal remains on the original company');

 }finally{x.close();}
});

test('history-033/failure-recovery sale-history-resume-v4 audited API SQLite comparison',async()=>{
 const fixture=p6Fixture('sale-history-resume-v4');
 assert.equal(fixture.scenarioId,'history-033/failure-recovery');
 const x=await setup();try{

 const mutation=next(),payload={branchId:'branch-a'};
 const opened=await x.write('a','sales',payload,{key:mutation});
 assert.equal(opened.status,201);
 const replay=await x.write('a','sales',payload,{key:mutation});
 assert.deepEqual(replay.body,opened.body);
 const first=await x.get('a','sales/history?branchId=branch-a');
 const second=await x.get('a','sales/history?branchId=branch-a');
 assert.deepEqual(second.body,first.body,'history recovery after repeated read is stable and side-effect-free');
 const count=await x.db.prepare('SELECT COUNT(*) AS n FROM sales WHERE tenant_id=?').bind('a').first();
 assert.equal(count.n,1,'retried sale opening cannot duplicate persisted original-desktop history');

 }finally{x.close();}
});

test('checkout-010/nominal price-override-recalculate-v4 audited API SQLite comparison',async()=>{
 const fixture=p6Fixture('price-override-recalculate-v4');
 assert.equal(fixture.scenarioId,'checkout-010/nominal');
 const x=await setup();try{

 p6Policy('sales.discount');
 const pid=await x.id('Price override case','PRICE-NOM',5);
 const opened=await x.write('a','sales',{branchId:'branch-a'});
 const sid=opened.body.sale.id;
 const added=await x.write('a','sales/'+sid+'/items',{branchId:'branch-a',productId:pid,quantity:2});
 assert.equal(added.status,200,added.body.error);
 const itemId=added.body.sale.items[0].id;
 const response=await x.write('a','sales/'+sid+'/items/'+itemId+'/price',
   {branchId:'branch-a',unitPriceCents:850,reason:'Price approved for customer'},{method:'PUT'});
 assert.equal(response.status,200,response.body.error);
 const original=desktopPricing.calculateSaleTotals({items:[{unitPriceCents:850,quantity:2}]});
 assert.equal(response.body.sale.totalCents,original.totalCents,'authorized price override recalculates with pinned desktop pricing.js');
 const ledger=await x.db.prepare('SELECT old_price_cents AS before,new_price_cents AS after FROM sale_item_price_overrides WHERE sale_id=?').bind(sid).first();
 assert.deepEqual({before:ledger.before,after:ledger.after},{before:1000,after:850});

 }finally{x.close();}
});

test('checkout-010/authorization price-override-rbac-v4 audited API SQLite comparison',async()=>{
 const fixture=p6Fixture('price-override-rbac-v4');
 assert.equal(fixture.scenarioId,'checkout-010/authorization');
 const x=await setup();try{

 p6Policy('sales.discount','READ_ONLY');
 const pid=await x.id('Override denied','PRICE-AUTH',3);
 const opened=await x.write('a','sales',{branchId:'branch-a'});
 const sid=opened.body.sale.id;
 const added=await x.write('a','sales/'+sid+'/items',{branchId:'branch-a',productId:pid,quantity:1});
 const itemId=added.body.sale.items[0].id;
 const payload={branchId:'branch-a',unitPriceCents:850,reason:'Authorized pricing change'};
 const denied=await x.write('a','sales/'+sid+'/items/'+itemId+'/price',payload,{who:x.viewer,method:'PUT'});
 assert.equal(denied.status,403);
 const original=desktopPricing.calculateSaleTotals({items:[{unitPriceCents:1000,quantity:1}]});
 const saved=await x.get('a','sales/'+sid+'?branchId=branch-a');
 assert.equal(saved.body.sale.totalCents,original.totalCents,'unauthorized actor cannot change original desktop price');
 const ledger=await x.db.prepare('SELECT COUNT(*) AS n FROM sale_item_price_overrides WHERE sale_id=?').bind(sid).first();
 assert.equal(ledger.n,0);

 }finally{x.close();}
});

test('checkout-010/tenant-isolation price-override-tenant-v4 audited API SQLite comparison',async()=>{
 const fixture=p6Fixture('price-override-tenant-v4');
 assert.equal(fixture.scenarioId,'checkout-010/tenant-isolation');
 const x=await setup();try{

 const pid=await x.id('Owner-only price','PRICE-TENANT',3);
 const opened=await x.write('a','sales',{branchId:'branch-a'});
 const sid=opened.body.sale.id;
 const added=await x.write('a','sales/'+sid+'/items',{branchId:'branch-a',productId:pid,quantity:1});
 const itemId=added.body.sale.items[0].id;
 const foreign=await x.write('b','sales/'+sid+'/items/'+itemId+'/price',
   {branchId:'branch-b',unitPriceCents:850,reason:'Attempt foreign discount'},{who:x.other,method:'PUT'});
 assert.equal(foreign.status,404);
 const saved=await x.get('a','sales/'+sid+'?branchId=branch-a');
 assert.equal(saved.body.sale.totalCents,desktopPricing.calculateSaleTotals({items:[{unitPriceCents:1000,quantity:1}]}).totalCents);
 const audit=await x.db.prepare('SELECT COUNT(*) AS n FROM sale_item_price_overrides WHERE sale_id=?').bind(sid).first();
 assert.equal(audit.n,0,'foreign tenant cannot change price or create audit entries in another company');

 }finally{x.close();}
});

test('checkout-010/failure-recovery price-override-retry-v4 audited API SQLite comparison',async()=>{
 const fixture=p6Fixture('price-override-retry-v4');
 assert.equal(fixture.scenarioId,'checkout-010/failure-recovery');
 const x=await setup();try{

 const pid=await x.id('Audited retry pricing','PRICE-RETRY',3);
 const opened=await x.write('a','sales',{branchId:'branch-a'});
 const sid=opened.body.sale.id;
 const added=await x.write('a','sales/'+sid+'/items',{branchId:'branch-a',productId:pid,quantity:1});
 const itemId=added.body.sale.items[0].id;
 const path='sales/'+sid+'/items/'+itemId+'/price';
 const body={branchId:'branch-a',unitPriceCents:850,reason:'Repeatable audited manager change'},key=next();
 const first=await x.write('a',path,body,{method:'PUT',key});
 assert.equal(first.status,200,first.body.error);
 const again=await x.write('a',path,body,{method:'PUT',key});
 assert.deepEqual(again.body,first.body);
 const bad=await x.write('a',path,{...body,reason:'a'},{method:'PUT',key:next()});
 assert.equal(bad.status,400);
 const ledger=await x.db.prepare('SELECT COUNT(*) AS n FROM sale_item_price_overrides WHERE sale_id=?').bind(sid).first();
 assert.equal(ledger.n,1,'replay and invalid request cannot duplicate immutable price change audit');
 assert.equal(first.body.sale.totalCents,desktopPricing.calculateSaleTotals({items:[{unitPriceCents:850,quantity:1}]}).totalCents);

 }finally{x.close();}
});

test('R1 checkout transition retries are keyed: late suspend replay never re-suspends a resumed sale',async()=>{
  const x=await setup();try{
    const opened=await x.write('a','sales',{branchId:'branch-a'});
    assert.equal(opened.status,201,opened.body.error);
    const saleId=opened.body.sale.id;
    const suspendKey=next(),resumeKey=next();
    const suspend=await x.write('a','sales/'+saleId+'/suspend',{branchId:'branch-a'},{key:suspendKey});
    assert.equal(suspend.status,200,suspend.body.error);
    assert.equal(suspend.body.sale.status,'SUSPENDED');
    const wrongKey=await x.write('a','sales/'+saleId+'/resume',{branchId:'branch-a'},{key:suspendKey});
    assert.equal(wrongKey.status,409,'same operation ID must not be reusable for a different transition');
    const resume=await x.write('a','sales/'+saleId+'/resume',{branchId:'branch-a'},{key:resumeKey});
    assert.equal(resume.status,200,resume.body.error);
    assert.equal(resume.body.sale.status,'OPEN');
    // A delayed network retry of the first suspend must never roll back the later resume.
    const delayed=await x.write('a','sales/'+saleId+'/suspend',{branchId:'branch-a'},{key:suspendKey});
    assert.equal(delayed.status,200,delayed.body.error);
    assert.equal(delayed.body.sale.status,'OPEN');
    const replayResume=await x.write('a','sales/'+saleId+'/resume',{branchId:'branch-a'},{key:resumeKey});
    assert.equal(replayResume.status,200,replayResume.body.error);
    assert.equal(replayResume.body.sale.status,'OPEN');
    const mutations=await x.db.prepare("SELECT scope,COUNT(*) AS n FROM commerce_mutations WHERE tenant_id=? AND scope LIKE 'sale.transition:%' GROUP BY scope").bind('a').all();
    assert.equal(mutations.results.length,1,'both transitions share one sale-scoped ledger, distinct mutation IDs');
    assert.equal(mutations.results[0].n,2,'no extra transition mutation can be inserted on replay');
    const unexpected=await x.write('a','sales/'+saleId+'/resume',{branchId:'branch-a'});
    assert.equal(unexpected.status,409,'new resume when already OPEN must remain a conflict');
  }finally{x.close();}
});

test('R1 checkout transitions require mutation ID, respect roles and cross-tenant boundaries without mutation',async()=>{
  const x=await setup();try{
    const opened=await x.write('a','sales',{branchId:'branch-a'});
    assert.equal(opened.status,201,opened.body.error);
    const saleId=opened.body.sale.id;
    const missing=await x.call(x.path('a','sales/'+saleId+'/suspend'),{
      method:'POST',cookie:x.owner,body:{branchId:'branch-a'}
    });
    assert.equal(missing.status,400,'suspend retries must carry a stable operation key');
    assert.equal((await x.write('a','sales/'+saleId+'/suspend',{branchId:'branch-a'},{who:x.viewer})).status,403);
    assert.equal((await x.write('b','sales/'+saleId+'/suspend',{branchId:'branch-b'},{who:x.other})).status,404);
    const unchanged=await x.get('a','sales/'+saleId+'?branchId=branch-a');
    assert.equal(unchanged.body.sale.status,'OPEN');
    const key=next();
    assert.equal((await x.write('a','sales/'+saleId+'/cancel',{branchId:'branch-a'},{key})).status,200);
    assert.equal((await x.write('a','sales/'+saleId+'/cancel',{branchId:'branch-a'},{key})).status,200,
      'retry cancellation of an open sale must not report failure after commit');
    const cancelled=await x.get('a','sales/'+saleId+'?branchId=branch-a');
    assert.equal(cancelled.body.sale.status,'CANCELLED');
    assert.equal((await x.write('a','sales/'+saleId+'/resume',{branchId:'branch-a'})).status,409);
  }finally{x.close();}
});

test('R1 cart mutations use operation receipts: delayed item, discount and removal retries never undo newer changes',async()=>{
  const x=await setup();try{
    const productId=await x.id('Item de teste R1','R1-ITEM',20);
    const opened=await x.write('a','sales',{branchId:'branch-a'});
    assert.equal(opened.status,201);
    const id=opened.body.sale.id;
    assert.equal((await x.write('a','sales/'+id+'/items',{branchId:'branch-a',productId,quantity:1})).status,200);
    const changeKey=next();
    assert.equal((await x.write('a','sales/'+id+'/items/'+productId,{branchId:'branch-a',quantity:2},{key:changeKey,method:'PUT'})).status,200);
    assert.equal((await x.write('a','sales/'+id+'/items/'+productId,{branchId:'branch-a',quantity:3},{method:'PUT'})).status,200);
    const staleQuantity=await x.write('a','sales/'+id+'/items/'+productId,{branchId:'branch-a',quantity:2},{key:changeKey,method:'PUT'});
    assert.equal(staleQuantity.status,200);
    assert.equal(staleQuantity.body.sale.items[0].quantity,3,'late quantity retry must not overwrite newer quantity');
    const discountKey=next();
    assert.equal((await x.write('a','sales/'+id+'/discount',{branchId:'branch-a',discountCents:100},{key:discountKey})).status,200);
    assert.equal((await x.write('a','sales/'+id+'/discount',{branchId:'branch-a',discountCents:300})).status,200);
    const staleDiscount=await x.write('a','sales/'+id+'/discount',{branchId:'branch-a',discountCents:100},{key:discountKey});
    assert.equal(staleDiscount.status,200);
    assert.equal(staleDiscount.body.sale.discountCents,300,'late discount retry must not revert discount');
    const removeKey=next();
    assert.equal((await x.write('a','sales/'+id+'/items/'+productId,{branchId:'branch-a'},{key:removeKey,method:'DELETE'})).status,200);
    assert.equal((await x.write('a','sales/'+id+'/items',{branchId:'branch-a',productId,quantity:1})).status,200);
    const staleRemove=await x.write('a','sales/'+id+'/items/'+productId,{branchId:'branch-a'},{key:removeKey,method:'DELETE'});
    assert.equal(staleRemove.status,200);
    assert.equal(staleRemove.body.sale.items.length,1,'late remove retry cannot delete an item re-added later');
    const ledger=await x.db.prepare("SELECT scope,COUNT(*) AS n FROM commerce_mutations WHERE tenant_id=? AND scope LIKE ? GROUP BY scope").bind('a','sale.%:'+id+'%').all();
    assert.equal(ledger.results.length>=3,true);
  }finally{x.close();}
});

test('R1 checkout-011/012: replayed customer and seller selections cannot reverse newer edits',async()=>{
 const x=await setup();try{
  const a=await x.write('a','customers',{branchId:'branch-a',name:'Cliente Alpha'});
  const b=await x.write('a','customers',{branchId:'branch-a',name:'Cliente Beta'});
  assert.equal(a.status,201);assert.equal(b.status,201);
  const first=a.body.customer.id,second=b.body.customer.id;
  const opened=await x.write('a','sales',{branchId:'branch-a'});
  assert.equal(opened.status,201);
  const id=opened.body.sale.id;
  const customerPath='sales/'+id+'/customer',sellerPath='sales/'+id+'/seller';
  const customerKey=next(),sellerKey=next();
  assert.equal((await x.write('a',customerPath,{branchId:'branch-a',customerId:first},{key:customerKey})).status,200);
  assert.equal((await x.write('a',customerPath,{branchId:'branch-a',customerId:second})).status,200);
  assert.equal((await x.write('a',customerPath,{branchId:'branch-a',customerId:first},{key:customerKey})).status,200);
  assert.equal((await x.get('a','sales/'+id+'?branchId=branch-a')).body.sale.customerId,second,
    'out-of-order HTTP replay must not reassign an older customer');
  assert.equal((await x.write('a',sellerPath,{branchId:'branch-a',sellerId:'viewer'},{key:sellerKey})).status,200);
  assert.equal((await x.write('a',sellerPath,{branchId:'branch-a',sellerId:'owner'})).status,200);
  assert.equal((await x.write('a',sellerPath,{branchId:'branch-a',sellerId:'viewer'},{key:sellerKey})).status,200);
  assert.equal((await x.get('a','sales/'+id+'?branchId=branch-a')).body.sale.sellerId,'owner',
    'out-of-order HTTP replay must not overwrite the newest commission recipient');
  assert.equal((await x.write('a',customerPath,{branchId:'branch-a',customerId:second},{key:customerKey})).status,409,
    'same mutation ID with different customer is a conflict');
  assert.equal((await x.write('a',sellerPath,{branchId:'branch-a',sellerId:'owner'},{key:sellerKey})).status,409,
    'same mutation ID with different seller is a conflict');
  assert.equal((await x.write('a',sellerPath,{branchId:'branch-a',sellerId:'viewer'},{who:x.viewer})).status,403,
    'read-only user cannot change seller and commissions');
  assert.equal((await x.write('b',sellerPath,{branchId:'branch-b',sellerId:'viewer'},{who:x.other})).status,404,
    'other tenant must not access sale');
  const noKey=await x.call(x.path('a',customerPath),{cookie:x.owner,body:{branchId:'branch-a',customerId:first},method:'POST'});
  assert.equal(noKey.status,400,'every person/seller mutation must be traceable and retry-safe');
  const receipts=await x.db.prepare("SELECT COUNT(*) AS n FROM commerce_mutations WHERE tenant_id=? AND scope IN (?,?)")
    .bind('a','sale.customer:'+id,'sale.seller:'+id).first();
  assert.equal(receipts.n,4,'each distinct accepted selection has one transaction receipt');
 }finally{x.close();}
});

test('R1 checkout-017/019: configured item quantity, removal and stale replay preserve parent totals',async()=>{
 const x=await setup();try{
  const pid=await x.id('Crepe Personalizável','CREPE-R1',10);
  const config={branchId:'branch-a',variants:[
    {id:'normal',name:'Normal',priceDeltaCents:0},
    {id:'large',name:'Grande',priceDeltaCents:300}
  ],groups:[{id:'extras',name:'Extras',selectionType:'MULTIPLE',minSelections:1,maxSelections:1,
    options:[{id:'cheese',name:'Queijo',priceDeltaCents:150}]}]};
  assert.equal((await x.write('a','products/'+pid+'/configuration',config,{method:'PUT'})).status,200);
  const sid=(await x.write('a','sales',{branchId:'branch-a'})).body.sale.id;
  const addItem=variantId=>x.write('a',`sales/${sid}/items/configured`,{
    branchId:'branch-a',productId:pid,quantity:1,variantId,selections:['cheese']});
  assert.equal((await addItem('normal')).status,200);
  const larger=await addItem('large');assert.equal(larger.status,200);
  let lines=larger.body.sale.items;
  assert.equal(lines.length,2);
  const normal=lines.find(line=>line.configuration.variant.id==='normal');
  const large=lines.find(line=>line.configuration.variant.id==='large');
  assert.ok(normal?.id&&large?.id);
  const route=`sales/${sid}/items/${normal.id}/configured`,oldKey=next();
  assert.equal((await x.write('a',route,{branchId:'branch-a',quantity:2},{method:'PUT',key:oldKey})).status,200);
  assert.equal((await x.write('a',route,{branchId:'branch-a',quantity:3},{method:'PUT'})).status,200);
  const replay=await x.write('a',route,{branchId:'branch-a',quantity:2},{method:'PUT',key:oldKey});
  assert.equal(replay.status,200);
  assert.equal(replay.body.sale.items.find(item=>item.id===normal.id).quantity,3);
  assert.equal((await x.write('a',route,{branchId:'branch-a',quantity:4},{method:'PUT',key:oldKey})).status,409,
    'same request ID cannot apply a different configured quantity');
  const largeRoute=`sales/${sid}/items/${large.id}/configured`,removeKey=next();
  assert.equal((await x.write('a',largeRoute,{branchId:'branch-a'},{method:'DELETE',key:removeKey})).status,200);
  const again=await addItem('large');assert.equal(again.status,200);
  const newLarge=again.body.sale.items.find(line=>line.configuration.variant.id==='large');
  assert.ok(newLarge?.id && newLarge.id!==large.id);
  const stale=await x.write('a',largeRoute,{branchId:'branch-a'},{method:'DELETE',key:removeKey});
  assert.equal(stale.status,200);
  assert.equal(stale.body.sale.items.length,2);
  assert.equal(stale.body.sale.items.find(item=>item.id===newLarge.id).quantity,1);
  assert.equal(stale.body.sale.items.find(item=>item.id===normal.id).quantity,3);
  const parent=await x.db.prepare('SELECT quantity_milli AS qty FROM sale_items WHERE sale_id=?').bind(sid).first();
  assert.equal(parent.qty,4000,'shared physical parent mirrors its configured children exactly');
  assert.equal((await x.write('b',route,{branchId:'branch-b',quantity:2},{method:'PUT',who:x.other})).status,404);
  assert.equal((await x.write('a',route,{branchId:'branch-a',quantity:2},{method:'PUT',who:x.viewer})).status,403);
 }finally{x.close();}
});
