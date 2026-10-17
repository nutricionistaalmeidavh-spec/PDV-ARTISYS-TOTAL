'use strict';

const { assertCents } = require('../shared/money');

function normalizeMethod(value) {
  return String(value || '').trim().replace(/\s+/g, '_').toUpperCase();
}

function resolvePayment(input = {}) {
  const totalCents = assertCents(input.totalCents, 'totalCents');
  if (totalCents < 0) throw new RangeError('totalCents nao pode ser negativo.');
  const creditMethods = new Set((input.creditMethods || ['STORE_CREDIT']).map(normalizeMethod));
  const changeMethods = new Set((input.changeMethods || ['CASH']).map(normalizeMethod));
  const payments = Array.isArray(input.payments) ? input.payments : [];

  let paidTotalCents = 0;
  let creditTotalCents = 0;
  let changeEligibleCents = 0;

  for (const payment of payments) {
    const amountCents = assertCents(payment.amountCents, 'payment.amountCents');
    if (amountCents < 0) throw new RangeError('payment.amountCents nao pode ser negativo.');
    const method = normalizeMethod(payment.method);
    if (!method) throw new TypeError('Forma de pagamento obrigatoria.');
    paidTotalCents += amountCents;
    if (creditMethods.has(method)) creditTotalCents += amountCents;
    if (changeMethods.has(method)) changeEligibleCents += amountCents;
  }

  if (!Number.isSafeInteger(paidTotalCents)) throw new RangeError('Total de pagamentos excede o limite seguro.');
  const availableCreditCents = input.availableCreditCents == null
    ? Number.MAX_SAFE_INTEGER
    : assertCents(input.availableCreditCents, 'availableCreditCents');

  if (creditTotalCents > availableCreditCents) {
    throw new Error(`Limite de credito insuficiente para ${input.customerName || 'cliente'}.`);
  }

  const remainingTotalCents = Math.max(totalCents - paidTotalCents, 0);
  const nonChangeEligibleCents = paidTotalCents - changeEligibleCents;
  const amountCoveredByChangeEligibleCents = Math.max(totalCents - nonChangeEligibleCents, 0);
  const changeDueCents = Math.max(changeEligibleCents - amountCoveredByChangeEligibleCents, 0);
  const overpaymentCents = Math.max(paidTotalCents - totalCents, 0);

  if (overpaymentCents > changeDueCents) {
    throw new Error('Pagamento excedente so pode ocorrer em forma que permita troco.');
  }

  return {
    status: remainingTotalCents > 0 ? 'insufficient' : 'paid',
    totalCents,
    paidTotalCents,
    remainingTotalCents,
    changeDueCents,
    creditTotalCents,
    immediateTotalCents: paidTotalCents - creditTotalCents
  };
}

module.exports = { normalizeMethod, resolvePayment };
