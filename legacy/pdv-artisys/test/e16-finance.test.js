'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../js/core/database/sqlite-database');
const { runMigrations } = require('../js/core/database/migrations');
const { createFinanceService } = require('../js/domains/finance/finance-service');

function service() {
  const db = openDatabase(':memory:');
  runMigrations(db);
  let seq = 0;
  const finance = createFinanceService({ db, now:()=> '2026-09-10T12:00:00Z', idFactory:p=>`${p}-${++seq}` });
  return { db, finance };
}

test('finance supports payable and receivable entries with partial and full settlements in cents', () => {
  const { db, finance } = service();
  const account = finance.createAccount({ name:'Banco', type:'BANK' });
  const payable = finance.createEntry({ kind:'PAYABLE', description:'Energia', accountId:account.id, amountCents:10000, dueAt:'2026-09-15T00:00:00Z', category:'Despesas' });
  const receivable = finance.createEntry({ kind:'RECEIVABLE', description:'Cliente empresa', amountCents:20000, dueAt:'2026-09-20T00:00:00Z' });
  assert.equal(payable.openCents, 10000);
  assert.equal(receivable.openCents, 20000);

  const first = finance.settleEntry(payable.id, { amountCents:4000, method:'PIX' });
  assert.equal(first.entry.status, 'PARTIAL');
  assert.equal(first.entry.settledCents, 4000);
  assert.equal(first.entry.openCents, 6000);

  const second = finance.settleEntry(payable.id, { amountCents:6000, method:'PIX' });
  assert.equal(second.entry.status, 'SETTLED');
  assert.equal(second.entry.openCents, 0);
  assert.throws(() => finance.settleEntry(payable.id, { amountCents:1, method:'PIX' }), /saldo|liquid/i);

  const summary = finance.getSummary({ asOf:'2026-09-10T12:00:00Z' });
  assert.equal(summary.payableTotalCents, 10000);
  assert.equal(summary.payableSettledCents, 10000);
  assert.equal(summary.receivableOpenCents, 20000);
  db.close();
});

test('reversing a settlement reopens entry and overdue is derived without negative balances', () => {
  const { db, finance } = service();
  const entry = finance.createEntry({ kind:'PAYABLE', description:'Aluguel', amountCents:9000, dueAt:'2026-09-01T00:00:00Z' });
  const settlement = finance.settleEntry(entry.id, { amountCents:9000, method:'CASH' }).settlement;
  assert.equal(finance.getEntry(entry.id).status, 'SETTLED');
  const reversed = finance.reverseSettlement(settlement.id, { reason:'Pagamento estornado' });
  assert.equal(reversed.entry.status, 'OPEN');
  assert.equal(reversed.entry.openCents, 9000);
  assert.equal(reversed.entry.isOverdue, true);
  assert.throws(() => finance.settleEntry(entry.id, { amountCents:9001, method:'CASH' }), /saldo.*aberto|excede/i);
  db.close();
});

test('finance list filters status kind date and cancellation preserves history', () => {
  const { db, finance } = service();
  const a = finance.createEntry({ kind:'PAYABLE', description:'Fornecedor A', amountCents:5000, dueAt:'2026-09-05T00:00:00Z' });
  finance.createEntry({ kind:'RECEIVABLE', description:'Venda futura', amountCents:7000, dueAt:'2026-10-05T00:00:00Z' });
  assert.equal(finance.listEntries({ kind:'PAYABLE', query:'fornecedor' }).length, 1);
  const cancelled = finance.cancelEntry(a.id, { reason:'Lancamento duplicado' });
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(finance.listEntries({ status:'CANCELLED' }).length, 1);
  assert.equal(finance.getEntry(a.id).description, 'Fornecedor A');
  db.close();
});
