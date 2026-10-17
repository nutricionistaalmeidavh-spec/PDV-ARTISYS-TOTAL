const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.join(__dirname, '..', 'js', 'core', 'domain-event-bus.js');

test('domain event bus module exists', () => {
  assert.equal(fs.existsSync(modulePath), true);
});

test('publishes a canonical event to a subscriber exactly once', () => {
  const { DomainEventBus } = require(modulePath);
  const bus = new DomainEventBus();
  const received = [];
  const handler = (event) => received.push(event.eventId);

  bus.subscribe('sale.completed', handler);
  bus.subscribe('sale.completed', handler);

  const result = bus.publish({
    eventId: 'evt-sale-1',
    type: 'sale.completed',
    aggregate: 'sale',
    aggregateId: 'sale-1',
    occurredAt: '2026-09-09T14:00:00-03:00',
    actor: { userId: 'cashier-1', profileId:'profile-cashier', terminalId: 'pdv-01' },
    source: 'terminal',
    mutationId: null,
    payload: { total: 120.5 }
  });

  assert.deepEqual(received, ['evt-sale-1']);
  assert.equal(result.delivered, 1);
  assert.equal(result.failures.length, 0);
});

test('isolates subscriber failures and continues dispatching', () => {
  const { DomainEventBus } = require(modulePath);
  const bus = new DomainEventBus();
  let healthySubscriberCalled = false;

  bus.subscribe('sale.completed', () => {
    throw new Error('printer offline');
  });
  bus.subscribe('sale.completed', () => {
    healthySubscriberCalled = true;
  });

  const result = bus.publish({
    eventId: 'evt-sale-2',
    type: 'sale.completed',
    aggregate: 'sale',
    aggregateId: 'sale-2',
    occurredAt: '2026-09-09T14:01:00-03:00',
    actor: { userId: 'cashier-1', profileId:'profile-cashier', terminalId: 'pdv-01' },
    source: 'terminal',
    mutationId: null,
    payload: {}
  });

  assert.equal(healthySubscriberCalled, true);
  assert.equal(result.delivered, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].message, 'printer offline');
});

test('unsubscribe removes the handler', () => {
  const { DomainEventBus } = require(modulePath);
  const bus = new DomainEventBus();
  let calls = 0;
  const unsubscribe = bus.subscribe('cash-session.closed', () => { calls += 1; });
  unsubscribe();

  bus.publish({
    eventId: 'evt-cash-1',
    type: 'cash-session.closed',
    aggregate: 'cash-session',
    aggregateId: 'cash-1',
    occurredAt: '2026-09-09T14:02:00-03:00',
    actor: { userId: 'cashier-1', profileId:'profile-cashier', terminalId: 'pdv-01' },
    source: 'terminal',
    mutationId: null,
    payload: {}
  });

  assert.equal(calls, 0);
});

test('rejects invalid event envelopes before notifying subscribers', () => {
  const { DomainEventBus } = require(modulePath);
  const bus = new DomainEventBus();
  let called = false;
  bus.subscribe('sale.completed', () => { called = true; });

  assert.throws(() => bus.publish({ type: 'sale.completed' }), /eventId/);
  assert.equal(called, false);
});

test('publishAsync waits for asynchronous subscribers and isolates rejections', async () => {
  const { DomainEventBus } = require(modulePath);
  const bus = new DomainEventBus();
  const calls = [];

  bus.subscribe('fiscal.issue-requested', async () => {
    await Promise.resolve();
    calls.push('fiscal');
  });
  bus.subscribe('fiscal.issue-requested', async () => {
    await Promise.resolve();
    throw new Error('provider offline');
  });
  bus.subscribe('fiscal.issue-requested', () => {
    calls.push('audit');
  });

  const result = await bus.publishAsync({
    eventId: 'evt-fiscal-1',
    type: 'fiscal.issue-requested',
    aggregate: 'sale',
    aggregateId: 'sale-1',
    occurredAt: '2026-09-09T14:03:00-03:00',
    actor: { userId: 'cashier-1', profileId:'profile-cashier', terminalId: 'pdv-01' },
    source: 'terminal',
    mutationId: null,
    payload: {}
  });

  assert.deepEqual(calls, ['fiscal', 'audit']);
  assert.equal(result.delivered, 2);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].message, 'provider offline');
});
