'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPdvRuntime } = require('../js/core/pdv-runtime');

test('legacy local user remains valid without email', () => {
  const runtime = createPdvRuntime({ now: () => '2026-09-25T20:00:00.000Z', idFactory: prefix => `${prefix}-legacy` });
  try {
    const user = runtime.catalog.createUser({ username:'legacy', name:'Legado', profileId:'profile-administrator', password:'senha-forte-123' });
    assert.equal(Object.hasOwn(user, 'email'), false);
    assert.equal(runtime.catalog.verifyUserPassword('legacy', 'senha-forte-123').ok, true);
  } finally {
    runtime.close();
  }
});

test('user email is optional, normalized and unique when present', () => {
  const runtime = createPdvRuntime({ now: () => '2026-09-25T20:00:00.000Z', idFactory: prefix => `${prefix}-${Math.random()}` });
  try {
    const user = runtime.catalog.createUser({
      id:'user-email-1', username:'admin1', name:'Admin 1', profileId:'profile-administrator', password:'senha-forte-123', email:'  Admin@Example.COM '
    });
    assert.equal(user.email, 'admin@example.com');
    const raw = runtime.db.prepare('SELECT email,email_normalized FROM users WHERE id=?').get('user-email-1');
    assert.deepEqual({ ...raw }, { email:'admin@example.com', email_normalized:'admin@example.com' });

    assert.throws(() => runtime.catalog.createUser({
      id:'user-email-2', username:'admin2', name:'Admin 2', profileId:'profile-administrator', password:'senha-forte-123', email:'ADMIN@example.com'
    }), /UNIQUE|e-mail|email/i);
  } finally {
    runtime.close();
  }
});