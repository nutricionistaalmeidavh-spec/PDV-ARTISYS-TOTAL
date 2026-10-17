'use strict';
const { createIdempotentDomainEffect } = require('../../core/idempotent-domain-effect');
const { expandStockItems } = require('../inventory/item-stock-expander');

function registerReturnEffects({ bus, inventoryService, cashService, effectStore, recipeService=null } = {}) {
  if (!bus || !inventoryService || !cashService || !effectStore) throw new TypeError('bus, inventoryService, cashService and effectStore are required.');
  const expand=items=>expandStockItems(items||[],recipeService);
  const inventoryCompleted = createIdempotentDomainEffect({
    effectKey:'inventory.return-completed', effectStore,
    handler:async event => inventoryService.applyReturnItems({ eventId:event.eventId, returnId:event.aggregateId, items:expand(event.payload.items), direction:'return', createdAt:event.occurredAt })
  });
  const cashCompleted = createIdempotentDomainEffect({
    effectKey:'cash.return-completed', effectStore,
    handler:async event => cashService.recordReturnRefunds({ cashSessionId:event.payload.cashSessionId||null, terminalId:event.payload.terminalId, returnId:event.aggregateId, refunds:event.payload.refunds || [], direction:'return', occurredAt:event.occurredAt })
  });
  const inventoryCancelled = createIdempotentDomainEffect({
    effectKey:'inventory.return-cancelled', effectStore,
    handler:async event => inventoryService.applyReturnItems({ eventId:event.eventId, returnId:event.aggregateId, items:expand(event.payload.items), direction:'cancel', createdAt:event.occurredAt })
  });
  const cashCancelled = createIdempotentDomainEffect({
    effectKey:'cash.return-cancelled', effectStore,
    handler:async event => cashService.recordReturnRefunds({ cashSessionId:event.payload.cashSessionId||null, terminalId:event.payload.terminalId, returnId:event.aggregateId, refunds:event.payload.refunds || [], direction:'cancel', occurredAt:event.occurredAt })
  });
  return [
    bus.subscribe('return.completed', inventoryCompleted),
    bus.subscribe('return.completed', cashCompleted),
    bus.subscribe('return.cancelled', inventoryCancelled),
    bus.subscribe('return.cancelled', cashCancelled)
  ];
}

module.exports = { registerReturnEffects };
