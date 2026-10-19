// Browser/SaaS adapters around the ONE canonical desktop-compatible renderer.
// Do not maintain another copy of the receipt width/formatting algorithms here.
import nonFiscal from '../../../packages/core/js/domains/printing/non-fiscal-renderer.js';
const {renderKitchenTicket,renderTablePreBill,renderCashClose}=nonFiscal;
const widthOf=w=>{const n=Number(w??42);if(![32,42,48].includes(n))throw Error('Largura inválida.');return n;};
const safeText=(v,max=160)=>String(v??'').replace(/[\x00-\x1F\x7F]/g,' ').trim().slice(0,max);
function itemsOf(lines){
 if(!Array.isArray(lines)||lines.length>250)throw Error('Quantidade de itens inválida.');
 return lines.map(line=>{
  if(!line||typeof line!=='object'||String(line.productName??line.name??'').length>180
    ||!Number.isFinite(Number(line.quantity))||Number(line.quantity)<=0||Number(line.quantity)>100000)
   throw Error('Item de impressão inválido.');
  if(JSON.stringify(line.configuration||{}).length>5000)throw Error('Detalhe excede limite.');
  return {productName:safeText(line.productName??line.name,180),quantity:Number(line.quantity),
    configuration:line.configuration||null,note:safeText(line.note,240),
    unitPriceCents:Number(line.unitPriceCents||0),totalCents:Number(line.totalCents||0)};
 });
}
export function renderKitchenPrintJob(job,{storeName='PDV TOTAL',width=42}={}){
 const payload=job?.payload;
 if(!job?.id||!payload||payload.jobFormat!=='R4_KITCHEN_V1'||!payload.stationTicketId||!payload.orderId)
  throw Error('Ticket de impressão em formato inválido.');
 if(JSON.stringify(payload).length>16000)throw Error('Conteúdo excede o limite.');
 const ticket={id:payload.stationTicketId,orderId:payload.orderId,
  stationName:safeText(job.stationName||job.printerName||'COZINHA'),
  createdAt:payload.orderedAt,items:itemsOf(payload.items||[]),
  tableLabel:safeText(payload.tableLabel||''),orderNote:safeText(payload.orderNote||'')};
 return renderKitchenTicket({storeName:safeText(storeName,80),ticket,width:widthOf(width)});
}
export function renderCashCloseDocument(session,{storeName='PDV TOTAL',width=42}={}){
 if(!session?.id||session.status!=='CLOSED')throw Error('Impressão de caixa exige fechamento já fechado.');
 for(const key of ['initialCashCents','expectedCashCents','countedCashCents','divergenceCents']){
  if(!Number.isSafeInteger(Number(session[key]))||session[key]===null)throw Error('Valor do caixa inválido.');
 }
 return renderCashClose({storeName:safeText(storeName,80),session,width:widthOf(width)});
}
export function renderTablePrebillDocument(session,{storeName='PDV TOTAL',width=42}={}){
 if(!session?.id||!['OPEN','SUSPENDED'].includes(session.status))throw Error('Pré-conta exige comanda aberta.');
 const orders=(session.orders||[]).map(order=>({...order,items:itemsOf(order.items||[])}));
 return renderTablePreBill({storeName:safeText(storeName,80),session:{...session,orders},width:widthOf(width)});
}
