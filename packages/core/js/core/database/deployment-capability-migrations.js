'use strict';

const {withTransaction}=require('./sqlite-database');
const {DEFAULT_PROFILE_IDS}=require('../auth/default-profiles');

const DEPLOYMENT_CAPABILITY_SCHEMA_VERSION=29;
const DEPLOYMENT_CAPABILITY_MIGRATION_NAME='pdv_deployment_capability_v29';

function runDeploymentCapabilityMigrations(db,now=()=>new Date().toISOString()){
  if(!db)throw new TypeError('Database is required.');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  if(db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(DEPLOYMENT_CAPABILITY_SCHEMA_VERSION))return DEPLOYMENT_CAPABILITY_SCHEMA_VERSION;
  const hasProfiles=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='profiles'").get());
  const hasPermissions=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='profile_permissions'").get());
  if(!hasProfiles||!hasPermissions)throw new Error('Migração de implantação requer perfis de acesso v25.');

  withTransaction(db,()=>{
    const timestamp=now();
    db.prepare('INSERT OR IGNORE INTO profile_permissions(profile_id,permission_id,created_at) VALUES(?,?,?)')
      .run(DEFAULT_PROFILE_IDS.ADMINISTRATOR,'deployment.manage',timestamp);
    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(DEPLOYMENT_CAPABILITY_SCHEMA_VERSION,DEPLOYMENT_CAPABILITY_MIGRATION_NAME,timestamp);
  });
  return DEPLOYMENT_CAPABILITY_SCHEMA_VERSION;
}

module.exports={
  DEPLOYMENT_CAPABILITY_SCHEMA_VERSION,
  DEPLOYMENT_CAPABILITY_MIGRATION_NAME,
  runDeploymentCapabilityMigrations
};
