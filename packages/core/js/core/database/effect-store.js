'use strict';

class SqliteEffectStore {
  constructor(db) { this.db = db; }

  async hasApplied(eventId, effectKey) {
    return Boolean(this.db.prepare('SELECT 1 AS found FROM domain_event_effects WHERE event_id=? AND effect_key=?').get(eventId,effectKey));
  }

  async markApplied(effect) {
    this.db.prepare(`INSERT OR IGNORE INTO domain_event_effects
      (event_id,effect_key,aggregate_type,aggregate_id,applied_at) VALUES (?,?,?,?,?)`)
      .run(effect.eventId,effect.effectKey,effect.aggregate,String(effect.aggregateId),effect.appliedAt || new Date().toISOString());
  }
}

module.exports = { SqliteEffectStore };
