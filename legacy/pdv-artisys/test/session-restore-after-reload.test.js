'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPdvRuntime } = require('../js/core/pdv-runtime');
const { createLocalServer } = require('../server/local-server');

async function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-session-restore-'));
  const runtime = createPdvRuntime({ dbPath: path.join(dir, 'pdv.sqlite') });
  runtime.catalog.createUser({
    id: 'admin-session',
    username: 'admin',
    name: 'Admin Sessao',
    profileId:'profile-administrator',
    password: 'senha-admin-123'
  });
  const server = createLocalServer({
    runtime,
    host: '127.0.0.1',
    port: 0,
    token: 'install-secret'
  });
  const address = await server.start();
  return {
    runtime,
    server,
    dir,
    base: `http://${address.host}:${address.port}`,
    async close() {
      await server.stop();
      runtime.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

async function login(ctx) {
  const response = await fetch(`${ctx.base}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-pdv-token': 'install-secret'
    },
    body: JSON.stringify({ username: 'admin', password: 'senha-admin-123', terminalId: 'PDV-01' })
  });
  assert.equal(response.status, 200);
  return response.json();
}

test('authenticated session can be recovered after renderer reload', async () => {
  const ctx = await fixture();
  try {
    const loginResult = await login(ctx);
    const response = await fetch(`${ctx.base}/api/v1/auth/session`, {
      headers: { authorization: `Bearer ${loginResult.sessionToken}` }
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.user.id, 'admin-session');
    assert.equal(payload.user.name, 'Admin Sessao');
    assert.equal(payload.user.profileId, 'profile-administrator');
    assert.equal(payload.user.profile?.systemKey, 'admin');
    assert.equal(payload.terminalId, 'PDV-01');
  } finally {
    await ctx.close();
  }
});

test('renderer boot restores a persisted authenticated session before showing login', () => {
  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'renderer', 'api-client.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'renderer', 'app.js'), 'utf8');

  assert.match(apiSource, /currentSession\(\)\s*\{\s*return this\.request\('\/api\/v1\/auth\/session'\);\s*\}/);
  assert.match(appSource, /async function restorePersistedSession\(\)/);
  assert.match(appSource, /const restored = await restorePersistedSession\(\)/);
  assert.match(appSource, /if \(restored\) return;/);
});
