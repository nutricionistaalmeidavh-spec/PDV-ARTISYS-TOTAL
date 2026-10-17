'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../js/core/database/sqlite-database');
const { runMigrations } = require('../js/core/database/migrations');
const { runReleaseMigrations } = require('../js/core/database/release-migrations');
const { runVerticalMigrations } = require('../js/core/database/vertical-migrations');
const { HARDWARE_SCHEMA_VERSION, runHardwareMigrations } = require('../js/core/database/hardware-migrations');

test('E54.1 v9 migration preserves rows and maps legacy hardware confidence statuses', () => {
  const db = openDatabase(':memory:');
  try {
    runMigrations(db);
    runReleaseMigrations(db);
    runVerticalMigrations(db);
    db.prepare(`INSERT INTO hardware_compatibility_evidence(
      id,manufacturer,model,kind,connection,configuration_json,os,tested_at,status,result,created_at,updated_at,evidence
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'old-verified','Fabricante','Modelo A','PRINTER','USB','{}','Windows','2026-09-11T00:00:00.000Z','VERIFIED','OK','2026-09-11T00:00:00.000Z','2026-09-11T00:00:00.000Z','foto/teste'
    );
    db.prepare(`INSERT INTO hardware_compatibility_evidence(
      id,manufacturer,model,kind,connection,configuration_json,os,tested_at,status,result,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'old-blocked','Fabricante','Modelo B','SCALE','SERIAL','{}','Windows','2026-09-11T00:00:00.000Z','BLOCKED_EXTERNAL','Sem equipamento','2026-09-11T00:00:00.000Z','2026-09-11T00:00:00.000Z'
    );

    assert.equal(runHardwareMigrations(db), HARDWARE_SCHEMA_VERSION);
    assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v,9);
    assert.equal(db.prepare('SELECT status FROM hardware_compatibility_evidence WHERE id=?').get('old-verified').status,'FIELD_VERIFIED');
    assert.equal(db.prepare('SELECT status FROM hardware_compatibility_evidence WHERE id=?').get('old-blocked').status,'UNTESTED_MODEL');
    assert.equal(db.prepare('SELECT evidence FROM hardware_compatibility_evidence WHERE id=?').get('old-verified').evidence,'foto/teste');
    assert.equal(runHardwareMigrations(db),9);
  } finally {
    db.close();
  }
});
