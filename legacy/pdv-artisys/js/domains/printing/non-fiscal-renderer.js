'use strict';

const { money, fit, center, columns } = require('./receipt-renderer');

function widthOf(width){const value=Number(width);if(![32,42,48].includes(value))throw new Error('Largura de cupom invalida.');return value;}
function tableHeading(session){return session?.tableLabel || session?.tableId || 'Mesa';}

function fractionLabel(value){
  const fraction=Number(value);
  if(!Number.isFinite(fraction)||fraction<=0||fraction>=1)return'';
  for(let denominator=2;denominator<=8;denominator+=1){
    const numerator=Math.round(fraction*denominator);
    if(numerator>0&&Math.abs(fraction-(numerator/denominator))<0.0001)return`${numerator}/${denominator}`;
  }
  return`${Math.round(fraction*100)}%`;
}

function configurationLines(configuration){
  if(!configuration||typeof configuration!=='object')return[];
  const lines=[];
  const pizza=configuration.pizza;
  if(pizza){
    if(pizza.size?.name)lines.push(`Tamanho: ${pizza.size.name}`);
    for(const flavor of pizza.flavors||[]){const fraction=fractionLabel(flavor.fraction);lines.push(`${fraction?`${fraction} `:''}${flavor.name||'Sabor'}`);}
    if(pizza.crust?.name)lines.push(`Borda: ${pizza.crust.name}`);
    for(const addition of pizza.additions||[])if(addition?.name)lines.push(`+ ${addition.name}`);
  }
  if(configuration.variant?.name)lines.push(`Variacao: ${configuration.variant.name}`);
  for(const option of configuration.options||[])if(option?.name)lines.push(`+ ${option.name}`);
  if(configuration.systemAdjustment?.label)lines.push(configuration.systemAdjustment.label);
  return lines;
}

function appendConfiguration(lines,configuration,width){for(const detail of configurationLines(configuration))lines.push(fit(`  ${detail}`,width));}

function renderTablePreBill({storeName='ArtiSys',session,width=42}={}){
  const w=widthOf(width);if(!session?.id)throw new Error('Comanda invalida para impressao.');
  const lines=[center(storeName,w),center('PRE-CONTA - NAO FISCAL',w),'-'.repeat(w),fit(`Mesa: ${tableHeading(session)}`,w),fit(`Comanda: ${session.id}`,w),fit(`Abertura: ${session.openedAt||''}`,w),'-'.repeat(w)];
  const orders=(session.orders||[]).filter(order=>order.status!=='CANCELLED');
  for(const order of orders){for(const item of order.items||[]){lines.push(fit(item.productName||'Item',w));appendConfiguration(lines,item.configuration,w);lines.push(columns(`${Number(item.quantity||0)} x ${money(item.unitPriceCents)}`,money(item.totalCents),w));if(item.note)lines.push(fit(`  Obs: ${item.note}`,w));}}
  lines.push('-'.repeat(w));lines.push(columns('TOTAL PARCIAL',money(session.totalCents),w));lines.push('-'.repeat(w));lines.push(center('Documento sem valor fiscal',w));
  return `${lines.map(line=>fit(line,w)).join('\n')}\n`;
}

function renderKitchenTicket({storeName='ArtiSys',ticket,width=42}={}){
  const w=widthOf(width);if(!ticket?.id)throw new Error('Pedido de cozinha invalido para impressao.');
  const lines=[center(storeName,w),center(`PEDIDO - ${ticket.stationName||'COZINHA'}`,w),'-'.repeat(w),fit(`Mesa: ${ticket.tableLabel||ticket.tableId||'—'}`,w),fit(`Pedido: ${ticket.orderId||ticket.id}`,w),fit(`Hora: ${ticket.createdAt||''}`,w),'-'.repeat(w)];
  for(const item of ticket.items||[]){lines.push(fit(`${Number(item.quantity||0)}x ${item.productName||'Item'}`,w));appendConfiguration(lines,item.configuration,w);if(item.note)lines.push(fit(`  OBS: ${item.note}`,w));}
  if(ticket.orderNote){lines.push('-'.repeat(w));lines.push(fit(`OBS GERAL: ${ticket.orderNote}`,w));}
  lines.push('-'.repeat(w));lines.push(center('PEDIDO INTERNO - NAO FISCAL',w));
  return `${lines.map(line=>fit(line,w)).join('\n')}\n`;
}

function renderCashClose({storeName='ArtiSys',session,width=42}={}){
  const w=widthOf(width);if(!session?.id)throw new Error('Caixa invalido para impressao.');
  const lines=[center(storeName,w),center('FECHAMENTO DE CAIXA - NAO FISCAL',w),'-'.repeat(w),fit(`Sessao: ${session.id}`,w),fit(`Operador: ${session.operatorId||''}`,w),fit(`Abertura: ${session.openedAt||''}`,w),fit(`Fechamento: ${session.closedAt||''}`,w),'-'.repeat(w),columns('Inicial',money(session.initialCashCents),w),columns('Esperado',money(session.expectedCashCents),w),columns('Contado',money(session.countedCashCents),w),columns('Divergencia',money(session.divergenceCents),w),'-'.repeat(w),center('Documento sem valor fiscal',w)];
  return `${lines.map(line=>fit(line,w)).join('\n')}\n`;
}

module.exports={renderTablePreBill,renderKitchenTicket,renderCashClose,configurationLines};
