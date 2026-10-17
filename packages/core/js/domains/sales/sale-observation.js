'use strict';

const MAX_INTERNAL_OBSERVATION_LENGTH = 500;
const MAX_RECEIPT_OBSERVATION_LENGTH = 120;
const MAX_RECEIPT_OBSERVATION_LINES = 4;

function sanitizeSaleObservation(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .slice(0, MAX_INTERNAL_OBSERVATION_LENGTH);
}

function wrapLine(value, width) {
  const lines = [];
  let remaining = String(value ?? '').trim();
  if (!remaining) return [''];
  while (remaining.length > width) {
    const candidate = remaining.slice(0, width + 1);
    const breakAt = candidate.lastIndexOf(' ');
    const index = breakAt >= Math.floor(width * 0.55) ? breakAt : width;
    lines.push(remaining.slice(0, index).trimEnd());
    remaining = remaining.slice(index).trimStart();
  }
  if (remaining) lines.push(remaining);
  return lines;
}

function formatReceiptObservation(value, width = 42) {
  const safeWidth = [32, 42, 48].includes(Number(width)) ? Number(width) : 42;
  const source = sanitizeSaleObservation(value).slice(0, MAX_RECEIPT_OBSERVATION_LENGTH);
  if (!source.trim()) return '';
  const lines = source
    .split('\n')
    .flatMap(line => wrapLine(line, safeWidth))
    .slice(0, MAX_RECEIPT_OBSERVATION_LINES);
  return lines.join('\n').trim();
}

module.exports = {
  MAX_INTERNAL_OBSERVATION_LENGTH,
  MAX_RECEIPT_OBSERVATION_LENGTH,
  MAX_RECEIPT_OBSERVATION_LINES,
  sanitizeSaleObservation,
  formatReceiptObservation
};
