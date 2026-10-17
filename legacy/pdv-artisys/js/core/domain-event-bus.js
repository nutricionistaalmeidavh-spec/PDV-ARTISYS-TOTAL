'use strict';

function assertNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Domain event ${field} must be a non-empty string`);
  }
}

function validateDomainEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new TypeError('Domain event must be an object');
  }

  assertNonEmptyString(event.eventId, 'eventId');
  assertNonEmptyString(event.type, 'type');
  assertNonEmptyString(event.aggregate, 'aggregate');

  if (event.aggregateId === undefined || event.aggregateId === null || event.aggregateId === '') {
    throw new TypeError('Domain event aggregateId is required');
  }

  assertNonEmptyString(event.occurredAt, 'occurredAt');
  assertNonEmptyString(event.source, 'source');

  if (!event.actor || typeof event.actor !== 'object' || Array.isArray(event.actor)) {
    throw new TypeError('Domain event actor must be an object');
  }

  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    throw new TypeError('Domain event payload must be an object');
  }

  if (event.mutationId !== undefined && event.mutationId !== null) {
    assertNonEmptyString(event.mutationId, 'mutationId');
  }

  return event;
}

class DomainEventBus {
  constructor() {
    this._subscribers = new Map();
  }

  subscribe(eventName, handler) {
    assertNonEmptyString(eventName, 'type');
    if (typeof handler !== 'function') {
      throw new TypeError('Domain event handler must be a function');
    }

    let handlers = this._subscribers.get(eventName);
    if (!handlers) {
      handlers = new Set();
      this._subscribers.set(eventName, handlers);
    }

    handlers.add(handler);
    let active = true;

    return () => {
      if (!active) return false;
      active = false;
      const current = this._subscribers.get(eventName);
      if (!current) return false;
      const deleted = current.delete(handler);
      if (current.size === 0) this._subscribers.delete(eventName);
      return deleted;
    };
  }

  publish(event) {
    validateDomainEvent(event);
    const handlers = Array.from(this._subscribers.get(event.type) || []);
    const failures = [];
    let delivered = 0;

    for (const handler of handlers) {
      try {
        const result = handler(event);
        if (result && typeof result.then === 'function') {
          throw new TypeError('DomainEventBus subscribers must be synchronous');
        }
        delivered += 1;
      } catch (error) {
        failures.push({
          handler: handler.name || 'anonymous',
          message: error instanceof Error ? error.message : String(error),
          error
        });
      }
    }

    return {
      eventId: event.eventId,
      type: event.type,
      subscribers: handlers.length,
      delivered,
      failures
    };
  }

  async publishAsync(event) {
    validateDomainEvent(event);
    const handlers = Array.from(this._subscribers.get(event.type) || []);
    const failures = [];
    let delivered = 0;

    for (const handler of handlers) {
      try {
        await handler(event);
        delivered += 1;
      } catch (error) {
        failures.push({
          handler: handler.name || 'anonymous',
          message: error instanceof Error ? error.message : String(error),
          error
        });
      }
    }

    return {
      eventId: event.eventId,
      type: event.type,
      subscribers: handlers.length,
      delivered,
      failures
    };
  }

  clear(eventName) {
    if (eventName === undefined) {
      this._subscribers.clear();
      return;
    }
    assertNonEmptyString(eventName, 'type');
    this._subscribers.delete(eventName);
  }

  subscriberCount(eventName) {
    assertNonEmptyString(eventName, 'type');
    return this._subscribers.get(eventName)?.size || 0;
  }
}

module.exports = {
  DomainEventBus,
  validateDomainEvent
};
