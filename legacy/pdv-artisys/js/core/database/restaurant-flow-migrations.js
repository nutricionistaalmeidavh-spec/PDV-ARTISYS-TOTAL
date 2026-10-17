'use strict';

const { withTransaction } = require('./sqlite-database');

const RESTAURANT_WAITER_SCHEMA_VERSION = 20;
const RESTAURANT_WAITER_MIGRATION_NAME = 'restaurant_waiter_assignment_v20';
const RESTAURANT_FLOW_SCHEMA_VERSION = 21;
const RESTAURANT_FLOW_MIGRATION_NAME = 'restaurant_session_context_v21';

function hasColumn(db,table,column){
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row=>row.name===column);
}

function record(db,version,name,now){
  db.prepare('INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)').run(version,name,now());
}

function runRestaurantFlowMigrations(db,now=()=>new Date().toISOString()){
  if(!db)throw new TypeError('Database is required.');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  withTransaction(db,()=>{
    if(!hasColumn(db,'table_sessions','waiter_id')){
      db.exec('ALTER TABLE table_sessions ADD COLUMN waiter_id TEXT REFERENCES users(id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_table_sessions_waiter_status ON table_sessions(waiter_id,status,opened_at)');
      record(db,RESTAURANT_WAITER_SCHEMA_VERSION,RESTAURANT_WAITER_MIGRATION_NAME,now);
    }
    if(!hasColumn(db,'table_sessions','party_size')){
      db.exec('ALTER TABLE table_sessions ADD COLUMN party_size INTEGER CHECK(party_size IS NULL OR (party_size BETWEEN 1 AND 50))');
    }
    if(!hasColumn(db,'table_sessions','customer_id')){
      db.exec('ALTER TABLE table_sessions ADD COLUMN customer_id TEXT REFERENCES customers(id)');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_table_sessions_customer_status ON table_sessions(customer_id,status,opened_at)');
    record(db,RESTAURANT_FLOW_SCHEMA_VERSION,RESTAURANT_FLOW_MIGRATION_NAME,now);
  });
  return RESTAURANT_FLOW_SCHEMA_VERSION;
}

module.exports={
  RESTAURANT_WAITER_SCHEMA_VERSION,
  RESTAURANT_WAITER_MIGRATION_NAME,
  RESTAURANT_FLOW_SCHEMA_VERSION,
  RESTAURANT_FLOW_MIGRATION_NAME,
  runRestaurantFlowMigrations
};
