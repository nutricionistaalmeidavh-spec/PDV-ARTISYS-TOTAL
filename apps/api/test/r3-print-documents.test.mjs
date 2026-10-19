import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {renderKitchenPrintJob,renderCashCloseDocument,renderTablePrebillDocument} from '../src/r3-print-documents.mjs';
const require=createRequire(import.meta.url);
const canonical=require('../../../packages/core/js/domains/printing/non-fiscal-renderer.js');

test('cap-026 R3 canonical renderer parity uses original shared kitchen layout, widths, configured details and UTF-8',()=>{
 const job={id:'print-kds-01',printerName:'Cozinha 1',payload:{jobFormat:'R4_KITCHEN_V1',stationTicketId:'ticket-1',orderId:'order-1',ticketNumber:'A1',orderedAt:'2026-10-18T10:00:00Z',
 items:[{name:'Pizza Margherita',quantity:2,configuration:{pizza:{size:{name:'Grande'},flavors:[{name:'Queijo',fraction:0.5}],crust:{name:'Catupiry'}}},note:'Sem cebola'}]}};
 const text=renderKitchenPrintJob(job,{storeName:'Café R3',width:32});
 const expected=canonical.renderKitchenTicket({storeName:'Café R3',width:32,ticket:{
  id:'ticket-1',stationName:'Cozinha 1',orderId:'order-1',createdAt:'2026-10-18T10:00:00Z',
  items:[{quantity:2,productName:'Pizza Margherita',configuration:job.payload.items[0].configuration,note:'Sem cebola'}]
 }});
 assert.equal(text,expected);
 assert.match(text,/PEDIDO - COZINHA/);
 assert.match(text,/Catupiry/);
 assert.ok(text.split('\n').every(l=>l.length<=32));
 assert.throws(()=>renderKitchenPrintJob({...job,payload:{jobFormat:'UNKNOWN'}}),/formato|inválido/i);
});

test('cap-029 R3 kitchen, table prebill and cash close have independent non-fiscal labels and no fake payments',()=>{
 const cash={id:'cash-close-1',status:'CLOSED',operatorId:'owner',openedAt:'2026-10-18T09:00:00Z',closedAt:'2026-10-18T17:00:00Z',initialCashCents:1000,expectedCashCents:2220,countedCashCents:2200,divergenceCents:-20};
 const close=renderCashCloseDocument(cash,{storeName:'Loja R3',width:42});
 assert.equal(close,canonical.renderCashClose({storeName:'Loja R3',session:cash,width:42}));
 assert.match(close,/FECHAMENTO DE CAIXA/);
 assert.match(close,/Divergencia/);
 assert.throws(()=>renderCashCloseDocument({...cash,status:'OPEN'}),/fechado/i);
 const session={id:'tab-01',tableLabel:'Mesa 1',status:'OPEN',openedAt:'2026-10-18T09:00:00Z',totalCents:1200,
 orders:[{status:'CONFIRMED',items:[{productName:'Café',quantity:2,unitPriceCents:600,totalCents:1200,configuration:{options:[{name:'Leite'}]}}]},{status:'CANCELLED',items:[{productName:'Não cobrar',quantity:1,unitPriceCents:99,totalCents:99}]}]};
 const prebill=renderTablePrebillDocument(session,{storeName:'Loja R3',width:42});
 assert.equal(prebill,canonical.renderTablePreBill({storeName:'Loja R3',session,width:42}));
 assert.match(prebill,/PRE-CONTA - NAO FISCAL/);
 assert.match(prebill,/Leite/);
 assert.doesNotMatch(prebill,/Não cobrar/);
 assert.throws(()=>renderTablePrebillDocument({...session,status:'CLOSED'}),/aberta/i);
});

test('cap-028 R3 rejected overlong unbounded printer payload before local queue/driver side effects',()=>{
 const job={id:'ticket',printerName:'Kitchen',payload:{jobFormat:'R4_KITCHEN_V1',stationTicketId:'t-1',orderId:'o-1',items:[{name:'X'.repeat(16001),quantity:1}]}};
 assert.throws(()=>renderKitchenPrintJob(job),/excede|inválido|tamanho/i);
});
