'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const { createPdvRuntime }=require('../js/core/pdv-runtime');

const actor={userId:'u1',profileId:'profile-manager',terminalId:'T1'};
function setup(){
  let seq=0;
  const runtime=createPdvRuntime({now:()=> '2026-09-20T12:00:00.000Z',idFactory:p=>`${p}-${++seq}`});
  runtime.catalog.createUser({id:'u1',username:'gerente',name:'Gerente',profileId:'profile-manager',password:'senha-forte-123'},actor);
  runtime.catalog.upsertSupplier({id:'s1',name:'Fornecedor 1'},actor);
  runtime.catalog.upsertProduct({id:'p1',name:'Produto 1',salePriceCents:1500,costCents:600,trackStock:true},actor);
  runtime.inventory.move({productId:'p1',type:'opening',quantityDelta:10},actor);
  return runtime;
}

test('purchase receipt moves stock, updates moving average cost and creates payable',()=>{
  const runtime=setup();
  assert.ok(runtime.procurement,'runtime must expose procurement service');
  const order=runtime.procurement.createPurchaseOrder({supplierId:'s1',locationId:'MAIN',items:[{productId:'p1',quantity:10,unitCostCents:800}]},actor);
  runtime.procurement.submitPurchaseOrder(order.id,actor);
  const receipt=runtime.procurement.receivePurchaseOrder(order.id,{idempotencyKey:'receive-1',items:[{productId:'p1',quantity:10}]},actor);
  assert.equal(runtime.inventory.getBalance('p1',{locationId:'MAIN'}),20);
  assert.equal(runtime.catalog.getProduct('p1').costCents,700);
  assert.equal(runtime.finance.getEntry(receipt.payableEntryId).amountCents,8000);
  assert.equal(runtime.procurement.getPurchaseOrder(order.id).status,'RECEIVED');
  runtime.close();
});

test('purchase order supports partial receipts and idempotent retry',()=>{
  const runtime=setup();
  const order=runtime.procurement.createPurchaseOrder({supplierId:'s1',locationId:'MAIN',items:[{productId:'p1',quantity:10,unitCostCents:800}]},actor);
  runtime.procurement.submitPurchaseOrder(order.id,actor);
  const first=runtime.procurement.receivePurchaseOrder(order.id,{idempotencyKey:'receive-part-1',items:[{productId:'p1',quantity:4}]},actor);
  assert.equal(runtime.procurement.getPurchaseOrder(order.id).status,'PARTIALLY_RECEIVED');
  assert.equal(runtime.inventory.getBalance('p1',{locationId:'MAIN'}),14);
  const retry=runtime.procurement.receivePurchaseOrder(order.id,{idempotencyKey:'receive-part-1',items:[{productId:'p1',quantity:4}]},actor);
  assert.equal(retry.id,first.id);
  assert.equal(runtime.inventory.getBalance('p1',{locationId:'MAIN'}),14);
  runtime.procurement.receivePurchaseOrder(order.id,{idempotencyKey:'receive-part-2',items:[{productId:'p1',quantity:6}]},actor);
  assert.equal(runtime.procurement.getPurchaseOrder(order.id).status,'RECEIVED');
  assert.equal(runtime.inventory.getBalance('p1',{locationId:'MAIN'}),20);
  runtime.close();
});

test('over receipt fails atomically without stock or payable side effects',()=>{
  const runtime=setup();
  const order=runtime.procurement.createPurchaseOrder({supplierId:'s1',locationId:'MAIN',items:[{productId:'p1',quantity:5,unitCostCents:800}]},actor);
  runtime.procurement.submitPurchaseOrder(order.id,actor);
  assert.throws(()=>runtime.procurement.receivePurchaseOrder(order.id,{idempotencyKey:'receive-over',items:[{productId:'p1',quantity:6}]},actor),/excede.*pendente/i);
  assert.equal(runtime.inventory.getBalance('p1',{locationId:'MAIN'}),10);
  assert.equal(runtime.finance.listEntries({kind:'PAYABLE'}).length,0);
  runtime.close();
});
