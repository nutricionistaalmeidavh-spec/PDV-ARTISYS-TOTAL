'use strict';

const {
  createReceiptDocument,
  renderPlainText,
  money,
  fit,
  center,
  columns
} = require('@artisys/printing');
const { normalizeReceiptBranding } = require('./receipt-branding');
const { formatReceiptObservation } = require('../sales/sale-observation');

function fractionLabel(value) {
  const fraction=Number(value);
  if(!Number.isFinite(fraction)||fraction<=0||fraction>=1)return'';
  for(let denominator=2;denominator<=8;denominator+=1){
    const numerator=Math.round(fraction*denominator);
    if(numerator>0&&Math.abs(fraction-(numerator/denominator))<0.0001)return`${numerator}/${denominator}`;
  }
  return`${Math.round(fraction*100)}%`;
}

function configurationDetails(configuration) {
  if(!configuration||typeof configuration!=='object')return[];
  const details=[];
  const pizza=configuration.pizza;
  if(pizza){
    if(pizza.size?.name)details.push(`Tamanho: ${pizza.size.name}`);
    for(const flavor of pizza.flavors||[]){const fraction=fractionLabel(flavor.fraction);details.push(`${fraction?`${fraction} `:''}${flavor.name||'Sabor'}`);}
    if(pizza.crust?.name)details.push(`Borda: ${pizza.crust.name}`);
    for(const addition of pizza.additions||[])if(addition?.name)details.push(`+ ${addition.name}`);
  }
  if(configuration.variant?.name)details.push(`Variacao: ${configuration.variant.name}`);
  for(const option of configuration.options||[])if(option?.name)details.push(`+ ${option.name}`);
  for(const combo of configuration.combos||[])if(combo?.name)details.push(`Combo: ${combo.name}`);
  if(configuration.systemAdjustment?.label)details.push(configuration.systemAdjustment.label);
  return details;
}

function paymentReceiptLabel(method) {
  const normalized=String(method || '').trim().toUpperCase();
  return ({
    CASH:'Dinheiro recebido',
    PIX:'PIX',
    DEBIT_CARD:'Cartao debito',
    CREDIT_CARD:'Cartao credito',
    STORE_CREDIT:'A prazo',
    OTHER:'Outro'
  })[normalized] || String(method || 'Pagamento');
}

function renderSaleReceipt({ storeName = 'ArtiSys', storeAddress = '', storePhone = '', branding = null, documentLabel = 'CUPOM NAO FISCAL', sale, width = 42 } = {}) {
  const w = Number(width);
  if (![32,42,48].includes(w)) throw new Error('Largura de cupom invalida.');
  if (!sale || !sale.saleNumber) throw new Error('Venda invalida para impressao.');
  const receiptBranding=normalizeReceiptBranding(branding||{name:storeName,address:storeAddress,phone:storePhone},{name:storeName,address:storeAddress,phone:storePhone});

  const metadata = [];
  if(receiptBranding.address)metadata.push(['',receiptBranding.address]);
  if(receiptBranding.phone)metadata.push(['',`Telefone: ${receiptBranding.phone}`]);
  const operatorName=String(sale.operatorName || ((sale.sellerId && sale.operatorId && sale.sellerId===sale.operatorId) ? sale.sellerName : '') || '').trim();
  const sellerName=String(sale.sellerName || '').trim();
  const customerName=String(sale.customerName || '').trim();
  metadata.push(
    ['Venda', sale.saleNumber],
    ['Data', sale.completedAt || sale.updatedAt || '']
  );
  if(operatorName)metadata.push(['Operador',operatorName]);
  if(sellerName) metadata.push(['Vendedor', sellerName]);
  if(customerName) metadata.push(['Cliente', customerName]);

  const totals = [['Subtotal', Number(sale.subtotalCents || 0)]];
  const hasBreakdown=sale.manualDiscountCents!=null||sale.promotionDiscountCents!=null;
  if(hasBreakdown){
    if(Number(sale.promotionDiscountCents||0)>0)totals.push(['Combo/Promocao',-Number(sale.promotionDiscountCents)]);
    if(Number(sale.manualDiscountCents||0)>0)totals.push(['Desconto manual',-Number(sale.manualDiscountCents)]);
  }else if(Number(sale.discountCents||0)>0)totals.push(['Desconto',-Number(sale.discountCents)]);
  totals.push(['TOTAL', Number(sale.totalCents || 0)]);
  const promotionNames=[...new Set((sale.promotions||[]).map(item=>String(item?.name||'').trim()).filter(Boolean))];
  const printedObservation=sale.printObservation?formatReceiptObservation(sale.observation,w):'';
  const observationBlocks=printedObservation
    ? [{type:'text',value:'OBSERVACOES DA VENDA'},...printedObservation.split('\n').map(value=>({type:'text',value}))]
    : [];

  const document = createReceiptDocument({
    width:w,
    title:receiptBranding.name,
    documentLabel,
    metadata,
    items:(sale.items || []).map(item => ({
      name:item.productName || item.sku || 'Item',
      quantity:Number(item.quantity || 0),
      unitPriceCents:Number(item.unitPriceCents || 0),
      totalCents:Number(item.totalCents || 0),
      details:configurationDetails(item.configuration)
    })),
    totals,
    payments:(sale.payments || []).map(payment => [paymentReceiptLabel(payment.method), Number(payment.amountCents || 0)]),
    changeCents:Number(sale.changeCents || 0),
    blocks:observationBlocks,
    footer:[...promotionNames.map(name=>`Promocao: ${name}`),'Obrigado pela preferencia']
  });
  return renderPlainText(document);
}

module.exports = { renderSaleReceipt, configurationDetails, paymentReceiptLabel, money, fit, center, columns };
