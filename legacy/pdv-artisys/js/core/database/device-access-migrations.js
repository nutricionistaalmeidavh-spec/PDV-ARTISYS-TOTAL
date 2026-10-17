'use strict';

const {withTransaction}=require('./sqlite-database');

const DEVICE_ACCESS_SCHEMA_VERSION=26;
const DEVICE_ACCESS_MIGRATION_NAME='pdv_device_access_v26';

function columns(db,table){
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name));
}

function ensureColumn(db,table,column,definition){
  if(columns(db,table).has(column))return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function applyDeviceAccessMigration(db){
  ensureColumn(db,'mobile_devices','surface','TEXT');
  ensureColumn(db,'mobile_devices','scope_type','TEXT');
  ensureColumn(db,'mobile_devices','scope_id','TEXT');

  db.exec(`
    UPDATE mobile_devices
    SET surface=CASE
      WHEN device_type='WAITER' THEN 'waiter'
      WHEN device_type='KITCHEN' THEN 'kitchen'
      ELSE lower(device_type)
    END
    WHERE surface IS NULL OR surface='';

    UPDATE mobile_devices
    SET scope_type='establishment',scope_id=NULL
    WHERE device_type IN('WAITER','KITCHEN') AND scope_type IS NULL;



    CREATE INDEX IF NOT EXISTS idx_mobile_devices_surface_status ON mobile_devices(surface,status,name);
    CREATE INDEX IF NOT EXISTS idx_mobile_devices_scope ON mobile_devices(scope_type,scope_id,status);
  `);
}

function runDeviceAccessMigrations(db,now=()=>new Date().toISOString()){
  if(!db)throw new TypeError('Database is required.');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied=Boolean(db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(DEVICE_ACCESS_SCHEMA_VERSION));
  const present=['surface','scope_type','scope_id'].every(name=>columns(db,'mobile_devices').has(name));
  if(applied&&present)return DEVICE_ACCESS_SCHEMA_VERSION;
  withTransaction(db,()=>{
    applyDeviceAccessMigration(db);
    if(!applied)db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(DEVICE_ACCESS_SCHEMA_VERSION,DEVICE_ACCESS_MIGRATION_NAME,now());
  });
  return DEVICE_ACCESS_SCHEMA_VERSION;
}

module.exports={
  DEVICE_ACCESS_SCHEMA_VERSION,
  DEVICE_ACCESS_MIGRATION_NAME,
  runDeviceAccessMigrations
};
