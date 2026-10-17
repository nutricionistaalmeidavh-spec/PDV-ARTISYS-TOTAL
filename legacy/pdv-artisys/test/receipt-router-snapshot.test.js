'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createReceiptRouter}=require('../server/receipt-router');

function settings(values={}) {
  return {
    get:(key,{defaultValue})=>Object.hasOwn(values,key)?values[key]:defaultValue,
    set(){}
  };
}

function responseCapture(){
  return {
    headersSent:false,statusCode:null,headers:null,body:'',
    writeHead(statusCode,headers){this.statusCode=statusCode;this.headers=headers;this.headersSent=true;},
    end(chunk=''){this.body+=String(chunk||'');}
  };
}

function request(url,{method='GET',body=null,token='session-1'}={}){
  const bytes=body==null?Buffer.alloc(0):Buffer.from(JSON.stringify(body));
  return {method,url,headers:{authorization:`Bearer ${token}`},async *[Symbol.asyncIterator](){if(bytes.length)yield bytes;}};
}

function completedSale(){return {
  id:'sale-1',saleNumber:'V-001',status:'COMPLETED',completedAt:'2026-09-24T12:00:00.000Z',
  operatorName:'Operador',sellerName:'Vendedor',customerName:'Cliente',
  subtotalCents:1000,discountCents:0,totalCents:1000,changeCents:0,
  items:[{productName:'Produto',quantity:1,unitPriceCents:1000,totalCents:1000}],
  payments:[{method:'CASH',amountCents:1000}]
};}

test('receipt endpoint prefers the immutable original queued snapshot over current settings',async()=>{
  const original={
    id:'print-original',type:'SALE_RECEIPT',entityType:'sale',entityId:'sale-1',width:32,
    payload:{text:'RECIBO ORIGINAL 58MM',paperMm:58,logoDataUrl:null,saleNumber:'V-001'}
  };
  const runtime={
    sales:{getSaleDetails:()=>completedSale()},
    settings:settings({'printing.paperMm':80,'printing.columnsMode':'auto','store.name':'Loja Alterada'}),
    printing:{getOriginalSaleReceipt:saleId=>saleId==='sale-1'?original:null}
  };
  const sessions=new Map([['session-1',{userId:'cashier-1',profileId:'profile-cashier',expiresAt:Date.now()+60_000}]]);
  const route=createReceiptRouter({runtime,sessionStore:sessions,env:{}});
  const res=responseCapture();
  assert.equal(await route(request('/api/v1/sales/sale-1/receipt'),res),true);
  assert.equal(res.statusCode,200);
  const payload=JSON.parse(res.body);
  assert.deepEqual(payload,{saleId:'sale-1',saleNumber:'V-001',width:32,paperMm:58,text:'RECIBO ORIGINAL 58MM',logoDataUrl:null});
});

test('receipt endpoint falls back to live projection before the print side effect is drained',async()=>{
  const runtime={
    sales:{getSaleDetails:()=>completedSale()},
    settings:settings({'printing.paperMm':80,'printing.columnsMode':'auto','store.name':'Loja Atual'}),
    printing:{getOriginalSaleReceipt:()=>null}
  };
  const sessions=new Map([['session-1',{userId:'cashier-1',profileId:'profile-cashier',expiresAt:Date.now()+60_000}]]);
  const route=createReceiptRouter({runtime,sessionStore:sessions,env:{}});
  const res=responseCapture();
  await route(request('/api/v1/sales/sale-1/receipt'),res);
  assert.equal(res.statusCode,200);
  const payload=JSON.parse(res.body);
  assert.equal(payload.saleId,'sale-1');
  assert.equal(payload.paperMm,80);
  assert.equal(payload.width,48);
  assert.match(payload.text,/Loja Atual/);
});

test('cashier can create and finish an auditable manual print attempt only for its sale job',async()=>{
  const original={id:'print-original',type:'SALE_RECEIPT',entityType:'sale',entityId:'sale-1',width:32,payload:{text:'RECIBO ORIGINAL',paperMm:58,saleNumber:'V-001'}};
  const manual={id:'manual-1',type:'REPRINT',entityType:'sale',entityId:'sale-1',width:32,status:'PENDING',attempts:0,payload:{...original.payload,reprintOf:original.id,manual:true}};
  const jobs=new Map([[manual.id,manual]]);const calls=[];
  const runtime={
    sales:{getSaleDetails:()=>completedSale()},settings:settings(),
    printing:{
      getOriginalSaleReceipt:()=>original,
      createManualAttempt:saleId=>{calls.push(['create',saleId]);return manual;},
      getJob:id=>jobs.get(id)||null,
      markPrinted:id=>{calls.push(['printed',id]);return {...jobs.get(id),status:'PRINTED',attempts:1};},
      markFailed:(id,error)=>{calls.push(['failed',id,error]);return {...jobs.get(id),status:'FAILED',attempts:1,lastError:error};}
    }
  };
  const sessions=new Map([['session-1',{userId:'cashier-1',profileId:'profile-cashier',expiresAt:Date.now()+60_000}]]);
  const route=createReceiptRouter({runtime,sessionStore:sessions,env:{}});

  let res=responseCapture();
  assert.equal(await route(request('/api/v1/sales/sale-1/print-attempts',{method:'POST'}),res),true);
  assert.equal(res.statusCode,201);
  let payload=JSON.parse(res.body);
  assert.equal(payload.job.id,'manual-1');
  assert.equal(payload.receipt.text,'RECIBO ORIGINAL');
  assert.deepEqual(calls,[['create','sale-1']]);

  res=responseCapture();
  await route(request('/api/v1/sales/sale-1/print-attempts/manual-1/result',{method:'POST',body:{success:true}}),res);
  assert.equal(res.statusCode,200);
  payload=JSON.parse(res.body);
  assert.equal(payload.job.status,'PRINTED');
  assert.deepEqual(calls,[['create','sale-1'],['printed','manual-1']]);

  res=responseCapture();
  await route(request('/api/v1/sales/other-sale/print-attempts/manual-1/result',{method:'POST',body:{success:false,error:'sem papel'}}),res);
  assert.equal(res.statusCode,404);
  assert.equal(calls.some(call=>call[0]==='failed'),false);
});

test('manual print result rejects non-manual jobs and records a sanitized failure',async()=>{
  const bad={id:'job-1',type:'SALE_RECEIPT',entityType:'sale',entityId:'sale-1',status:'PENDING',payload:{text:'x',paperMm:80}};
  const manual={id:'manual-2',type:'REPRINT',entityType:'sale',entityId:'sale-1',status:'PENDING',payload:{text:'x',paperMm:80,manual:true,reprintOf:'original'}};
  let lastError='';
  const runtime={sales:{getSaleDetails:()=>completedSale()},settings:settings(),printing:{getOriginalSaleReceipt:()=>null,createManualAttempt:()=>manual,getJob:id=>id==='job-1'?bad:manual,markPrinted:()=>manual,markFailed:(id,error)=>{lastError=error;return {...manual,status:'FAILED',lastError:error};}}};
  const sessions=new Map([['session-1',{userId:'cashier-1',profileId:'profile-cashier',expiresAt:Date.now()+60_000}]]);
  const route=createReceiptRouter({runtime,sessionStore:sessions,env:{}});

  let res=responseCapture();
  await route(request('/api/v1/sales/sale-1/print-attempts/job-1/result',{method:'POST',body:{success:true}}),res);
  assert.equal(res.statusCode,404);

  res=responseCapture();
  await route(request('/api/v1/sales/sale-1/print-attempts/manual-2/result',{method:'POST',body:{success:false,error:' '.repeat(4)+'falha física '.repeat(100)}}),res);
  assert.equal(res.statusCode,200);
  assert.ok(lastError.length<=500);
  assert.match(lastError,/falha física/);
});
