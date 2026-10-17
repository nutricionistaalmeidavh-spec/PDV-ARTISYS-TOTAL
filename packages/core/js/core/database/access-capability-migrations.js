'use strict';

const {withTransaction}=require('./sqlite-database');
const {DEFAULT_PROFILE_IDS}=require('../auth/default-profiles');

const ACCESS_CAPABILITY_SCHEMA_VERSION=27;
const ACCESS_CAPABILITY_MIGRATION_NAME='pdv_access_capability_returns_approval_v27';

function runAccessCapabilityMigrations(db,now=()=>new Date().toISOString()){
  if(!db)throw new TypeError('Database is required.');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  if(db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(ACCESS_CAPABILITY_SCHEMA_VERSION))return ACCESS_CAPABILITY_SCHEMA_VERSION;
  const hasProfiles=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='profiles'").get());
  const hasPermissions=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='profile_permissions'").get());
  if(!hasProfiles||!hasPermissions)throw new Error('Migracao de capabilities requer perfis de acesso v25.');

  withTransaction(db,()=>{
    const timestamp=now();
    const insert=db.prepare('INSERT OR IGNORE INTO profile_permissions(profile_id,permission_id,created_at) VALUES(?,?,?)');
    insert.run(DEFAULT_PROFILE_IDS.ADMINISTRATOR,'returns.approve',timestamp);
    insert.run(DEFAULT_PROFILE_IDS.MANAGER,'returns.approve',timestamp);
    insert.run(DEFAULT_PROFILE_IDS.OPERATOR,'returns.manage',timestamp);
    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(ACCESS_CAPABILITY_SCHEMA_VERSION,ACCESS_CAPABILITY_MIGRATION_NAME,timestamp);
  });
  return ACCESS_CAPABILITY_SCHEMA_VERSION;
}

module.exports={
  ACCESS_CAPABILITY_SCHEMA_VERSION,
  ACCESS_CAPABILITY_MIGRATION_NAME,
  runAccessCapabilityMigrations
};
