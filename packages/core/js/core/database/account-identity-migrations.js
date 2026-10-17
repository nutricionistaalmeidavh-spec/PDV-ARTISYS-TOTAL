'use strict';

const { withTransaction } = require('./sqlite-database');

const ACCOUNT_IDENTITY_SCHEMA_VERSION = 24;
const ACCOUNT_IDENTITY_MIGRATION_NAME = 'pdv_auth_account_ownership_v24';

function tableColumns(db, tableName) {
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map(row => row.name));
}

function ensureColumn(db, tableName, columnName, definition) {
  if (tableColumns(db, tableName).has(columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function applyAccountIdentityMigration(db) {
  ensureColumn(db, 'users', 'email', 'TEXT');
  ensureColumn(db, 'users', 'email_normalized', 'TEXT');
  ensureColumn(db, 'users', 'email_verified_at', 'TEXT');
  ensureColumn(db, 'users', 'password_changed_at', 'TEXT');
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_normalized
      ON users(email_normalized)
      WHERE email_normalized IS NOT NULL AND email_normalized <> '';

    CREATE TABLE IF NOT EXISTS installation_activation (
      installation_id TEXT PRIMARY KEY,
      account_email TEXT NOT NULL,
      license_id TEXT NOT NULL,
      activated_at TEXT NOT NULL,
      activation_source TEXT NOT NULL,
      metadata_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_installation_activation_license ON installation_activation(license_id);
  `);
  ensureColumn(db, 'installation_activation', 'owner_user_id', 'TEXT REFERENCES users(id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_installation_activation_owner ON installation_activation(owner_user_id)');
}

function migrationApplied(db) {
  return Boolean(db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(ACCOUNT_IDENTITY_SCHEMA_VERSION));
}

function schemaPresent(db) {
  const columns = tableColumns(db, 'users');
  const required = ['email', 'email_normalized', 'email_verified_at', 'password_changed_at'];
  const hasColumns = required.every(name => columns.has(name));
  const activation = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='installation_activation'").get();
  const activationColumns=activation?tableColumns(db,'installation_activation'):new Set();
  return hasColumns && Boolean(activation) && activationColumns.has('owner_user_id');
}

function runAccountIdentityMigrations(db, now = () => new Date().toISOString()) {
  if (!db) throw new TypeError('Database is required.');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const applied = migrationApplied(db);
  if (applied && schemaPresent(db)) return ACCOUNT_IDENTITY_SCHEMA_VERSION;

  withTransaction(db, () => {
    applyAccountIdentityMigration(db);
    if (!applied) {
      db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
        .run(ACCOUNT_IDENTITY_SCHEMA_VERSION, ACCOUNT_IDENTITY_MIGRATION_NAME, now());
    }
  });

  return ACCOUNT_IDENTITY_SCHEMA_VERSION;
}

module.exports = {
  ACCOUNT_IDENTITY_SCHEMA_VERSION,
  ACCOUNT_IDENTITY_MIGRATION_NAME,
  runAccountIdentityMigrations
};
