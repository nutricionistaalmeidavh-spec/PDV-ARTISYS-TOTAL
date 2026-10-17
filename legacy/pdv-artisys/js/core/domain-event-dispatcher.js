'use strict';

function assertAdapterMethod(adapter, methodName) {
  if (!adapter || typeof adapter[methodName] !== 'function') {
    throw new TypeError(`DomainEventDispatcher outbox must implement ${methodName}()`);
  }
}

class DomainEventDispatcher {
  constructor({ bus, outbox, batchSize = 100 } = {}) {
    if (!bus || typeof bus.publish !== 'function') {
      throw new TypeError('DomainEventDispatcher requires a bus with publish()');
    }
    assertAdapterMethod(outbox, 'listPending');
    assertAdapterMethod(outbox, 'markDispatched');
    assertAdapterMethod(outbox, 'recordFailure');

    if (!Number.isInteger(batchSize) || batchSize <= 0) {
      throw new TypeError('DomainEventDispatcher batchSize must be a positive integer');
    }

    this.bus = bus;
    this.outbox = outbox;
    this.batchSize = batchSize;
    this._dispatchPromise = null;
    this._rerunRequested = false;
  }

  async _dispatchBatch(events) {
    let dispatched = 0;
    let failed = 0;
    const failures = [];

    for (const event of events) {
      let result;
      try {
        result = typeof this.bus.publishAsync === 'function'
          ? await this.bus.publishAsync(event)
          : this.bus.publish(event);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.outbox.recordFailure(event?.eventId || null, message);
        failed += 1;
        failures.push({ eventId: event?.eventId || null, message });
        continue;
      }

      if (result.failures.length > 0) {
        const message = result.failures
          .map((failure) => `${failure.handler}: ${failure.message}`)
          .join('; ');
        await this.outbox.recordFailure(event.eventId, message);
        failed += 1;
        failures.push({ eventId: event.eventId, message });
        continue;
      }

      await this.outbox.markDispatched(event.eventId);
      dispatched += 1;
    }

    return { attempted:events.length, dispatched, failed, failures };
  }

  async _drainPending() {
    const total = { attempted:0, dispatched:0, failed:0, failures:[] };
    const attemptedEventIds = new Set();

    do {
      this._rerunRequested = false;

      while (true) {
        const listed = await this.outbox.listPending(this.batchSize);
        if (!Array.isArray(listed)) {
          throw new TypeError('Domain event outbox listPending() must return an array');
        }
        if (listed.length === 0) break;

        const events = listed.filter(event => !attemptedEventIds.has(event?.eventId));
        if (events.length === 0) break;
        for (const event of events) attemptedEventIds.add(event?.eventId);

        const result = await this._dispatchBatch(events);
        total.attempted += result.attempted;
        total.dispatched += result.dispatched;
        total.failed += result.failed;
        total.failures.push(...result.failures);

        // Failed events intentionally stay pending for a later retry. Stop this
        // drain here so the same failing event is not retried in a tight loop.
        if (result.failed > 0) break;
      }
    } while (this._rerunRequested && total.failed === 0);

    return total;
  }

  async dispatchPending() {
    if (this._dispatchPromise) {
      this._rerunRequested = true;
      return this._dispatchPromise;
    }

    this._dispatchPromise = this._drainPending();
    try {
      return await this._dispatchPromise;
    } finally {
      this._dispatchPromise = null;
    }
  }
}

module.exports = {
  DomainEventDispatcher
};
