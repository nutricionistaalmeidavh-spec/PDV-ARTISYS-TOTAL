'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../js/core/database/sqlite-database');
const { runMigrations, CURRENT_SCHEMA_VERSION } = require('../js/core/database/migrations');
const { createTerminalRegistry } = require('../server/lan/terminal-registry');
const { createMutationCoordinator } = require('../server/lan/mutation-coordinator');

function fixture() {
  const db = openDatabase(':memory:');
  let tick = 0;
  const now = () => new Date(1788998400000 + tick++ * 1000).toISOString();
  runMigrations(db, now);
  return { db, now };
}

test('schema includes E21 terminal and mutation tables', () => {
  const { db } = fixture();
  try {
    assert.ok(CURRENT_SCHEMA_VERSION >= 3);
    for (const table of ['terminals','pairing_codes','processed_mutations']) {
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(table).n, 1);
    }
  } finally { db.close(); }
});

test('pairing code is single-use and terminal credential is verified without storing plaintext', () => {
  const { db, now } = fixture();
  try {
    const registry = createTerminalRegistry({ db, now, idFactory: prefix => `${prefix}-1`, secretFactory: () => 'terminal-secret-plain' });
    const pairing = registry.createPairingCode({ createdBy: 'admin-1', ttlSeconds: 300 });
    assert.match(pairing.code, /^\d{6}$/);
    const paired = registry.pairTerminal({ code: pairing.code, terminalId: 'PDV-02', name: 'Caixa 2', fingerprint: 'machine-fp', appVersion: '1.0.0' });
    assert.equal(paired.credential, 'terminal-secret-plain');
    assert.equal(registry.authenticateTerminal('PDV-02', paired.credential).ok, true);
    assert.equal(registry.authenticateTerminal('PDV-02', 'wrong').ok, false);
    const row = db.prepare('SELECT credential_hash AS hash FROM terminals WHERE terminal_id=?').get('PDV-02');
    assert.ok(row.hash);
    assert.equal(row.hash.includes('terminal-secret-plain'), false);
    assert.throws(() => registry.pairTerminal({ code: pairing.code, terminalId: 'PDV-03', fingerprint: 'other' }), /utilizado|expirado/i);
  } finally { db.close(); }
});

test('blocked terminal cannot authenticate and handshake exposes compatibility without secrets', () => {
  const { db, now } = fixture();
  try {
    let seq = 0;
    const registry = createTerminalRegistry({ db, now, idFactory: p => `${p}-${++seq}`, secretFactory: () => 'abc123' , serverVersion: '1.0.0', minimumTerminalVersion: '1.0.0' });
    const pairing = registry.createPairingCode({ createdBy: 'admin-1' });
    registry.pairTerminal({ code: pairing.code, terminalId: 'PDV-02', name: 'Caixa 2', fingerprint: 'fp', appVersion: '1.0.0' });
    registry.setTerminalStatus('PDV-02', 'BLOCKED', { userId: 'admin-1' });
    assert.equal(registry.authenticateTerminal('PDV-02', 'abc123').ok, false);
    const handshake = registry.handshake({ terminalId: 'PDV-02', appVersion: '0.9.0' });
    assert.equal(handshake.compatible, false);
    assert.equal(handshake.serverVersion, '1.0.0');
    assert.equal(handshake.minimumTerminalVersion, '1.0.0');
    assert.equal(JSON.stringify(handshake).includes('abc123'), false);
  } finally { db.close(); }
});

test('mutation coordinator returns one canonical result for duplicate concurrent and restarted calls', async () => {
  const { db, now } = fixture();
  try {
    const coordinator = createMutationCoordinator({ db, now });
    let calls = 0;
    const handler = async () => { calls += 1; await new Promise(resolve => setTimeout(resolve, 5)); return { statusCode: 200, payload: { ok: true, sequence: calls } }; };
    const [a, b] = await Promise.all([
      coordinator.execute({ mutationId: 'mut-1', method: 'POST', path: '/api/v1/sales/s1/complete' }, handler),
      coordinator.execute({ mutationId: 'mut-1', method: 'POST', path: '/api/v1/sales/s1/complete' }, handler)
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(a, b);
    const restarted = createMutationCoordinator({ db, now });
    const c = await restarted.execute({ mutationId: 'mut-1', method: 'POST', path: '/api/v1/sales/s1/complete' }, async () => { calls += 1; return { statusCode: 500, payload: {} }; });
    assert.equal(calls, 1);
    assert.deepEqual(c, a);
  } finally { db.close(); }
});
