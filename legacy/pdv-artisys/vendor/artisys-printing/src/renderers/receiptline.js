'use strict';
const { wrapPrintingError } = require('../errors');
const { money } = require('./plain-text');
function safe(value) { return String(value ?? '').replace(/[{}|\r\n]/g,' ').trim(); }
function toReceiptLineMarkup(document) {
  try {
    const lines=[];
    if (document.title || document.documentLabel) lines.push('{align:center}');
    if (document.title) lines.push(safe(document.title));
    if (document.documentLabel) lines.push(safe(document.documentLabel));
    lines.push('{align:left}');
    for (const pair of document.metadata || []) {
      const label=safe(pair?.[0]); const value=safe(pair?.[1]); lines.push(label ? `${label}: ${value}` : value);
    }
    if ((document.metadata || []).length) lines.push('-');
    for (const item of document.items || []) {
      lines.push(safe(item.name || 'Item'));
      for (const detail of item.details || []) { const value=safe(detail); if(value) lines.push(`  ${value}`); }
      lines.push(`${Number(item.quantity || 0)} x ${money(item.unitPriceCents)} | ${money(item.totalCents)}`);
    }
    if ((document.items || []).length) lines.push('-');
    for (const pair of document.totals || []) lines.push(`${safe(pair?.[0])} | ${money(pair?.[1])}`);
    if ((document.totals || []).length) lines.push('-');
    for (const pair of document.payments || []) lines.push(`${safe(pair?.[0] || 'Pagamento')} | ${money(pair?.[1])}`);
    if (Number(document.changeCents || 0) > 0) lines.push(`Troco | ${money(document.changeCents)}`);
    for (const block of document.blocks || []) {
      const type=String(block?.type || '').toLowerCase(); const value=safe(block?.value); if (!value) continue;
      if (type === 'qr') lines.push(`{code:${value}; option:qrcode,4,m}`);
      else if (type === 'barcode') lines.push(`{code:${value}; option:${safe(block.symbology || 'code128')},2,72,hri}`);
      else if (type === 'text') lines.push(value);
    }
    if ((document.footer || []).length) lines.push('{align:center}');
    for (const footer of document.footer || []) lines.push(safe(footer));
    return lines.join('\n');
  } catch (error) { throw wrapPrintingError(error,'PRINTER_RENDER_FAILED'); }
}
function resolveReceiptLine(receiptline) { return receiptline || require('receiptline'); }
function renderReceiptLine(document, { receiptline, command = 'escpos', encoding = 'cp860', ...options } = {}) {
  try {
    const engine=resolveReceiptLine(receiptline);
    if (!engine || typeof engine.transform !== 'function') throw new TypeError('ReceiptLine transform indisponivel.');
    return engine.transform(toReceiptLineMarkup(document), { cpl:Number(document.width || 42), encoding, command, ...options });
  } catch (error) { throw wrapPrintingError(error,'PRINTER_RENDER_FAILED'); }
}
function renderReceiptSvg(document, options = {}) { return renderReceiptLine(document,{ ...options, command:'svg' }); }
module.exports = { toReceiptLineMarkup, renderReceiptLine, renderReceiptSvg };
