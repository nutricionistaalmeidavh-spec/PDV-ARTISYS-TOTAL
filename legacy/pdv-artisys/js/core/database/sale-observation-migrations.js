'use strict';

const { withTransaction } = require('./sqlite-database');

const SALE_OBSERVATION_SCHEMA_VERSION = 10;
const SALE_OBSERVATION_MIGRATION_NAME = 'pdv_sale_observation_1_3_2';

function runSaleObservationMigrations(db, now = () => new Date().toISOString()) {
  if (!db) throw new TypeError('Database is required.');
  const current = Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get()?.version || 0);
  if (current >= SALE_OBSERVATION_SCHEMA_VERSION) return current;
  if (current < 9) throw new Error('Observacao de venda requer schema v9 antes da migracao v10.');

  withTransaction(db, () => {
    const columns = new Set(db.prepare('PRAGMA table_info(sales)').all().map(column => column.name));
    if (!columns.has('observation')) db.exec('ALTER TABLE sales ADD COLUMN observation TEXT');
    if (!columns.has('print_observation')) db.exec('ALTER TABLE sales ADD COLUMN print_observation INTEGER NOT NULL DEFAULT 0 CHECK (print_observation IN (0,1))');
    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(SALE_OBSERVATION_SCHEMA_VERSION, SALE_OBSERVATION_MIGRATION_NAME, now());
  });
  return SALE_OBSERVATION_SCHEMA_VERSION;
}

module.exports = {
  SALE_OBSERVATION_SCHEMA_VERSION,
  SALE_OBSERVATION_MIGRATION_NAME,
  runSaleObservationMigrations
};
