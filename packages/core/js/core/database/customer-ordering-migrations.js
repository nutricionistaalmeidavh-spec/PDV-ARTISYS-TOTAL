'use strict';

const {withTransaction}=require('./sqlite-database');

const CUSTOMER_ORDERING_SCHEMA_VERSION=32;
const CUSTOMER_ORDERING_MIGRATION_NAME='pdv_public_table_ordering_v32';

function tableExists(db,name){
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(String(name)));
}

function tableSql(db,name){
  return String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(String(name))?.sql||'');
}

function columns(db,name){
  return new Set(db.prepare(`PRAGMA table_info(${name})`).all().map(row=>row.name));
}

function legacyDeviceIds(db){
  if(!tableExists(db,'mobile_devices'))return[];
  const ids=new Set(
    db.prepare("SELECT id FROM mobile_devices WHERE device_type IN('TABLET','SELF_SERVICE')").all().map(row=>String(row.id))
  );
  if(tableExists(db,'self_service_profiles')){
    for(const row of db.prepare('SELECT device_id FROM self_service_profiles').all())ids.add(String(row.device_id));
  }
  return[...ids];
}

function deleteLegacyDeviceState(db,ids){
  if(!ids.length)return;
  if(tableExists(db,'mobile_device_kitchen_stations')){
    const removeStation=db.prepare('DELETE FROM mobile_device_kitchen_stations WHERE device_id=?');
    for(const id of ids)removeStation.run(id);
  }
  if(tableExists(db,'self_service_profiles')){
    const removeProfile=db.prepare('DELETE FROM self_service_profiles WHERE device_id=?');
    for(const id of ids)removeProfile.run(id);
  }
  const removeDevice=db.prepare('DELETE FROM mobile_devices WHERE id=?');
  for(const id of ids)removeDevice.run(id);
}

function rebuildMobileDevices(db,retiredIds){
  if(!tableExists(db,'mobile_devices'))return;
  const sql=tableSql(db,'mobile_devices');
  const canonical=!/TABLET|SELF_SERVICE/.test(sql);
  if(canonical&&!retiredIds.length)return;

  const currentColumns=columns(db,'mobile_devices');
  const surface=currentColumns.has('surface')
    ?'surface'
    :"CASE WHEN device_type='WAITER' THEN 'waiter' WHEN device_type='KITCHEN' THEN 'kitchen' ELSE lower(device_type) END";
  const scopeType=currentColumns.has('scope_type')?'scope_type':"'establishment'";
  const scopeId=currentColumns.has('scope_id')?'scope_id':'NULL';

  db.exec(`
    CREATE TABLE mobile_devices_v32 (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      device_type TEXT NOT NULL CHECK(device_type IN('WAITER','KITCHEN')),
      table_id TEXT,
      user_id TEXT,
      credential_hash TEXT NOT NULL,
      credential_salt TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN('ACTIVE','BLOCKED')),
      last_seen_at TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      surface TEXT,
      scope_type TEXT,
      scope_id TEXT,
      FOREIGN KEY(table_id) REFERENCES restaurant_tables(id),
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(created_by) REFERENCES users(id)
    );

    INSERT INTO mobile_devices_v32(
      id,name,device_type,table_id,user_id,credential_hash,credential_salt,status,last_seen_at,
      created_by,created_at,updated_at,surface,scope_type,scope_id
    )
    SELECT
      id,name,device_type,NULL,user_id,credential_hash,credential_salt,status,last_seen_at,
      created_by,created_at,updated_at,${surface},${scopeType},${scopeId}
    FROM mobile_devices
    WHERE device_type IN('WAITER','KITCHEN');

    DROP TABLE mobile_devices;
    ALTER TABLE mobile_devices_v32 RENAME TO mobile_devices;

    CREATE INDEX idx_mobile_devices_status_type ON mobile_devices(status,device_type,name);
    CREATE INDEX idx_mobile_devices_surface_status ON mobile_devices(surface,status,name);
    CREATE INDEX idx_mobile_devices_scope ON mobile_devices(scope_type,scope_id,status);
  `);
}

function rebuildRestaurantOrders(db){
  if(!tableExists(db,'restaurant_orders'))return;
  const sql=tableSql(db,'restaurant_orders');
  if(!/TABLET/.test(sql)&&/['"]TABLE['"]/.test(sql))return;

  db.exec(`
    CREATE TABLE restaurant_orders_v32 (
      id TEXT PRIMARY KEY,
      table_session_id TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN('DESKTOP','WAITER','TABLE')),
      device_id TEXT,
      created_by TEXT,
      status TEXT NOT NULL CHECK(status IN('NEW','PREPARING','READY','SERVED','CANCELLED')),
      note TEXT,
      total_cents INTEGER NOT NULL DEFAULT 0 CHECK(total_cents >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(table_session_id) REFERENCES table_sessions(id),
      FOREIGN KEY(created_by) REFERENCES users(id)
    );

    INSERT INTO restaurant_orders_v32(
      id,table_session_id,source,device_id,created_by,status,note,total_cents,created_at,updated_at
    )
    SELECT
      id,table_session_id,
      CASE source WHEN 'TABLET' THEN 'TABLE' ELSE source END,
      device_id,created_by,status,note,total_cents,created_at,updated_at
    FROM restaurant_orders;

    DROP TABLE restaurant_orders;
    ALTER TABLE restaurant_orders_v32 RENAME TO restaurant_orders;

    CREATE INDEX idx_restaurant_orders_session ON restaurant_orders(table_session_id,created_at);
    CREATE INDEX idx_restaurant_orders_status ON restaurant_orders(status,created_at);
  `);
}

function runCustomerOrderingMigrations(db,now=()=>new Date().toISOString()){
  if(!db)throw new TypeError('Database is required.');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const applied=Boolean(db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(CUSTOMER_ORDERING_SCHEMA_VERSION));
  const ordersCanonical=!tableExists(db,'restaurant_orders')||(!/TABLET/.test(tableSql(db,'restaurant_orders'))&&/['"]TABLE['"]/.test(tableSql(db,'restaurant_orders')));
  const devicesCanonical=!tableExists(db,'mobile_devices')||!/TABLET|SELF_SERVICE/.test(tableSql(db,'mobile_devices'));
  const profilesGone=!tableExists(db,'self_service_profiles');
  if(applied&&ordersCanonical&&devicesCanonical&&profilesGone)return CUSTOMER_ORDERING_SCHEMA_VERSION;

  const foreignKeys=Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys||0);
  if(foreignKeys)db.exec('PRAGMA foreign_keys=OFF');
  try{
    withTransaction(db,()=>{
      const retiredIds=legacyDeviceIds(db);
      deleteLegacyDeviceState(db,retiredIds);
      if(tableExists(db,'self_service_profiles'))db.exec('DROP TABLE self_service_profiles');
      rebuildMobileDevices(db,retiredIds);
      rebuildRestaurantOrders(db);

      const violations=db.prepare('PRAGMA foreign_key_check').all();
      if(violations.length)throw new Error(`Migração v32 violou ${violations.length} vínculo(s) de chave estrangeira.`);

      if(!applied){
        db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
          .run(CUSTOMER_ORDERING_SCHEMA_VERSION,CUSTOMER_ORDERING_MIGRATION_NAME,now());
      }
    });
  }finally{
    if(foreignKeys)db.exec('PRAGMA foreign_keys=ON');
  }

  return CUSTOMER_ORDERING_SCHEMA_VERSION;
}

module.exports={
  CUSTOMER_ORDERING_SCHEMA_VERSION,
  CUSTOMER_ORDERING_MIGRATION_NAME,
  runCustomerOrderingMigrations
};
