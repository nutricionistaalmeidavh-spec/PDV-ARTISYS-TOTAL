'use strict';
const { createIdempotentDomainEffect } = require('../../core/idempotent-domain-effect');
const { expandStockItems }=require('./item-stock-expander');
function registerInventoryEffects({bus,inventoryService,effectStore,recipeService=null,logisticsService=null}={}){
  if(!bus||!inventoryService||!effectStore) throw new TypeError('bus, inventoryService and effectStore are required.');
  const expand=items=>expandStockItems(items||[],recipeService);
  const completed=createIdempotentDomainEffect({
    effectKey:'inventory.sale-completed',effectStore,
    handler:async event=>{
      const result=inventoryService.applySaleItems({eventId:event.eventId,saleId:event.aggregateId,items:expand(event.payload.items),direction:'sale',createdAt:event.occurredAt});
      logisticsService?.consumeSaleReservations(event.aggregateId);
      return result;
    }
  });
  const cancelled=createIdempotentDomainEffect({
    effectKey:'inventory.sale-cancelled',effectStore,
    handler:async event=>inventoryService.applySaleItems({eventId:event.eventId,saleId:event.aggregateId,items:expand(event.payload.items),direction:'cancel',createdAt:event.occurredAt})
  });
  return [bus.subscribe('sale.completed',completed),bus.subscribe('sale.cancelled',cancelled)];
}
module.exports={registerInventoryEffects};