'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPdvRuntime } = require('../js/core/pdv-runtime');

function tableColumns(db, tableName) {
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map(row => row.name));
}

test('account identity migration is additive after the existing shared migration chain', () => {
  const runtime = createPdvRuntime();
  try {
    const schemaVersion = Number(runtime.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version || 0);
    assert.ok(schemaVersion >= 18, `expected account identity schema >= 18, got ${schemaVersion}`);

    const userColumns = tableColumns(runtime.db, 'users');
    for (const name of ['email', 'email_normalized', 'email_verified_at', 'password_changed_at']) {
      assert.equal(userColumns.has(name), true, name);
    }

    const activationTable = runtime.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='installation_activation'").get();
    assert.equal(activationTable?.name, 'installation_activation');

    const verticalTable = runtime.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='catalog_option_groups'").get();
    assert.equal(verticalTable?.name, 'catalog_option_groups', 'existing v6+ migrations must remain applied');
  } finally {
    runtime.close();
  }
});
