'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createSaleReceiptService}=require('../js/domains/printing/sale-receipt-projection');

function completedSale(overrides={}) {
  return {
    id:'sale-1',saleNumber:'V-001',status:'COMPLETED',completedAt:'2026-09-24T12:00:00.000Z',
    operatorName:'Operador',sellerName:'Vendedor',customerName:'Cliente',
    subtotalCents:1000,discountCents:0,totalCents:1000,changeCents:0,
    items:[{productName:'Produto',quantity:1,unitPriceCents:1000,totalCents:1000}],
    payments:[{method:'CASH',amountCents:1000}],...overrides
  };
}

function settings(values={}) {
  return {get:(key,{defaultValue})=>Object.hasOwn(values,key)?values[key]:defaultValue};
}

test('canonical receipt builds a completed sale with persisted paper preferences and branding',()=>{
  const sale=completedSale();
  const service=createSaleReceiptService({
    saleService:{getSaleDetails:id=>id===sale.id?sale:null},
    settings:settings({'printing.paperMm':80,'printing.columnsMode':'auto','store.name':'Loja QA','store.address':'Rua Teste 1'}),
    env:{},receiptDefaults:{storeName:'Fallback'}
  });
  const receipt=service.build('sale-1');
  assert.equal(receipt.saleId,'sale-1');
  assert.equal(receipt.saleNumber,'V-001');
  assert.equal(receipt.paperMm,80);
  assert.equal(receipt.width,48);
  assert.match(receipt.text,/Loja QA/);
  assert.match(receipt.text,/V-001/);
  assert.match(receipt.text,/Produto/);
});

test('canonical receipt rejects non-completed and missing sales',()=>{
  const service=createSaleReceiptService({saleService:{getSaleDetails:id=>id==='open'?completedSale({id:'open',status:'OPEN'}):null},settings:settings(),env:{}});
  assert.throws(()=>service.build('open'),/concluida/i);
  assert.throws(()=>service.build('missing'),/nao encontrada/i);
});

test('canonical receipt output is independent from print job timing',()=>{
  let reads=0;
  const sale=completedSale();
  const service=createSaleReceiptService({saleService:{getSaleDetails:()=>{reads+=1;return sale;}},settings:settings({'printing.paperMm':58,'printing.columnsMode':'auto'}),env:{}});
  const receipt=service.build(sale.id);
  assert.equal(reads,1);
  assert.equal(receipt.width,32);
  assert.equal(receipt.paperMm,58);
  assert.ok(receipt.text.length>0);
});
