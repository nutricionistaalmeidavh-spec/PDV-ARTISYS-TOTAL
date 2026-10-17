'use strict';

const {createIdempotentDomainEffect}=require('../../core/idempotent-domain-effect');

function registerRetailEffects({bus,retailService,effectStore}={}){
  if(!bus||!retailService||!effectStore)throw new TypeError('bus, retailService and effectStore are required.');
  const completed=createIdempotentDomainEffect({effectKey:'retail.sale-completed',effectStore,handler:async event=>retailService.applySaleEvent(event,'sale')});
  const cancelled=createIdempotentDomainEffect({effectKey:'retail.sale-cancelled',effectStore,handler:async event=>retailService.applySaleEvent(event,'cancel')});
  const returned=createIdempotentDomainEffect({effectKey:'retail.return-completed',effectStore,handler:async event=>retailService.applyReturnEvent(event,'return')});
  const returnCancelled=createIdempotentDomainEffect({effectKey:'retail.return-cancelled',effectStore,handler:async event=>retailService.applyReturnEvent(event,'cancel')});
  return[bus.subscribe('sale.completed',completed),bus.subscribe('sale.cancelled',cancelled),bus.subscribe('return.completed',returned),bus.subscribe('return.cancelled',returnCancelled)];
}

module.exports={registerRetailEffects};
