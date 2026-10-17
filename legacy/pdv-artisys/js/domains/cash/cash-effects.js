'use strict';
const { createIdempotentDomainEffect }=require('../../core/idempotent-domain-effect');
function registerCashEffects({bus,cashService,effectStore}={}){
  const completed=createIdempotentDomainEffect({effectKey:'cash.sale-completed',effectStore,handler:async event=>cashService.recordSalePayments({cashSessionId:event.payload.cashSessionId||null,terminalId:event.payload.terminalId,saleId:event.aggregateId,payments:event.payload.payments||[],occurredAt:event.occurredAt})});
  const cancelled=createIdempotentDomainEffect({effectKey:'cash.sale-cancelled',effectStore,handler:async event=>cashService.reverseSalePayments({cashSessionId:event.payload.cashSessionId||null,terminalId:event.payload.terminalId,saleId:event.aggregateId,payments:event.payload.payments||[],occurredAt:event.occurredAt})});
  return[bus.subscribe('sale.completed',completed),bus.subscribe('sale.cancelled',cancelled)];
}
module.exports={registerCashEffects};
