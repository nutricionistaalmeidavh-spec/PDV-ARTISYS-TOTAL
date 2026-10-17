'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {DomainEventBus}=require('../js/core/domain-event-bus');
const {SqliteEffectStore}=require('../js/core/database/effect-store');
const {createPrintService}=require('../js/domains/printing/print-service');
const {renderSaleReceipt}=require('../js/domains/printing/receipt-renderer');
const {registerPrintEffects}=require('../js/domains/printing/print-effects');

function sale(){return {id:'s1',saleNumber:'V-001',terminalId:'T1',operatorId:'u1',customerId:null,status:'COMPLETED',subtotalCents:2500,discountCents:0,totalCents:2500,changeCents:500,completedAt:'2026-09-09T12:00:00Z',items:[{productName:'Café especial',sku:'CAF1',quantity:2,unitPriceCents:1250,totalCents:2500}],payments:[{method:'CASH',amountCents:3000}]};}

test('receipt renderer supports 32 42 and 48 logical columns using cents',()=>{
  for(const width of [32,42,48]){
    const text=renderSaleReceipt({storeName:'Loja ArtiSys',documentLabel:'CUPOM NAO FISCAL',sale:sale(),width});
    assert.match(text,/Loja ArtiSys/);assert.match(text,/V-001/);assert.match(text,/25,00/);assert.match(text,/Troco.*5,00/);
    assert.equal(Math.max(...text.split('\n').map(line=>line.length))<=width,true,`width ${width}`);
  }
  assert.throws(()=>renderSaleReceipt({storeName:'X',sale:sale(),width:99}),/largura/i);
});

test('print service persists failure retry success and explicit reprint',async()=>{
  const db=openDatabase(':memory:');runMigrations(db);let n=0;
  const service=createPrintService({db,now:()=>`2026-09-09T12:00:0${n}Z`,idFactory:p=>`${p}-${++n}`});
  const job=service.queueJob({type:'SALE_RECEIPT',entityType:'sale',entityId:'s1',payload:{text:'cupom',terminalId:'T1',paperMm:80},width:42});
  assert.equal(job.status,'PENDING');
  const failed=service.markFailed(job.id,'sem papel');assert.equal(failed.status,'FAILED');assert.equal(failed.attempts,1);
  const retried=service.retryJob(job.id);assert.equal(retried.status,'PENDING');assert.equal(retried.lastError,null);
  const printed=service.markPrinted(job.id);assert.equal(printed.status,'PRINTED');assert.equal(printed.attempts,2);
  const reprint=service.reprint(job.id);assert.equal(reprint.status,'PENDING');assert.equal(reprint.type,'REPRINT');assert.notEqual(reprint.id,job.id);
  assert.equal(service.listJobs({entityId:'s1'}).length,2);
  const original=service.getOriginalSaleReceipt('s1');
  assert.equal(original.id,job.id);
  assert.equal(original.type,'SALE_RECEIPT');
  assert.equal(original.payload.text,'cupom');
  assert.equal(original.payload.paperMm,80);
  db.close();
});

test('manual sale print creates a distinct auditable reprint from the immutable original snapshot',()=>{
  const db=openDatabase(':memory:');runMigrations(db);let n=0;
  const service=createPrintService({db,now:()=>`2026-09-09T12:00:0${n}Z`,idFactory:p=>`${p}-${++n}`});
  const original=service.queueJob({type:'SALE_RECEIPT',entityType:'sale',entityId:'manual-sale',payload:{text:'snapshot original',paperMm:58,saleNumber:'V-MANUAL'},width:32});
  const attempt=service.createManualAttempt('manual-sale');
  assert.equal(attempt.type,'REPRINT');
  assert.equal(attempt.status,'PENDING');
  assert.equal(attempt.entityType,'sale');
  assert.equal(attempt.entityId,'manual-sale');
  assert.equal(attempt.width,32);
  assert.equal(attempt.payload.text,'snapshot original');
  assert.equal(attempt.payload.paperMm,58);
  assert.equal(attempt.payload.reprintOf,original.id);
  assert.equal(attempt.payload.manual,true);
  const second=service.createManualAttempt('manual-sale');
  assert.notEqual(second.id,attempt.id);
  assert.equal(service.listJobs({entityId:'manual-sale'}).length,3);
  assert.throws(()=>service.createManualAttempt('missing-sale'),/comprovante original/i);
  db.close();
});

test('process job forwards the canonical paper width to the printer',async()=>{
  const db=openDatabase(':memory:');runMigrations(db);let n=0;let received=null;
  const service=createPrintService({db,idFactory:p=>`${p}-${++n}`});
  const job=service.queueJob({type:'SALE_RECEIPT',entityType:'sale',entityId:'s-paper',payload:{text:'cupom 58',paperMm:58},width:32});
  await service.processJob(job.id,{print:async input=>{received=input;return {success:true};}});
  assert.equal(received.paperMm,58);
  assert.equal(received.width,32);
  assert.equal(received.text,'cupom 58');
  db.close();
});

test('sale completed print effect queues exactly one durable canonical snapshot on retry',async()=>{
  const db=openDatabase(':memory:');runMigrations(db);let n=0;
  const print=createPrintService({db,now:()=> '2026-09-09T12:00:00Z',idFactory:p=>`${p}-${++n}`});
  const bus=new DomainEventBus();const effectStore=new SqliteEffectStore(db);
  const settings={get:(key,{defaultValue})=>key==='printing.paperMm'?80:key==='printing.columnsMode'?'auto':defaultValue};
  registerPrintEffects({bus,effectStore,printService:print,saleService:{getSaleDetails:id=>id==='s1'?sale():null},settings,storeName:'Loja ArtiSys'});
  const event={eventId:'evt-sale-1',type:'sale.completed',aggregate:'sale',aggregateId:'s1',occurredAt:'2026-09-09T12:00:00Z',actor:{userId:'u1',profileId:'profile-cashier',terminalId:'T1'},source:'server',mutationId:null,payload:{terminalId:'T1'}};
  let result=await bus.publishAsync(event);assert.equal(result.failures.length,0);
  result=await bus.publishAsync(event);assert.equal(result.failures.length,0);
  const jobs=print.listJobs({entityId:'s1'});assert.equal(jobs.length,1);assert.equal(jobs[0].id,'receipt-evt-sale-1');assert.match(jobs[0].payload.text,/CUPOM NAO FISCAL/);
  assert.equal(jobs[0].payload.paperMm,80);assert.equal(jobs[0].width,48);
  assert.equal(print.getOriginalSaleReceipt('s1').id,jobs[0].id);
  db.close();
});
