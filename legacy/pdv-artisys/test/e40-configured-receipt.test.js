'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {renderSaleReceipt}=require('../js/domains/printing/receipt-renderer');

test('E40 configured sale receipt prints immutable option and pizza configuration as non-fiscal',()=>{
  const text=renderSaleReceipt({storeName:'ArtiSys',documentLabel:'CUPOM NAO FISCAL',sale:{
    id:'s1',saleNumber:'1',operatorId:'u1',subtotalCents:4500,totalCents:4500,discountCents:0,changeCents:0,
    items:[{productName:'Pizza',quantity:1,unitPriceCents:4500,totalCents:4500,configuration:{
      pizza:{size:{name:'Grande'},flavors:[{name:'Calabresa',fraction:.5},{name:'Marguerita',fraction:.5}],crust:{name:'Catupiry'},additions:[{name:'Bacon'}]},
      options:[{name:'Molho extra'}]
    }}],payments:[{method:'PIX',amountCents:4500}]
  },width:42});
  assert.match(text,/CUPOM NAO FISCAL/);
  assert.match(text,/Tamanho: Grande/);
  assert.match(text,/1\/2 Calabresa/);
  assert.match(text,/1\/2 Marguerita/);
  assert.match(text,/Borda: Catupiry/);
  assert.match(text,/Bacon/);
  assert.match(text,/Molho extra/);
});
