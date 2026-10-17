const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const effectPath = path.join(__dirname, '..', 'js', 'core', 'idempotent-domain-effect.js');

function sampleEvent() {
  return {
    eventId: 'evt-sale-1',
    type: 'sale.completed',
    aggregate: 'sale',
    aggregateId: 'sale-1',
    occurredAt: '2026-09-09T14:00:00-03:00',
    actor: { userId: 'cashier-1', profileId:'profile-cashier', terminalId: 'pdv-01' },
    source: 'terminal',
    mutationId: null,
    payload: { total: 120.5 }
  };
}

test('idempotent domain effect module exists', () => {
  assert.equal(fs.existsSync(effectPath), true);
});

test('applies an effect once and skips it on event retry', async () => {
  const { createIdempotentDomainEffect } = require(effectPath);
  const applied = new Set();
  const effectStore = {
    async hasApplied(eventId, effectKey) { return applied.has(`${eventId}:${effectKey}`); },
    async markApplied({ eventId, effectKey }) { applied.add(`${eventId}:${effectKey}`); }
  };
  let stockMovements = 0;
  const handler = createIdempotentDomainEffect({
    effectKey: 'inventory.sale-completed',
    effectStore,
    handler: async () => { stockMovements += 1; }
  });

  const first = await handler(sampleEvent());
  const second = await handler(sampleEvent());

  assert.equal(stockMovements, 1);
  assert.equal(first.applied, true);
  assert.equal(second.skipped, true);
});

test('does not mark the effect applied when the effect fails', async () => {
  const { createIdempotentDomainEffect } = require(effectPath);
  const applied = new Set();
  const effectStore = {
    async hasApplied(eventId, effectKey) { return applied.has(`${eventId}:${effectKey}`); },
    async markApplied({ eventId, effectKey }) { applied.add(`${eventId}:${effectKey}`); }
  };
  const handler = createIdempotentDomainEffect({
    effectKey: 'fiscal.sale-completed',
    effectStore,
    handler: async () => { throw new Error('provider offline'); }
  });

  await assert.rejects(() => handler(sampleEvent()), /provider offline/);
  assert.equal(applied.size, 0);
});
