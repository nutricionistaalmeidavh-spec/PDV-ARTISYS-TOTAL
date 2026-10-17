'use strict';

const { withTransaction } = require('./sqlite-database');

const HARDWARE_SCHEMA_VERSION = 9;
const V9_SQL = `
  ALTER TABLE hardware_compatibility_evidence RENAME TO hardware_compatibility_evidence_v8;

  CREATE TABLE hardware_compatibility_evidence (
    id TEXT PRIMARY KEY,
    manufacturer TEXT NOT NULL,
    model TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN('PRINTER','SCALE','DRAWER','SCANNER','OTHER')),
    connection TEXT NOT NULL,
    driver TEXT,
    configuration_json TEXT NOT NULL DEFAULT '{}',
    os TEXT NOT NULL,
    tested_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN('PROTOCOL_VERIFIED','FIELD_VERIFIED','UNTESTED_MODEL','PARTIAL','UNSUPPORTED')),
    result TEXT NOT NULL,
    limitations TEXT,
    evidence TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  INSERT INTO hardware_compatibility_evidence(
    id,manufacturer,model,kind,connection,driver,configuration_json,os,tested_at,status,result,limitations,evidence,created_at,updated_at
  )
  SELECT
    id,manufacturer,model,kind,connection,driver,configuration_json,os,tested_at,
    CASE status
      WHEN 'VERIFIED' THEN 'FIELD_VERIFIED'
      WHEN 'BLOCKED_EXTERNAL' THEN 'UNTESTED_MODEL'
      ELSE status
    END,
    result,limitations,evidence,created_at,updated_at
  FROM hardware_compatibility_evidence_v8;

  DROP TABLE hardware_compatibility_evidence_v8;
  CREATE INDEX idx_hardware_evidence_model ON hardware_compatibility_evidence(manufacturer,model,kind,tested_at);
`;

function runHardwareMigrations(db, now = () => new Date().toISOString()) {
  if (!db) throw new TypeError('Database is required.');
  const currentRow = db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get();
  const current = Number(currentRow?.version || 0);
  if (current >= HARDWARE_SCHEMA_VERSION) return current;
  if (current < 8) throw new Error('E54.1 requer schema vertical v8 antes da migracao de hardware.');

  withTransaction(db, () => {
    db.exec(V9_SQL);
    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(HARDWARE_SCHEMA_VERSION, 'pdv_hardware_confidence_e54_1', now());
  });
  return HARDWARE_SCHEMA_VERSION;
}

module.exports = { HARDWARE_SCHEMA_VERSION, V9_SQL, runHardwareMigrations };
