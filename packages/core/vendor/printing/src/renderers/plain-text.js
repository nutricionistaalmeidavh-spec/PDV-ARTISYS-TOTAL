'use strict';
const { PrintingError, wrapPrintingError } = require('../errors');

function money(cents) {
  const value=Number(cents || 0);
  if (!Number.isFinite(value)) throw new PrintingError('PRINTER_RENDER_FAILED','Valor monetario invalido.');
  const integer=Math.trunc(value);
  const sign=integer < 0 ? '-' : '';
  const abs=Math.abs(integer);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2,'0')}`;
}
function fit(text, width) {
  const w=Math.max(Number(width) || 0, 0);
  const value=String(text == null ? '' : text);
  if (value.length <= w) return value;
  if (w === 0) return '';
  if (w === 1) return '…';
  return `${value.slice(0,w - 1)}…`;
}
function center(text, width) {
  const value=fit(text,width);
  const left=Math.max(Math.floor((Number(width) - value.length) / 2),0);
  return fit(`${' '.repeat(left)}${value}`, Number(width));
}
function columns(left, right, width) {
  const w=Number(width);
  const r=fit(right,w);
  const available=Math.max(w - r.length - 1,0);
  const l=fit(left,available);
  const gap=Math.max(w - l.length - r.length,1);
  return fit(`${l}${' '.repeat(gap)}${r}`,w);
}
function renderPlainText(document) {
  try {
    if (!document || ![32,42,48].includes(Number(document.width))) throw new PrintingError('PRINTER_RENDER_FAILED','Documento de recibo invalido.');
    const w=Number(document.width);
    const lines=[];
    if (document.title) lines.push(center(document.title,w));
    if (document.documentLabel) lines.push(center(document.documentLabel,w));
    if (lines.length) lines.push('-'.repeat(w));
    for (const pair of document.metadata || []) {
      const label=String(pair?.[0] ?? '').trim();
      const value=String(pair?.[1] ?? '');
      lines.push(fit(label ? `${label}: ${value}` : value,w));
    }
    if ((document.metadata || []).length) lines.push('-'.repeat(w));
    for (const item of document.items || []) {
      lines.push(fit(item.name || 'Item',w));
      for (const detail of item.details || []) lines.push(fit(`  ${detail}`,w));
      lines.push(columns(`${Number(item.quantity || 0)} x ${money(item.unitPriceCents)}`,money(item.totalCents),w));
    }
    if ((document.items || []).length) lines.push('-'.repeat(w));
    for (const pair of document.totals || []) lines.push(columns(String(pair?.[0] ?? ''),money(pair?.[1]),w));
    if ((document.totals || []).length) lines.push('-'.repeat(w));
    for (const pair of document.payments || []) lines.push(columns(String(pair?.[0] ?? 'Pagamento'),money(pair?.[1]),w));
    if (Number(document.changeCents || 0) > 0) lines.push(columns('Troco',money(document.changeCents),w));
    if ((document.payments || []).length || Number(document.changeCents || 0) > 0) lines.push('-'.repeat(w));
    for (const block of document.blocks || []) if (block?.type === 'text' && block.value != null) lines.push(fit(block.value,w));
    for (const footer of document.footer || []) lines.push(center(footer,w));
    return `${lines.map(line=>fit(line,w)).join('\n')}\n`;
  } catch (error) { throw wrapPrintingError(error,'PRINTER_RENDER_FAILED'); }
}

module.exports = { renderPlainText, money, fit, center, columns };
