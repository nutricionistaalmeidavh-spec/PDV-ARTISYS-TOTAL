import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createCommerceService} from '../src/commerce.mjs';
const stamp='2026-10-17T18:30:00.000Z';
let count=0;const key=()=> 'buy-mutation-'+(++count);
async function setup(){
 const db=openLocalDatabase();
 for(const name of ['0001_identity.sql','0002_commerce.sql','0003_cash_finance.sql',
 '0004_advanced_finance.sql','0005_vertical_parity.sql','0006_desktop_parity.sql',
 '0007_stock_transfers.sql','0008_transaction_reversals.sql','0009_catalog_inventory.sql',
 '0010_purchase_orders.sql','0011_product_media.sql']){
  db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 }
 await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
   .bind('owner','buyer@example.test','Buyer','unused',stamp).run();
 for(const [t,b] of [['a','x'],['b','y']]){
  await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)')
    .bind(t,'company-'+t,t,stamp).run();
  await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)')
    .bind(b,t,'M','Main',stamp).run();
  await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)')
    .bind(t,'owner','OWNER',stamp).run();
 }
 const service=createCommerceService(db,{now:()=>stamp});
 const product=async sku=>(await service.createProduct('a','owner',{
   sku,name:'Product '+sku,salePriceCents:1500,trackStock:true},key()));
 const supplierId='supplier-a';
 await db.prepare('INSERT INTO suppliers(id,tenant_id,name,active,created_at,updated_at) VALUES(?,?,?,?,?,?)')
  .bind(supplierId,'a','Supplier A',1,stamp,stamp).run();
 const scalar=async(sql,...args)=>(await db.prepare(sql).bind(...args).first()).n;
 return {db,service,product,supplierId,scalar,close:()=>db.close()};
}
test('purchase order receives in partial batches with exact immutable stock and cost movements',async()=>{
 const x=await setup();try{
  const p=await x.product('ORDER-P');
  const order=await x.service.createPurchaseOrder('a','x','owner',{
   supplierId:x.supplierId,items:[{productId:p.id,quantity:5,unitCostCents:420}]},key());
  assert.equal(order.status,'OPEN');
  const line=order.items[0];
  const r1=await x.service.receivePurchaseOrder('a','x',order.id,'owner',
   {items:[{lineId:line.id,quantity:2}]},key());
  assert.equal(r1.status,'PARTIAL');
  assert.equal(await x.scalar('SELECT balance_milli AS n FROM stock_positions WHERE product_id=? AND branch_id=?',p.id,'x'),2000);
  assert.equal(await x.scalar('SELECT COUNT(*) AS n FROM purchase_cost_history WHERE product_id=?',p.id),1);
  const r2=await x.service.receivePurchaseOrder('a','x',order.id,'owner',
   {items:[{lineId:line.id,quantity:3}]},key());
  assert.equal(r2.status,'RECEIVED');
  const detail=await x.service.purchaseOrder('a','x',order.id);
  assert.equal(detail.items[0].receivedQuantity,5);
  assert.equal(detail.items[0].remainingQuantity,0);
  assert.equal(await x.scalar('SELECT balance_milli AS n FROM stock_positions WHERE product_id=?',p.id),5000);
  assert.equal(await x.scalar('SELECT COUNT(*) AS n FROM inventory_movements WHERE product_id=? AND type=?',p.id,'purchase'),2);
  assert.equal(await x.scalar('SELECT SUM(quantity_milli) AS n FROM purchase_cost_history WHERE product_id=?',p.id),5000);
  assert.equal(detail.totalOrderedCents,2100);
  assert.equal(detail.totalReceivedCents,2100);
 }finally{x.close();}
});
test('purchase receipts are idempotent and concurrent terminal overreceipt is rejected atomically',async()=>{
 const x=await setup();try{
  const p=await x.product('ORDER-RACE');
  const order=await x.service.createPurchaseOrder('a','x','owner',{
   supplierId:x.supplierId,items:[{productId:p.id,quantity:2,unitCostCents:500}]},key());
  const line=order.items[0];
  const replayKey=key(),input={items:[{lineId:line.id,quantity:1}]};
  const first=await x.service.receivePurchaseOrder('a','x',order.id,'owner',input,replayKey);
  const same=await x.service.receivePurchaseOrder('a','x',order.id,'owner',input,replayKey);
  assert.deepEqual(first,same);
  const settled=await Promise.allSettled([
    x.service.receivePurchaseOrder('a','x',order.id,'owner',{items:[{lineId:line.id,quantity:1}]},key()),
    x.service.receivePurchaseOrder('a','x',order.id,'owner',{items:[{lineId:line.id,quantity:1}]},key())
  ]);
  assert.deepEqual(settled.map(x=>x.status).sort(),['fulfilled','rejected']);
  assert.equal(await x.scalar('SELECT balance_milli AS n FROM stock_positions WHERE product_id=?',p.id),2000);
  assert.equal(await x.scalar('SELECT COUNT(*) AS n FROM purchase_receipts WHERE order_id=?',order.id),2);
 }finally{x.close();}
});
test('purchase order cannot cross company/branch and cancel preserves received history',async()=>{
 const x=await setup();try{
  const p=await x.product('ORDER-ISOLATE');
  const order=await x.service.createPurchaseOrder('a','x','owner',{
   supplierId:x.supplierId,items:[{productId:p.id,quantity:4,unitCostCents:600}]},key());
  const line=order.items[0];
  await assert.rejects(x.service.purchaseOrder('b','y',order.id),e=>e.status===404);
  await assert.rejects(x.service.createPurchaseOrder('b','y','owner',
    {supplierId:x.supplierId,items:[{productId:p.id,quantity:1,unitCostCents:600}]},key()),e=>e.status===404);
  await x.service.receivePurchaseOrder('a','x',order.id,'owner',{items:[{lineId:line.id,quantity:1}]},key());
  const cancelled=await x.service.cancelPurchaseOrder('a','x',order.id,'owner',{reason:'Fornecedor não entrega saldo'},key());
  assert.equal(cancelled.status,'CANCELLED');
  assert.equal((await x.service.purchaseOrder('a','x',order.id)).items[0].receivedQuantity,1);
  await assert.rejects(x.service.receivePurchaseOrder('a','x',order.id,'owner',{items:[{lineId:line.id,quantity:1}]},key()),e=>e.status===409);
  assert.equal(await x.scalar('SELECT balance_milli AS n FROM stock_positions WHERE product_id=?',p.id),1000);
 }finally{x.close();}
});
test('weighted average acquisition cost reports actual purchase quantities without rewriting history',async()=>{
 const x=await setup();try{
  const p=await x.product('ORDER-AVG');
  const order=await x.service.createPurchaseOrder('a','x','owner',{
   supplierId:x.supplierId,items:[{productId:p.id,quantity:6,unitCostCents:1000}]},key());
  await x.service.receivePurchaseOrder('a','x',order.id,'owner',{items:[{lineId:order.items[0].id,quantity:2}]},key());
  await x.service.receipt('a','x','owner',{productId:p.id,quantity:3,type:'purchase',unitCostCents:400},key());
  const costs=await x.service.purchaseCostSummary('a','x',{productId:p.id});
  assert.equal(costs[0].totalReceivedQuantity,5);
  assert.equal(costs[0].weightedAverageUnitCostCents,640);
  assert.equal(costs[0].lastCostCents,400);
  assert.equal(await x.scalar('SELECT COUNT(*) AS n FROM purchase_cost_history WHERE product_id=?',p.id),2);
 }finally{x.close();}
});
