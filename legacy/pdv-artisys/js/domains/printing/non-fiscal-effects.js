'use strict';
const { createIdempotentDomainEffect } = require('../../core/idempotent-domain-effect');

function registerNonFiscalEffects({bus,effectStore,cashService,nonFiscalPrintService}={}){
  if(!bus||!effectStore||!cashService||!nonFiscalPrintService)throw new TypeError('Non-fiscal effect dependencies are required.');
  const cashClosed=createIdempotentDomainEffect({
    effectKey:'printing.cash-close-non-fiscal',
    effectStore,
    handler:async event=>{
      const session=cashService.getSession(event.aggregateId);
      if(!session)return null;
      return nonFiscalPrintService.cashClose(session,{id:`cash-close-${event.eventId}`});
    }
  });
  return [bus.subscribe('cash-session.closed',cashClosed)];
}

module.exports={registerNonFiscalEffects};
