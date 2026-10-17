'use strict';

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

class SqliteOutboxStore {
  constructor(db) {
    this.db = db;
    this.insertStatement = db.prepare(`INSERT INTO domain_events
      (event_id,type,aggregate_type,aggregate_id,mutation_id,source,actor_json,payload_json,occurred_at)
      VALUES (?,?,?,?,?,?,?,?,?)`);
  }

  insert(event) {
    if (!event || !event.eventId || !event.type || !event.aggregate || event.aggregateId == null) {
      throw new TypeError('Evento de dominio invalido.');
    }
    this.insertStatement.run(
      event.eventId,
      event.type,
      event.aggregate,
      String(event.aggregateId),
      event.mutationId || null,
      event.source || 'server',
      JSON.stringify(event.actor || {}),
      JSON.stringify(event.payload || {}),
      event.occurredAt || new Date().toISOString()
    );
    return event;
  }

  async listPending(limit = 100) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));
    return this.db.prepare(`SELECT event_id AS eventId,type,aggregate_type AS aggregate,aggregate_id AS aggregateId,
      mutation_id AS mutationId,source,actor_json AS actorJson,payload_json AS payloadJson,occurred_at AS occurredAt
      FROM domain_events WHERE dispatched_at IS NULL ORDER BY occurred_at,event_id LIMIT ?`).all(safeLimit)
      .map(row => ({
        eventId: row.eventId,
        type: row.type,
        aggregate: row.aggregate,
        aggregateId: row.aggregateId,
        mutationId: row.mutationId,
        source: row.source,
        actor: parseJson(row.actorJson, {}),
        payload: parseJson(row.payloadJson, {}),
        occurredAt: row.occurredAt
      }));
  }

  async markDispatched(eventId) {
    this.db.prepare("UPDATE domain_events SET dispatched_at=?, last_error=NULL WHERE event_id=?")
      .run(new Date().toISOString(), eventId);
  }

  async recordFailure(eventId, message) {
    this.db.prepare('UPDATE domain_events SET last_error=? WHERE event_id=?').run(String(message || '').slice(0, 4000), eventId);
  }
}

module.exports = { SqliteOutboxStore };
