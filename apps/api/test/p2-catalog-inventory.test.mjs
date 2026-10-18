import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createCommerceService} from '../src/commerce.mjs';
const now='2026-10-17T15:00:00.000Z';
let n=0;const key=()=> 'p2-key-'+(++n);
const sql=name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');
async function setup(){
  const db=openLocalDatabase();
  for(const x of ['0001_identity.sql','0002_commerce.sql','0003_cash_finance.sql','0004_advanced_finance.sql',
    '0005_vertical_parity.sql','0006_desktop_parity.sql','0007_stock_transfers.sql',
    '0008_transaction_reversals.sql','0009_catalog_inventory.sql','0010_purchase_orders.sql','0011_product_media.sql','0012_sale_item_notes.sql','0013_cash_terminals.sql','0014_checkout_configurations.sql','0015_seller_sales_targets.sql','0016_inventory_lot_receipts.sql','0017_inventory_minimum_levels.sql','0018_inventory_lot_balances.sql'])db.exec(sql(x));
  await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
    .bind('u','u@test.example','Operador','unused',now).run();
  for(const [t,b] of [['a','x'],['b','y']]){
    await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind(t,'shop-'+t,t,now).run();
    await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)').bind(b,t,'MAIN','Principal',now).run();
  }
  await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)').bind('a','u','OWNER',now).run();
  const service=createCommerceService(db,{now:()=>now});
  async function create(sku,price=1000,trackStock=true,extra={}){
    return service.createProduct('a','u',{name:'Produto '+sku,sku,salePriceCents:price,trackStock,...extra},key());
  }
  async function receipt(productId,quantity,unitCostCents){
    return service.receipt('a','x','u',{productId,quantity,unitCostCents,supplierId:null},key());
  }
  async function sale(items,paymentCents){
    const opened=await service.openSale('a','x','u',{},key());
    for(const item of items)await service.addItem('a','x',opened.id,{productId:item.id,quantity:item.quantity},key());
    await service.complete('a','x',opened.id,'u',{payments:[{method:'PIX',amountCents:paymentCents}]},key());
    return service.sale('a','x',opened.id);
  }
  const scalar=async(sql,...values)=>(await db.prepare(sql).bind(...values).first()).n;
  return {db,service,create,receipt,sale,scalar,close:()=>db.close()};
}
test('P2 category, barcode and parent/variant identity are tenant-safe, searchable, and enforce unique barcode',async()=>{
 const x=await setup();try{
   const c=await x.service.createCategory('a','x','u',{name:'Bebidas'},key());
   const parent=await x.create('REF-BASE',0,false,{brand:'ArtiSys',categoryId:c.id,barcode:'7891234567890'});
   const child=await x.create('REF-AZUL',1500,true,{brand:'ArtiSys',categoryId:c.id,parentProductId:parent.id,variantLabel:'Azul',barcode:'7891234567891'});
   const listed=await x.service.products('a','x',{includeInactive:true});
   assert.equal(listed.find(p=>p.id===child.id).parentProductId,parent.id);
   assert.equal(listed.find(p=>p.id===child.id).variantLabel,'Azul');
   assert.equal(listed.find(p=>p.id===child.id).categoryId,c.id);
   assert.equal(listed.find(p=>p.id===child.id).barcode,'7891234567891');
   assert.equal(listed.find(p=>p.id===child.id).brand,'ArtiSys');
   await assert.rejects(x.create('DUP-EAN',200,true,{barcode:'7891234567891'}),e=>e.status===409);
   await assert.rejects(x.service.createProduct('b','u',{
     name:'Outro cadastro',sku:'OUTRO',salePriceCents:100,categoryId:c.id},key()),e=>e.status===409||e.status===404);
 }finally{x.close();}
});
test('P2 immutable historical cost per purchased lot survives later receipts and keeps one inventory authority',async()=>{
 const x=await setup();try{
  const p=await x.create('HIST-1');
  const a=await x.receipt(p.id,4,450);
  const b=await x.receipt(p.id,3,800);
  assert.equal(a.unitCostCents,450);
  assert.equal(b.unitCostCents,800);
  assert.equal(await x.scalar('SELECT COUNT(*) AS n FROM purchase_cost_history WHERE product_id=?',p.id),2);
  assert.equal(await x.scalar('SELECT SUM(quantity_milli) AS n FROM purchase_cost_history WHERE product_id=?',p.id),7000);
  assert.equal(await x.scalar('SELECT balance_milli AS n FROM stock_positions WHERE product_id=?',p.id),7000);
  const costs=await x.service.purchaseCosts('a','x',{productId:p.id});
  assert.deepEqual(costs.map(row=>row.unitCostCents).sort((a,b)=>a-b),[450,800]);
  assert.equal((await x.service.products('a','x',{})).find(row=>row.id===p.id).lastCostCents,800);
  await assert.rejects(x.db.prepare('UPDATE purchase_cost_history SET unit_cost_cents=1 WHERE product_id=?').bind(p.id).run(),/PURCHASE_COST_IMMUTABLE/);
 }finally{x.close();}
});
test('P2 kit sells components once and returns the original immutable allocation without duplicated stock movements',async()=>{
 const x=await setup();try{
   const a=await x.create('KIT-A');const b=await x.create('KIT-B');
   const kit=await x.create('KIT-COMBO',2500,false);
   await x.receipt(a.id,12,300);await x.receipt(b.id,12,350);
   await x.service.setBundle('a','x',kit.id,'u',{components:[{productId:a.id,quantity:2},{productId:b.id,quantity:1}]},key());
   await x.service.openCash('a','x','u',{openingCents:0},key());
   const sale=await x.sale([{id:kit.id,quantity:2}],5000);
   assert.equal(await x.scalar("SELECT COUNT(*) AS n FROM inventory_movements WHERE sale_id=? AND type='sale'",sale.id),2);
   assert.equal(await x.scalar("SELECT balance_milli AS n FROM stock_positions WHERE product_id=?",a.id),8000);
   assert.equal(await x.scalar("SELECT balance_milli AS n FROM stock_positions WHERE product_id=?",b.id),10000);
   assert.equal(await x.scalar("SELECT COUNT(*) AS n FROM sale_stock_allocations WHERE sale_id=?",sale.id),2);
   const refunded=await x.service.returnSale('a','x',sale.id,'u',{
     reason:'Cliente devolveu um kit',items:[{saleItemId:sale.items[0].id,quantity:1}],
     refunds:[{method:'PIX',amountCents:2500}]},key());
   assert.equal(refunded.amountCents,2500);
   assert.equal(await x.scalar("SELECT balance_milli AS n FROM stock_positions WHERE product_id=?",a.id),10000);
   assert.equal(await x.scalar("SELECT balance_milli AS n FROM stock_positions WHERE product_id=?",b.id),11000);
   assert.equal(await x.scalar("SELECT COUNT(*) AS n FROM inventory_movements WHERE type='return'"),2);
 }finally{x.close();}
});
test('P2 stock reservations block checkout stock debit, allow explicit release and never overcommit on concurrent writes',async()=>{
 const x=await setup();try{
   const p=await x.create('RES-1');
   await x.receipt(p.id,3,500);
   const first=await x.service.reserveStock('a','x','u',{productId:p.id,quantity:2,reason:'Pedido futuro'},key());
   assert.equal(first.status,'ACTIVE');
   const result=await Promise.allSettled([
     x.service.reserveStock('a','x','u',{productId:p.id,quantity:2,reason:'Segundo pedido'},key()),
     x.service.reserveStock('a','x','u',{productId:p.id,quantity:2,reason:'Terceiro pedido'},key())
   ]);
   assert.equal(result.filter(x=>x.status==='fulfilled').length,0);
   assert.equal(await x.scalar("SELECT COUNT(*) AS n FROM inventory_reservations WHERE status='ACTIVE'"),1);
   await x.service.openCash('a','x','u',{openingCents:0},key());
   const opened=await x.service.openSale('a','x','u',{},key());
   await x.service.addItem('a','x',opened.id,{productId:p.id,quantity:2},key());
   await assert.rejects(x.service.complete('a','x',opened.id,'u',{payments:[{method:'PIX',amountCents:2000}]},key()),e=>e.status===409);
   assert.equal(await x.scalar("SELECT balance_milli AS n FROM stock_positions WHERE product_id=?",p.id),3000);
   await x.service.releaseReservation('a','x',first.id,'u',key());
   await x.service.complete('a','x',opened.id,'u',{payments:[{method:'PIX',amountCents:2000}]},key());
   assert.equal(await x.scalar("SELECT balance_milli AS n FROM stock_positions WHERE product_id=?",p.id),1000);
   await assert.rejects(x.service.releaseReservation('a','x',first.id,'u',key()),e=>e.status===409);
 }finally{x.close();}
});
