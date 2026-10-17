'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReturnApprovalStore } = require('../server/return-approval-store');

function fixture() {
  let now = 1_000;
  let seq = 0;
  const store = createReturnApprovalStore({
    now: () => now,
    ttlMs: 120_000,
    randomBytesFn: () => Buffer.from(`token-${++seq}`)
  });
  return { store, advance(ms) { now += ms; } };
}

const request = {
  requesterSessionToken:'session-cashier',
  requesterUserId:'cashier1',
  terminalId:'PDV-01',
  saleId:'sale1'
};
const approver = { userId:'manager1', profileId:'profile-manager', name:'Gerente QA' };

test('approval is scoped, single-use and returns only approver identity', () => {
  const { store } = fixture();
  const issued = store.issue({ ...request, authorizedBy:approver });
  assert.ok(issued.approvalToken);
  assert.deepEqual(issued.authorizedBy, approver);
  const consumed = store.consume(issued.approvalToken, { ...request, scope:'return.complete' });
  assert.deepEqual(consumed, approver);
  assert.throws(() => store.consume(issued.approvalToken, { ...request, scope:'return.complete' }), /invalida|consumida/i);
});

test('approval rejects mismatched sale without consuming the valid grant', () => {
  const { store } = fixture();
  const issued = store.issue({ ...request, authorizedBy:approver });
  assert.throws(() => store.consume(issued.approvalToken, { ...request, saleId:'sale2', scope:'return.complete' }), /vinculo|escopo/i);
  assert.deepEqual(store.consume(issued.approvalToken, { ...request, scope:'return.complete' }), approver);
});

test('approval rejects mismatched requesting session and terminal', () => {
  const { store } = fixture();
  const one = store.issue({ ...request, authorizedBy:approver });
  assert.throws(() => store.consume(one.approvalToken, { ...request, requesterSessionToken:'other-session', scope:'return.complete' }), /vinculo|escopo/i);
  const two = store.issue({ ...request, authorizedBy:approver });
  assert.throws(() => store.consume(two.approvalToken, { ...request, terminalId:'PDV-02', scope:'return.complete' }), /vinculo|escopo/i);
});

test('approval expires after the configured 120 second TTL', () => {
  const { store, advance } = fixture();
  const issued = store.issue({ ...request, authorizedBy:approver });
  advance(120_001);
  assert.throws(() => store.consume(issued.approvalToken, { ...request, scope:'return.complete' }), /expirada/i);
});

test('approval store validates identity while authorization stays at the router boundary', () => {
  const { store } = fixture();
  assert.throws(() => store.issue({ ...request, authorizedBy:{ name:'Sem identidade' } }), /Identidade/i);
});
