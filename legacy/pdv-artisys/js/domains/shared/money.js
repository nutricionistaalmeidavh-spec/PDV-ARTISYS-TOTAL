'use strict';

function assertCents(value, field = 'valor') {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${field} deve usar centavos inteiros.`);
  return value;
}

function toCents(value) {
  if (typeof value === 'string' && value.trim() === '') throw new TypeError('Valor monetario invalido.');
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError('Valor monetario invalido.');
  const cents = Math.round((number + Number.EPSILON) * 100);
  assertCents(cents);
  return cents;
}

function formatCents(cents) {
  assertCents(cents);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

module.exports = { assertCents, toCents, formatCents };
