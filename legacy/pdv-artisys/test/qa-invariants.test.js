'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {calculateSaleTotals,allocateSaleDiscount}=require('../js/domains/sales/pricing');
const {resolvePayment}=require('../js/domains/payments/payment-rules');
const {applyStockDelta,roundQuantity}=require('../js/domains/inventory/inventory-rules');
const {toCents}=require('../js/domains/shared/money');
const {safePdfFileName}=require('../desktop/receipt-actions.cjs');
const ui=require('../desktop/renderer/ui-model');

function rng(seed=0x5eed1234){
  let state=seed>>>0;
  return()=>{state=(1664525*state+1013904223)>>>0;return state/0x100000000;};
}

test('property invariants hold for cents, quantities, discounts, change, stock, codes and dates',()=>{
  const random=rng();
  for(let i=0;i<500;i++){
    const price=1+Math.floor(random()*250000);
    const quantity=roundQuantity((1+Math.floor(random()*10000))/1000);
    const gross=Math.round(price*quantity);
    const discount=Math.floor(random()*(gross+500));
    const totals=calculateSaleTotals({items:[{unitPriceCents:price,quantity}],discountCents:discount});
    assert.equal(Number.isSafeInteger(totals.subtotalCents),true);
    assert.equal(totals.discountCents,Math.min(discount,gross));
    assert.equal(totals.totalCents,totals.subtotalCents-totals.discountCents);
    assert.ok(totals.totalCents>=0);

    const allocatedRequest=Math.min(discount,gross);
    const split=allocateSaleDiscount([
      {unitPriceCents:price,quantity},
      {unitPriceCents:price+1,quantity:1}
    ],allocatedRequest);
    assert.equal(split.reduce((n,item)=>n+item.allocatedDiscountCents,0),allocatedRequest);
    assert.equal(split.every(item=>item.netTotalCents>=0),true);

    const cash=totals.totalCents+Math.floor(random()*10000);
    const payment=resolvePayment({totalCents:totals.totalCents,payments:[{method:'CASH',amountCents:cash}]});
    assert.equal(payment.status,'paid');
    assert.equal(payment.changeDueCents,cash-totals.totalCents);

    const before=roundQuantity(random()*1000);
    const delta=roundQuantity(random()*100);
    const stock=applyStockDelta(before,delta);
    assert.equal(stock.after,roundQuantity(before+delta));
    assert.ok(stock.after>=0);

    const decimal=(Math.floor(random()*1000000)/100).toFixed(2);
    assert.equal(toCents(decimal),Math.round(Number(decimal)*100));

    const code=String(Math.floor(random()*1e9)).padStart(12,'0');
    const products=[{id:'p',name:'Produto QA',sku:'SKU-QA',barcode:code,categoryId:'c'}];
    assert.deepEqual(ui.filterProducts(products,code),products);
    const reversed=[...code].reverse().join('');
    const wrongCode=reversed===code?`${code.slice(0,-1)}${code.endsWith('9')?'8':'9'}`:reversed;
    assert.deepEqual(ui.filterProducts(products,wrongCode),[]);

    const date=new Date(Date.UTC(2026,Math.floor(random()*12),1+Math.floor(random()*27)));
    const file=safePdfFileName('Venda '+code+' /:*?',date);
    assert.equal(/[<>:"/\\|?*\x00-\x1f]/.test(file),false);
    assert.match(file,/\.pdf$/);
  }
});
