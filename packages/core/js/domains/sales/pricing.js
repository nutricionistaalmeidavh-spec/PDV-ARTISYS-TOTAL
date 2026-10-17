'use strict';
const { assertCents } = require('../shared/money');
const { roundQuantity } = require('../inventory/inventory-rules');

function calculateSaleTotals({items=[],discountCents=0}={}){
  assertCents(discountCents,'discountCents');
  if(discountCents<0) throw new Error('Desconto nao pode ser negativo.');
  let subtotalCents=0;
  for(const item of items){
    assertCents(item.unitPriceCents,'unitPriceCents');
    const quantity=roundQuantity(item.quantity);
    if(quantity<=0) throw new Error('Quantidade deve ser maior que zero.');
    subtotalCents+=Math.round(item.unitPriceCents*quantity);
  }
  if(!Number.isSafeInteger(subtotalCents)) throw new RangeError('Subtotal excede limite seguro.');
  const appliedDiscount=Math.min(discountCents,subtotalCents);
  return {subtotalCents,discountCents:appliedDiscount,totalCents:subtotalCents-appliedDiscount};
}

function allocateSaleDiscount(items=[],discountCents=0){
  assertCents(discountCents,'discountCents');
  if(discountCents<0)throw new Error('Desconto nao pode ser negativo.');
  const normalized=items.map(item=>{
    const quantity=roundQuantity(item.quantity);
    if(quantity<=0)throw new Error('Quantidade deve ser maior que zero.');
    const grossCents=item.totalCents===undefined?Math.round(Number(item.unitPriceCents||0)*quantity):Number(item.totalCents);
    assertCents(grossCents,'item.totalCents');
    return{...item,grossCents};
  });
  const total=normalized.reduce((sum,item)=>sum+item.grossCents,0);
  let remainingDiscount=Math.min(discountCents,total);
  let remainingBase=total;
  return normalized.map((item,index)=>{
    let allocatedDiscountCents=0;
    if(remainingDiscount>0&&remainingBase>0){
      allocatedDiscountCents=index===normalized.length-1?remainingDiscount:Math.round((remainingDiscount*item.grossCents)/remainingBase);
      allocatedDiscountCents=Math.min(Math.max(allocatedDiscountCents,0),item.grossCents,remainingDiscount);
    }
    remainingDiscount-=allocatedDiscountCents;
    remainingBase-=item.grossCents;
    return{...item,allocatedDiscountCents,netTotalCents:item.grossCents-allocatedDiscountCents};
  });
}

module.exports={calculateSaleTotals,allocateSaleDiscount};
