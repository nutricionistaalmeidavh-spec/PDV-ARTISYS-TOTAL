'use strict';

const SECRET_KEY_PATTERN = /(senha|password|hash|base64|binary|token|secret|authorization)/i;

function sanitizeAuditPayload(value, depth = 0) {
  if (depth > 4) return '[truncated]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 1200 ? `${value.slice(0,1200)}…` : value;
  if (Array.isArray(value)) return value.slice(0,50).map(item => sanitizeAuditPayload(item, depth + 1));
  if (typeof value === 'object') {
    const clean = {};
    for (const [key,item] of Object.entries(value).slice(0,100)) {
      if (!SECRET_KEY_PATTERN.test(key)) clean[key] = sanitizeAuditPayload(item, depth + 1);
    }
    return clean;
  }
  return String(value);
}

function compactJson(value) {
  if (value == null) return null;
  const json = JSON.stringify(sanitizeAuditPayload(value));
  return json.length > 8000 ? `${json.slice(0,7990)}…` : json;
}

function writeAudit(db, event = {}, now = () => new Date().toISOString()) {
  db.prepare(`INSERT INTO audit_log
    (action,entity,entity_id,actor_id,actor_role,context_json,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(
      String(event.action || 'event'),
      String(event.entity || 'system'),
      event.entityId == null ? null : String(event.entityId),
      event.actor?.userId == null ? null : String(event.actor.userId),
      event.actor?.role == null ? null : String(event.actor.role),
      compactJson(event.context),
      now()
    );
  return true;
}

module.exports = { SECRET_KEY_PATTERN, sanitizeAuditPayload, compactJson, writeAudit };
