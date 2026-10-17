'use strict';

const {withTransaction}=require('./sqlite-database');

const PIZZERIA_CANONICAL_SCHEMA_VERSION=33;
const PIZZERIA_CANONICAL_MIGRATION_NAME='pdv_pizzeria_canonical_composer_v33';

function columns(db,table){
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name));
}

function runPizzeriaCanonicalMigrations(db,now=()=>new Date().toISOString()){
  if(!db)throw new TypeError('Database is required.');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const current=Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get()?.version||0);
  if(current<32)throw new Error('Compositor canonico de pizzaria requer schema v32 antes da migracao v33.');

  const applied=Boolean(db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(PIZZERIA_CANONICAL_SCHEMA_VERSION));
  const sizeColumns=columns(db,'pizza_sizes');
  const flavorColumns=columns(db,'pizza_flavors');
  const crustColumns=columns(db,'pizza_crusts');
  const complete=sizeColumns.has('consumption_multiplier')&&flavorColumns.has('recipe_product_id')&&crustColumns.has('recipe_product_id');
  if(applied&&complete)return PIZZERIA_CANONICAL_SCHEMA_VERSION;

  withTransaction(db,()=>{
    if(!sizeColumns.has('consumption_multiplier')){
      db.exec('ALTER TABLE pizza_sizes ADD COLUMN consumption_multiplier REAL NOT NULL DEFAULT 1 CHECK(consumption_multiplier>0)');
    }
    if(!flavorColumns.has('recipe_product_id')){
      db.exec('ALTER TABLE pizza_flavors ADD COLUMN recipe_product_id TEXT REFERENCES products(id)');
    }
    if(!crustColumns.has('recipe_product_id')){
      db.exec('ALTER TABLE pizza_crusts ADD COLUMN recipe_product_id TEXT REFERENCES products(id)');
    }
    if(!applied){
      db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
        .run(PIZZERIA_CANONICAL_SCHEMA_VERSION,PIZZERIA_CANONICAL_MIGRATION_NAME,now());
    }
  });

  return PIZZERIA_CANONICAL_SCHEMA_VERSION;
}

module.exports={
  PIZZERIA_CANONICAL_SCHEMA_VERSION,
  PIZZERIA_CANONICAL_MIGRATION_NAME,
  runPizzeriaCanonicalMigrations
};
