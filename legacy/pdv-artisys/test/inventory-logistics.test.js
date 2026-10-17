'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPdvRuntime } = require('../js/core/pdv-runtime');

const manager={userId:'u1',profileId:'profile-manager',terminalId:'T1'};
function setup(){
  let seq=0;
  const runtime=createPdvRuntime({now:()=> '2026-09-20T10:00:00.000Z',idFactory:p=>`${p}-${++seq}`});
  runtime.catalog.upsertCategory({id:'c1',name:'Geral'},manager);
  runtime.catalog.createUser({id:'u1',username:'gerente',name:'Gerente',profileId:'profile-manager',password:'senha-forte'},manager);
  runtime.catalog.upsertProduct({id:'p1',name:'Produto',categoryId:'c1',unit:'UN',salePriceCents:1000,costCents:600,trackStock:true,minimumStock:0},manager);
  return runtime;
}

test('legacy movements default to MAIN and location balance remains compatible',()=>{
  const runtime=setup();
  runtime.inventory.move({productId:'p1',type:'purchase',quantityDelta:10},manager);
  assert.equal(runtime.inventory.getBalance('p1'),10);
  assert.equal(runtime.inventory.getBalance('p1',{locationId:'MAIN'}),10);
  const movement=runtime.inventory.listMovements({productId:'p1'})[0];
  assert.equal(movement.locationId,'MAIN');
  runtime.close();
});

test('reservation reduces available stock without reducing physical stock',()=>{
  const runtime=setup();
  runtime.inventory.move({productId:'p1',locationId:'MAIN',type:'purchase',quantityDelta:10},manager);
  runtime.logistics.createReservation({productId:'p1',locationId:'MAIN',quantity:4,sourceType:'sales-order',sourceId:'o1'},manager);
  assert.deepEqual(runtime.logistics.getAvailability('p1','MAIN'),{physicalQuantity:10,reservedQuantity:4,availableQuantity:6});
  assert.equal(runtime.inventory.getBalance('p1',{locationId:'MAIN'}),10);
  runtime.close();
});

test('normal sale cannot consume stock reserved by another order',()=>{
  const runtime=setup();
  runtime.inventory.move({productId:'p1',type:'purchase',quantityDelta:10},manager);
  runtime.logistics.createReservation({productId:'p1',locationId:'MAIN',quantity:4,sourceType:'sales-order',sourceId:'o1'},manager);
  const sale=runtime.sales.openSale({terminalId:'T1',operatorId:'u1',sellerId:'u1'},manager);
  runtime.sales.addItem(sale.id,{productId:'p1',quantity:7});
  assert.throws(()=>runtime.sales.completeSale(sale.id,{payments:[{method:'CASH',amountCents:7000}],actor:manager}),/Estoque disponivel insuficiente/);
  runtime.close();
});
