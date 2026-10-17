const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase, withTransaction } = require('../js/core/database/sqlite-database');
const { runMigrations, CURRENT_SCHEMA_VERSION } = require('../js/core/database/migrations');
const { SqliteOutboxStore } = require('../js/core/database/outbox-store');
const { SqliteEffectStore } = require('../js/core/database/effect-store');
const { sanitizeAuditPayload, writeAudit } = require('../js/core/audit-log');

function event(id = 'evt-1') {
  return {
    eventId: id,
    type: 'sale.completed',
    aggregate: 'sale',
    aggregateId: 'sale-1',
    occurredAt: '2026-09-09T15:00:00.000Z',
    actor: { userId: 'cashier-1', profileId:'profile-cashier', terminalId: 'pdv-01' },
    source: 'server',
    mutationId: 'mut-1',
    payload: { totalCents: 10000 }
  };
}

test('migrations create the E02 schema idempotently without deleting data', () => {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  for (const name of ['schema_migrations','domain_events','domain_event_effects','users','categories','products','customers','suppliers','inventory_balances','inventory_movements','sales','sale_items','payments','cash_sessions','cash_movements','audit_log']) {
    assert.equal(tables.has(name), true, name);
  }
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 5000);
  db.prepare("INSERT INTO categories (id,name,active,created_at,updated_at) VALUES ('cat-1','Geral',1,?,?)").run('now','now');
  runMigrations(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM categories').get().count, 1);
  assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, CURRENT_SCHEMA_VERSION);
  db.close();
});

test('withTransaction rolls back all writes on failure', () => {
  const db = openDatabase(':memory:');
  runMigrations(db);
  assert.throws(() => withTransaction(db, () => {
    db.prepare("INSERT INTO categories (id,name,active,created_at,updated_at) VALUES ('cat-1','Geral',1,'x','x')").run();
    throw new Error('boom');
  }), /boom/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM categories').get().count, 0);
  db.close();
});

test('withTransaction supports nested service transactions without DatabaseSync.isTransaction', () => {
  const rawDb = openDatabase(':memory:');
  runMigrations(rawDb);
  const db = {
    exec: rawDb.exec.bind(rawDb),
    prepare: rawDb.prepare.bind(rawDb)
  };

  withTransaction(db, () => {
    db.prepare("INSERT INTO categories (id,name,active,created_at,updated_at) VALUES ('outer-1','Outer 1',1,'x','x')").run();

    assert.throws(() => withTransaction(db, () => {
      db.prepare("INSERT INTO categories (id,name,active,created_at,updated_at) VALUES ('inner','Inner',1,'x','x')").run();
      throw new Error('inner boom');
    }), /inner boom/);

    db.prepare("INSERT INTO categories (id,name,active,created_at,updated_at) VALUES ('outer-2','Outer 2',1,'x','x')").run();
  });

  assert.deepEqual(
    rawDb.prepare('SELECT id FROM categories ORDER BY id').all().map(row => row.id),
    ['outer-1', 'outer-2']
  );
  rawDb.close();
});

test('outbox persists pending events, failures and dispatch completion', async () => {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const outbox = new SqliteOutboxStore(db);
  outbox.insert(event());
  assert.equal((await outbox.listPending(10)).length, 1);
  await outbox.recordFailure('evt-1', 'printer offline');
  assert.equal(db.prepare('SELECT last_error AS error FROM domain_events WHERE event_id=?').get('evt-1').error, 'printer offline');
  await outbox.markDispatched('evt-1');
  assert.equal((await outbox.listPending(10)).length, 0);
  assert.ok(db.prepare('SELECT dispatched_at AS value FROM domain_events WHERE event_id=?').get('evt-1').value);
  assert.throws(() => outbox.insert(event()), /UNIQUE|constraint/i);
  db.close();
});

test('effect store guarantees eventId plus effectKey idempotency', async () => {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const store = new SqliteEffectStore(db);
  assert.equal(await store.hasApplied('evt-1','inventory.sale-completed'), false);
  await store.markApplied({ eventId:'evt-1', effectKey:'inventory.sale-completed', aggregate:'sale', aggregateId:'sale-1', appliedAt:'2026-09-09T15:00:01Z' });
  assert.equal(await store.hasApplied('evt-1','inventory.sale-completed'), true);
  await store.markApplied({ eventId:'evt-1', effectKey:'inventory.sale-completed', aggregate:'sale', aggregateId:'sale-1', appliedAt:'2026-09-09T15:00:02Z' });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM domain_event_effects').get().count, 1);
  db.close();
});

test('audit sanitizer removes secrets and writeAudit persists compact context', () => {
  const clean = sanitizeAuditPayload({ username:'victor', password:'123', nested:{ token:'abc', value:42 } });
  assert.deepEqual(clean, { username:'victor', nested:{ value:42 } });
  const db = openDatabase(':memory:');
  runMigrations(db);
  writeAudit(db, { action:'product.upsert', entity:'product', entityId:'p1', actor:{ userId:'u1', profileId:'profile-administrator' }, context:{ barcode:'789', secret:'nope' } });
  const row = db.prepare('SELECT action,entity,entity_id AS entityId,context_json AS contextJson FROM audit_log').get();
  assert.equal(row.action, 'product.upsert');
  assert.equal(row.entityId, 'p1');
  assert.deepEqual(JSON.parse(row.contextJson), { barcode:'789' });
  db.close();
});