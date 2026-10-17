'use strict';

const {renderSaleReceipt}=require('./receipt-renderer');
const {resolveReceiptBranding}=require('./receipt-branding');
const {resolvePrintingPreferences}=require('./printing-preferences');

function createSaleReceiptService({saleService,settings=null,env=process.env,receiptDefaults={}}={}) {
  if (!saleService || typeof saleService.getSaleDetails!=='function') throw new TypeError('saleService com getSaleDetails e obrigatorio.');
  const defaults={
    name:receiptDefaults.storeName || receiptDefaults.name || 'ArtiSys',
    address:receiptDefaults.storeAddress || receiptDefaults.address || '',
    phone:receiptDefaults.storePhone || receiptDefaults.phone || '',
    logoDataUrl:receiptDefaults.logoDataUrl || null
  };
  const documentLabel=receiptDefaults.documentLabel || 'CUPOM NAO FISCAL';

  function build(saleId) {
    const id=String(saleId || '').trim();
    if (!id) throw new Error('Venda obrigatoria para comprovante.');
    const sale=saleService.getSaleDetails(id);
    if (!sale) throw new Error('Venda nao encontrada para comprovante.');
    if (String(sale.status || '').toUpperCase()!=='COMPLETED') throw new Error('Somente venda concluida pode gerar comprovante.');
    const preferences=resolvePrintingPreferences({settings,env,isExistingInstall:true});
    const branding=resolveReceiptBranding({settings,defaults});
    const text=renderSaleReceipt({branding,documentLabel,sale,width:preferences.columns});
    return Object.freeze({
      saleId:id,
      saleNumber:String(sale.saleNumber || id),
      width:preferences.columns,
      paperMm:preferences.paperMm,
      text,
      logoDataUrl:branding.logoDataUrl || null
    });
  }

  return Object.freeze({build});
}

module.exports={createSaleReceiptService};
