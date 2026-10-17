'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeSaleObservation, formatReceiptObservation } = require('../js/domains/sales/sale-observation');
const { renderSaleReceipt } = require('../js/domains/printing/receipt-renderer');
const { createPdvRuntime } = require('../js/core/pdv-runtime');

test('observacao interna preserva ate 500 caracteres', () => { const source = 'A'.repeat(550); assert.equal(sanitizeSaleObservation(source).length, 500); });
test('observacao impressa fica limitada a 120 caracteres e quatro linhas', () => { const source = Array.from({ length: 20 }, (_, index) => `linha-${index + 1}`).join('\n'); const formatted = formatReceiptObservation(source, 32); assert.ok(formatted.length > 0); assert.ok(formatted.replace(/\n/g, '').length <= 120); assert.ok(formatted.split('\n').length <= 4); });
test('observacao impressa quebra palavras conforme a largura do cupom', () => { const formatted = formatReceiptObservation('Cliente retira amanha as 10h e levar duas caixas separadas.', 32); for (const line of formatted.split('\n')) assert.ok(line.length <= 32); });

test('runtime persiste observacao vinculada a venda e cliente', () => {
  const runtime = createPdvRuntime({ dbPath:':memory:', now:()=> '2026-09-15T12:00:00.000Z' });
  try {
    const actor={ userId:'u1', profileId:'profile-cashier', terminalId:'PDV-01' };
    runtime.catalog.createUser({ id:'u1', username:'caixa', name:'Caixa', profileId:'profile-cashier', password:'senha-forte-123' });
    runtime.catalog.upsertCustomer({ id:'c1', name:'Cliente Teste' });
    runtime.catalog.upsertProduct({ id:'p1', sku:'P1', name:'Produto', salePriceCents:1000, minimumStock:0 });
    runtime.inventory.move({ productId:'p1', type:'opening', quantityDelta:10 });
    runtime.cash.openSession({ id:'cash-PDV-01', terminalId:'PDV-01', operatorId:'u1', initialCashCents:0, actor });
    runtime.sales.openSale({ id:'s1', saleNumber:'000001', terminalId:'PDV-01', operatorId:'u1', customerId:'c1' });
    runtime.sales.addItem('s1', { productId:'p1', quantity:1 });
    const completed = runtime.sales.completeSale('s1', { payments:[{ method:'CASH', amountCents:1000, saleObservation:'Retirar amanha', printObservation:true }], actor });
    assert.equal(completed.observation, 'Retirar amanha'); assert.equal(completed.printObservation, true); assert.equal(completed.customerId, 'c1');
    const row = runtime.db.prepare('SELECT observation,print_observation FROM sales WHERE id=?').get('s1'); assert.equal(row.observation, 'Retirar amanha'); assert.equal(row.print_observation, 1); assert.equal(runtime.sales.getSaleDetails('s1').observation, 'Retirar amanha');
  } finally { runtime.close(); }
});

test('cupom imprime observacao somente quando marcada e respeita quatro linhas', () => { const baseSale = { saleNumber:'000001', completedAt:'2026-09-15T12:00:00.000Z', operatorId:'u1', customerName:'Cliente', subtotalCents:1000, discountCents:0, totalCents:1000, changeCents:0, items:[{ productName:'Produto', quantity:1, unitPriceCents:1000, totalCents:1000 }], payments:[{ method:'CASH', amountCents:1000 }] }; const hidden = renderSaleReceipt({ sale:{ ...baseSale, observation:'Nao imprimir', printObservation:false }, width:32 }); assert.doesNotMatch(hidden, /OBSERVACOES DA VENDA/); assert.doesNotMatch(hidden, /Nao imprimir/); const source = 'Cliente retira amanha as 10h. Separar duas caixas e deixar o pedido identificado para retirada no balcao principal. '.repeat(2); const printed = renderSaleReceipt({ sale:{ ...baseSale, observation:source, printObservation:true }, width:32 }); assert.match(printed, /OBSERVACOES DA VENDA/); const lines = printed.split('\n'); const start = lines.indexOf('OBSERVACOES DA VENDA'); assert.ok(start >= 0); const observationLines = lines.slice(start + 1, start + 5); assert.ok(observationLines.length <= 4); assert.ok(observationLines.every(line => line.length <= 32)); });
