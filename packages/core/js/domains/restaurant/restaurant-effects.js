'use strict';

const { createIdempotentDomainEffect } = require('../../core/idempotent-domain-effect');

function registerRestaurantEffects({bus,effectStore,restaurantService,kitchenService,nonFiscalPrintService}={}){
  if(!bus||!effectStore||!restaurantService||!kitchenService||!nonFiscalPrintService)throw new TypeError('Restaurant effects dependencies are required.');

  const orderCreated=createIdempotentDomainEffect({
    effectKey:'restaurant.route-order',
    effectStore,
    handler:async event=>{
      const tickets=kitchenService.routeOrder(event.aggregateId);
      const jobs=[];
      for(const ticket of tickets){
        if(!ticket.printEnabled)continue;
        jobs.push(nonFiscalPrintService.kitchenTicket(ticket,{printerName:ticket.printerName,id:`kitchen-${ticket.id}`}));
      }
      return{tickets:tickets.map(ticket=>ticket.id),jobs:jobs.map(job=>job.id)};
    }
  });

  const saleCompleted=createIdempotentDomainEffect({
    effectKey:'restaurant.close-table-after-sale',
    effectStore,
    handler:async event=>restaurantService.finalizeCompletedSale(event.aggregateId,{actor:event.actor||{}})
  });

  const saleCancelled=createIdempotentDomainEffect({
    effectKey:'restaurant.reopen-table-after-sale-cancel',
    effectStore,
    handler:async event=>restaurantService.reopenCancelledCheckout(event.aggregateId,{actor:event.actor||{}})
  });

  const saleVoided=createIdempotentDomainEffect({
    effectKey:'restaurant.reopen-table-after-sale-void',
    effectStore,
    handler:async event=>restaurantService.reopenCancelledCheckout(event.aggregateId,{actor:event.actor||{}})
  });

  return [
    bus.subscribe('restaurant.order-created',orderCreated),
    bus.subscribe('sale.completed',saleCompleted),
    bus.subscribe('sale.cancelled',saleCancelled),
    bus.subscribe('sale.voided',saleVoided)
  ];
}

module.exports={registerRestaurantEffects};
