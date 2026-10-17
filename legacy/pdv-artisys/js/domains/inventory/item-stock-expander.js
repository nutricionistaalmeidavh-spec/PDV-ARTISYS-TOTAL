'use strict';

const { roundQuantity } = require('./inventory-rules');

function aggregate(target, productId, quantity) {
  const id=String(productId||'').trim();
  const value=roundQuantity(Number(quantity||0));
  if(!id||value<=0)return;
  target.set(id,roundQuantity((target.get(id)||0)+value));
}

function expandStockItems(items=[],recipeService=null) {
  const totals=new Map();
  for(const item of items||[]) {
    const quantity=roundQuantity(Number(item?.quantity||0));
    if(quantity<=0)continue;
    if(Array.isArray(item?.stockItems)&&item.stockItems.length) {
      for(const component of item.stockItems) aggregate(totals,component.productId,component.quantity);
      continue;
    }
    const configuredStock=item?.configuration?.stockItems;
    if(Array.isArray(configuredStock)&&configuredStock.length) {
      for(const component of configuredStock) aggregate(totals,component.productId,quantity*Number(component.quantity||0));
      continue;
    }
    const snapshot=item?.configuration?.kit?.components;
    if(Array.isArray(snapshot)&&snapshot.length) {
      for(const component of snapshot) aggregate(totals,component.productId,quantity*Number(component.quantity||0));
      continue;
    }
    if(recipeService) {
      const expanded=recipeService.expandItems([{productId:item.productId,quantity}]);
      for(const component of expanded||[]) aggregate(totals,component.productId,component.quantity);
      continue;
    }
    aggregate(totals,item.productId,quantity);
  }
  return [...totals].sort(([a],[b])=>a.localeCompare(b)).map(([productId,quantity])=>({productId,quantity}));
}

module.exports={expandStockItems};
