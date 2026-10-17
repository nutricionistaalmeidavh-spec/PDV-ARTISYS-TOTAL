'use strict';
const { createIdempotentDomainEffect } = require('../../core/idempotent-domain-effect');
const { createSaleReceiptService } = require('./sale-receipt-projection');

function registerPrintEffects({ bus, effectStore, printService, saleService, settings = null, storeName = 'ArtiSys', storeAddress = '', storePhone = '', logoDataUrl = null, documentLabel = 'CUPOM NAO FISCAL', width = 42 } = {}) {
  if (!bus || !effectStore || !printService || !saleService) throw new TypeError('bus, effectStore, printService and saleService are required.');
  const receipts=createSaleReceiptService({
    saleService,
    settings,
    env:{...process.env,PDV_RECEIPT_WIDTH:String(width)},
    receiptDefaults:{storeName,storeAddress,storePhone,logoDataUrl,documentLabel}
  });
  const saleCompleted = createIdempotentDomainEffect({
    effectKey:'receipt.sale-completed',
    effectStore,
    handler:async event => {
      const receipt=receipts.build(event.aggregateId);
      const sale=saleService.getSaleDetails(event.aggregateId);
      return printService.queueJob({
        id:`receipt-${event.eventId}`,
        type:'SALE_RECEIPT',
        entityType:'sale',
        entityId:event.aggregateId,
        width:receipt.width,
        payload:{text:receipt.text,paperMm:receipt.paperMm,terminalId:event.payload?.terminalId||sale?.terminalId||null,...(receipt.logoDataUrl?{logoDataUrl:receipt.logoDataUrl}:{})}
      });
    }
  });
  return [bus.subscribe('sale.completed',saleCompleted)];
}

module.exports={registerPrintEffects};
