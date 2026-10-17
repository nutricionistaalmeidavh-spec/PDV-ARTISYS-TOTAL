'use strict';

function assertNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

function assertEffectStore(effectStore) {
  if (!effectStore || typeof effectStore.hasApplied !== 'function') {
    throw new TypeError('effectStore must implement hasApplied(eventId, effectKey)');
  }
  if (typeof effectStore.markApplied !== 'function') {
    throw new TypeError('effectStore must implement markApplied(effect)');
  }
}

function createIdempotentDomainEffect({ effectKey, effectStore, handler } = {}) {
  assertNonEmptyString(effectKey, 'effectKey');
  assertEffectStore(effectStore);
  if (typeof handler !== 'function') {
    throw new TypeError('handler must be a function');
  }

  return async function idempotentDomainEffect(event) {
    if (!event || typeof event !== 'object') {
      throw new TypeError('event must be an object');
    }
    assertNonEmptyString(event.eventId, 'event.eventId');

    if (await effectStore.hasApplied(event.eventId, effectKey)) {
      return {
        eventId: event.eventId,
        effectKey,
        applied: false,
        skipped: true
      };
    }

    const result = await handler(event);
    await effectStore.markApplied({
      eventId: event.eventId,
      effectKey,
      aggregate: event.aggregate,
      aggregateId: event.aggregateId,
      appliedAt: new Date().toISOString()
    });

    return {
      eventId: event.eventId,
      effectKey,
      applied: true,
      skipped: false,
      result
    };
  };
}

module.exports = {
  createIdempotentDomainEffect
};
