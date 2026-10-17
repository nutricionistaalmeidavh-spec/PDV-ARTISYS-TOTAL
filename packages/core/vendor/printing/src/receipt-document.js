'use strict';
const { PrintingError } = require('./errors');

const WIDTHS = new Set([32, 42, 48]);
function freezePairs(values) { return Object.freeze((values || []).map(pair => Object.freeze([pair?.[0] ?? '', pair?.[1] ?? '']))); }
function createReceiptDocument(input = {}) {
  const width = Number(input.width ?? 42);
  if (!WIDTHS.has(width)) throw new PrintingError('PRINTER_RENDER_FAILED', 'Largura deve ser 32, 42 ou 48 colunas.');
  const items = Object.freeze((input.items || []).map(item => Object.freeze({
    name:String(item?.name || 'Item'),
    quantity:Number(item?.quantity || 0),
    unitPriceCents:Number(item?.unitPriceCents || 0),
    totalCents:Number(item?.totalCents || 0),
    details:Object.freeze((item?.details || []).map(value => String(value ?? '')).filter(Boolean))
  })));
  const blocks = Object.freeze((input.blocks || []).map(block => Object.freeze({ ...block })));
  const footer = Object.freeze((input.footer || []).map(value => String(value ?? '')));
  return Object.freeze({
    width,
    title:String(input.title || ''),
    documentLabel:String(input.documentLabel || ''),
    metadata:freezePairs(input.metadata),
    items,
    totals:freezePairs(input.totals),
    payments:freezePairs(input.payments),
    changeCents:Number(input.changeCents || 0),
    blocks,
    footer
  });
}

module.exports = { createReceiptDocument, WIDTHS };
