'use strict';

function createMutationCoordinator({ db, now = () => new Date().toISOString() } = {}) {
  if (!db) throw new TypeError('Database is required.');
  const inFlight = new Map();

  function keyOf({ mutationId, method, path }) {
    const id = String(mutationId || '').trim();
    if (!id) return null;
    return { id, method: String(method || 'POST').toUpperCase(), path: String(path || '') };
  }

  function read(key) {
    const row = db.prepare('SELECT * FROM processed_mutations WHERE mutation_id=?').get(key.id);
    if (!row) return null;
    if (row.method !== key.method || row.path !== key.path) throw new Error('mutationId reutilizado para outra operacao.');
    return { statusCode: row.status_code, payload: JSON.parse(row.response_json) };
  }

  async function execute(input, handler) {
    if (typeof handler !== 'function') throw new TypeError('Mutation handler is required.');
    const key = keyOf(input || {});
    if (!key) return handler();
    const persisted = read(key);
    if (persisted) return persisted;
    if (inFlight.has(key.id)) return inFlight.get(key.id);

    const promise = (async () => {
      const result = await handler();
      if (!result || !Number.isInteger(result.statusCode)) throw new Error('Mutation handler must return {statusCode,payload}.');
      const timestamp = now();
      db.prepare(`INSERT INTO processed_mutations
        (mutation_id,method,path,status_code,response_json,created_at,completed_at)
        VALUES (?,?,?,?,?,?,?)`)
        .run(key.id, key.method, key.path, result.statusCode, JSON.stringify(result.payload ?? null), timestamp, timestamp);
      return { statusCode: result.statusCode, payload: result.payload ?? null };
    })();
    inFlight.set(key.id, promise);
    try { return await promise; }
    finally { inFlight.delete(key.id); }
  }

  return { execute, read: input => { const key = keyOf(input || {}); return key ? read(key) : null; } };
}

module.exports = { createMutationCoordinator };
