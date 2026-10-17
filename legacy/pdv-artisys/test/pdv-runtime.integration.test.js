const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const { createPdvRuntime }=require('../js/core/pdv-runtime');

test('runtime executes E02-E06 end to end and preserves state after restart',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-artisys-'));const dbPath=path.join(dir,'pdv.sqlite');let seq=0;const ids=p=>`${p}-${++seq}`;
  let runtime=createPdvRuntime({dbPath,now:()=> '2026-09-09T15:00:00Z',idFactory:ids});
  runtime.catalog.createUser({id:'u1',username:'caixa',name:'Caixa',profileId:'profile-cashier',password:'senha-forte-123'});
  runtime.catalog.createUser({id:'m1',username:'gerente',name:'Gerente',profileId:'profile-manager',password:'senha-forte-456'});
  runtime.catalog.upsertProduct({id:'p1',sku:'1',barcode:'789',name:'Teclado',salePriceCents:10000,minimumStock:1});
  runtime.inventory.move({productId:'p1',type:'opening',quantityDelta:5});
  runtime.cash.openSession({id:'cs1',terminalId:'pdv-01',operatorId:'u1',initialCashCents:10000,actor:{userId:'u1',profileId:'profile-cashier',terminalId:'pdv-01'}});
  await runtime.dispatchPending();
  runtime.sales.openSale({id:'s1',saleNumber:'000001',terminalId:'pdv-01',operatorId:'u1'});runtime.sales.addItem('s1',{productId:'p1',quantity:2});
  runtime.sales.completeSale('s1',{payments:[{method:'CASH',amountCents:20000}],actor:{userId:'u1',profileId:'profile-cashier',terminalId:'pdv-01'},mutationId:'mut-complete'});
  assert.equal(runtime.inventory.getBalance('p1'),5);
  let dispatch=await runtime.dispatchPending();assert.equal(dispatch.failed,0);assert.equal(runtime.inventory.getBalance('p1'),3);
  assert.equal(runtime.cash.getOpenSession('pdv-01').movements.filter(m=>m.type==='SALE').length,1);
  runtime.sales.cancelSale('s1',{reason:'Cliente desistiu',actor:{userId:'m1',profileId:'profile-manager',terminalId:'pdv-01'},mutationId:'mut-cancel'});
  dispatch=await runtime.dispatchPending();assert.equal(dispatch.failed,0);assert.equal(runtime.inventory.getBalance('p1'),5);assert.equal(runtime.cash.getOpenSession('pdv-01').movements.filter(m=>m.type==='REVERSAL').length,1);
  const closed=runtime.cash.closeSession('cs1',{countedByMethod:{CASH:10000},actor:{userId:'u1',profileId:'profile-cashier',terminalId:'pdv-01'}});assert.equal(closed.divergenceCents,0);await runtime.dispatchPending();
  runtime.close();
  runtime=createPdvRuntime({dbPath,now:()=> '2026-09-09T16:00:00Z',idFactory:ids});
  assert.equal(runtime.sales.getSale('s1').status,'CANCELLED');assert.equal(runtime.inventory.getBalance('p1'),5);assert.equal(runtime.cash.getSession('cs1').status,'CLOSED');assert.equal((await runtime.outbox.listPending(100)).length,0);
  runtime.close();fs.rmSync(dir,{recursive:true,force:true});
});

test('dispatcher leaves event pending on failure and safely retries completed effects',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-artisys-retry-'));const dbPath=path.join(dir,'pdv.sqlite');let seq=0;const ids=p=>`${p}-${++seq}`;const runtime=createPdvRuntime({dbPath,now:()=> '2026-09-09T15:00:00Z',idFactory:ids});
  runtime.catalog.createUser({id:'u1',username:'caixa',name:'Caixa',profileId:'profile-cashier',password:'senha-forte-123'});runtime.catalog.upsertProduct({id:'p1',name:'Teclado',salePriceCents:10000});runtime.inventory.move({productId:'p1',type:'opening',quantityDelta:2});runtime.cash.openSession({id:'cs1',terminalId:'pdv-01',operatorId:'u1',initialCashCents:0});await runtime.dispatchPending();
  runtime.sales.openSale({id:'s1',saleNumber:'1',terminalId:'pdv-01',operatorId:'u1'});runtime.sales.addItem('s1',{productId:'p1',quantity:1});runtime.sales.completeSale('s1',{payments:[{method:'CASH',amountCents:10000}],actor:{userId:'u1',profileId:'profile-cashier',terminalId:'pdv-01'}});
  let fail=true;const unsubscribe=runtime.bus.subscribe('sale.completed',()=>{if(fail)throw new Error('printer offline');});
  let result=await runtime.dispatchPending();assert.equal(result.failed,1);assert.equal(runtime.inventory.getBalance('p1'),1);assert.equal(runtime.cash.getOpenSession('pdv-01').movements.filter(m=>m.type==='SALE').length,1);
  fail=false;result=await runtime.dispatchPending();assert.equal(result.failed,0);assert.equal(runtime.inventory.getBalance('p1'),1);assert.equal(runtime.cash.getOpenSession('pdv-01').movements.filter(m=>m.type==='SALE').length,1);unsubscribe();runtime.close();fs.rmSync(dir,{recursive:true,force:true});
});
