'use strict';

const {withTransaction}=require('./sqlite-database');
const {DEFAULT_PROFILES}=require('../auth/default-profiles');

const ACCESS_PROFILE_SCHEMA_VERSION=25;
const ACCESS_PROFILE_MIGRATION_NAME='pdv_access_profiles_v25';

function columns(db,table){
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name));
}

function ensureColumn(db,table,column,definition){
  if(columns(db,table).has(column))return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function applyAccessProfileMigration(db,now){
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      system_key TEXT UNIQUE,
      protected INTEGER NOT NULL DEFAULT 0 CHECK(protected IN(0,1)),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profile_permissions (
      profile_id TEXT NOT NULL,
      permission_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(profile_id,permission_id),
      FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_profile_permissions_permission ON profile_permissions(permission_id,profile_id);
  `);
  ensureColumn(db,'users','profile_id','TEXT REFERENCES profiles(id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_profile ON users(profile_id,active,name)');

  const insertProfile=db.prepare(`INSERT OR IGNORE INTO profiles(id,name,slug,system_key,protected,active,created_at,updated_at)
    VALUES(?,?,?,?,?,1,?,?)`);
  const insertPermission=db.prepare('INSERT OR IGNORE INTO profile_permissions(profile_id,permission_id,created_at) VALUES(?,?,?)');
  const timestamp=now();
  for(const profile of DEFAULT_PROFILES){
    insertProfile.run(profile.id,profile.name,profile.slug,profile.systemKey,profile.protected?1:0,timestamp,timestamp);
    for(const permission of profile.permissions)insertPermission.run(profile.id,permission,timestamp);
  }

}

function runAccessProfileMigrations(db,now=()=>new Date().toISOString()){
  if(!db)throw new TypeError('Database is required.');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied=Boolean(db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(ACCESS_PROFILE_SCHEMA_VERSION));
  const present=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='profiles'").get())
    && columns(db,'users').has('profile_id');
  if(applied&&present)return ACCESS_PROFILE_SCHEMA_VERSION;
  withTransaction(db,()=>{
    applyAccessProfileMigration(db,now);
    if(!applied)db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(ACCESS_PROFILE_SCHEMA_VERSION,ACCESS_PROFILE_MIGRATION_NAME,now());
  });
  return ACCESS_PROFILE_SCHEMA_VERSION;
}

module.exports={
  ACCESS_PROFILE_SCHEMA_VERSION,
  ACCESS_PROFILE_MIGRATION_NAME,
  runAccessProfileMigrations
};
