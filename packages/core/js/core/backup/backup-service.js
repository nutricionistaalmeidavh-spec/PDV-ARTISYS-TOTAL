'use strict';
const {principalFromActor}=require('../auth/principal-resolver');

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { DatabaseSync } = require('../database/sqlite-runtime');

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function quoteSqlString(value) { return `'${String(value).replace(/'/g, "''")}'`; }

function inspectSqlite(filePath) {
  const errors = [];
  if (!fs.existsSync(filePath)) return { valid:false, errors:['Arquivo de backup ausente.'], schemaVersion:0 };
  let db;
  try {
    db = new DatabaseSync(filePath);
    const integrity = db.prepare('PRAGMA integrity_check').get();
    const value = integrity?.integrity_check || Object.values(integrity || {})[0];
    if (value !== 'ok') errors.push(`Falha de integridade SQLite: ${value || 'desconhecida'}.`);
    const schemaVersion = Number(db.prepare("SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations").get()?.version || 0);
    return { valid: errors.length === 0, errors, schemaVersion };
  } catch (error) {
    return { valid:false, errors:[`Falha de integridade SQLite: ${error.message}`], schemaVersion:0 };
  } finally { try { db?.close(); } catch {} }
}

function ensureBackupTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS backup_records (
    id TEXT PRIMARY KEY,
    file_path TEXT NOT NULL,
    manifest_path TEXT NOT NULL,
    reason TEXT NOT NULL,
    app_version TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    valid INTEGER NOT NULL DEFAULT 0 CHECK (valid IN (0,1)),
    created_at TEXT NOT NULL,
    validated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_backup_records_created ON backup_records(created_at);`);
}

function mapRecord(row) {
  if (!row) return null;
  return { id:row.id,filePath:row.file_path,manifestPath:row.manifest_path,reason:row.reason,appVersion:row.app_version,schemaVersion:row.schema_version,sha256:row.sha256,size:row.size_bytes,valid:Boolean(row.valid),createdAt:row.created_at,validatedAt:row.validated_at };
}

function createBackupService({ db, dbPath, backupDir, authorization=null, now=()=>new Date().toISOString(), appVersion='0.0.0', retention=30 } = {}) {
  if (!db || !dbPath || dbPath === ':memory:' || !backupDir) throw new TypeError('Database file and backup directory are required.');
  ensureBackupTable(db);
  fs.mkdirSync(backupDir,{recursive:true});
  const safeRetention = Math.max(1, Math.min(Number(retention)||30, 365));

  function listBackups() {
    return db.prepare('SELECT * FROM backup_records ORDER BY created_at DESC,id DESC').all().map(mapRecord);
  }

  function validateBackup(id) {
    const record = mapRecord(db.prepare('SELECT * FROM backup_records WHERE id=?').get(String(id)));
    if (!record) return { id:String(id),valid:false,errors:['Backup nao encontrado.'] };
    const errors = [];
    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(record.manifestPath,'utf8')); }
    catch (error) { errors.push(`Manifesto invalido: ${error.message}`); }
    if (!fs.existsSync(record.filePath)) errors.push('Arquivo de backup ausente.');
    let actualSha = null;
    if (fs.existsSync(record.filePath)) {
      actualSha = sha256File(record.filePath);
      if (actualSha !== record.sha256 || (manifest?.sha256 && actualSha !== manifest.sha256)) errors.push('Checksum SHA-256 do backup diverge do manifesto.');
    }
    const sqlite = fs.existsSync(record.filePath) ? inspectSqlite(record.filePath) : {valid:false,errors:[],schemaVersion:0};
    errors.push(...sqlite.errors);
    if (manifest && Number(manifest.schemaVersion) !== sqlite.schemaVersion) errors.push('Schema do manifesto diverge do arquivo SQLite.');
    const valid = errors.length === 0;
    const validatedAt = now();
    db.prepare('UPDATE backup_records SET valid=?,validated_at=? WHERE id=?').run(valid?1:0,validatedAt,record.id);
    return { ...record, valid, validatedAt, actualSha256:actualSha, errors, schemaVersion:sqlite.schemaVersion || record.schemaVersion };
  }

  function removeRecord(record) {
    for (const file of [record.filePath,record.manifestPath]) { try { if(fs.existsSync(file))fs.unlinkSync(file); } catch {} }
    db.prepare('DELETE FROM backup_records WHERE id=?').run(record.id);
  }

  function pruneBackups({ preserveIds=[] }={}) {
    const preserve = new Set(preserveIds.map(String));
    const rows = listBackups();
    let kept = 0;
    for (const record of rows) {
      if (preserve.has(record.id)) continue;
      kept += 1;
      if (kept > safeRetention) removeRecord(record);
    }
    return listBackups();
  }

  function createBackup(reason='manual', options={}) {
    const createdAt = now();
    const stamp = createdAt.replace(/[^0-9A-Za-z]+/g,'-').replace(/^-|-$/g,'');
    const id = `backup-${stamp}-${randomBytes(4).toString('hex')}`;
    const filePath = path.join(backupDir,`${id}.sqlite`);
    const manifestPath = path.join(backupDir,`${id}.manifest.json`);
    try { db.exec('PRAGMA wal_checkpoint(FULL)'); } catch {}
    db.exec(`VACUUM INTO ${quoteSqlString(filePath)}`);
    const inspected = inspectSqlite(filePath);
    if (!inspected.valid) { try{fs.unlinkSync(filePath);}catch{} throw new Error(`Backup SQLite invalido: ${inspected.errors.join(' ')}`); }
    const sha256 = sha256File(filePath);
    const size = fs.statSync(filePath).size;
    const manifest = { id,appVersion:String(appVersion),schemaVersion:inspected.schemaVersion,createdAt,reason:String(reason||'manual'),sha256,size };
    fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2),'utf8');
    db.prepare(`INSERT INTO backup_records
      (id,file_path,manifest_path,reason,app_version,schema_version,sha256,size_bytes,valid,created_at,validated_at)
      VALUES (?,?,?,?,?,?,?,?,1,?,?)`).run(id,filePath,manifestPath,manifest.reason,manifest.appVersion,manifest.schemaVersion,sha256,size,createdAt,createdAt);
    if (options.prune !== false) pruneBackups();
    return mapRecord(db.prepare('SELECT * FROM backup_records WHERE id=?').get(id));
  }

  function prepareRestore(id,{actor={}}={}) {
    if(authorization)authorization.require({principal:principalFromActor(actor),capability:'settings.manage'});
    const validation = validateBackup(id);
    if (!validation.valid) throw new Error(`Backup invalido para restore: ${validation.errors.join(' ')}`);
    const safety = createBackup('pre-restore',{prune:false});
    const marker = {
      version:1,
      backupId:validation.id,
      backupPath:validation.filePath,
      manifestPath:validation.manifestPath,
      sha256:validation.sha256,
      schemaVersion:validation.schemaVersion,
      requestedAt:now(),
      requestedBy:actor.userId||null,
      safetyBackupId:safety.id
    };
    const markerPath = path.join(backupDir,'pending-restore.json');
    fs.writeFileSync(`${markerPath}.tmp`,JSON.stringify(marker,null,2),'utf8');
    fs.renameSync(`${markerPath}.tmp`,markerPath);
    pruneBackups({preserveIds:[validation.id,safety.id]});
    return { pending:true,markerPath,backupId:validation.id,safetyBackupId:safety.id };
  }

  function getBackupStatus() {
    const backups=listBackups();
    const markerPath=path.join(backupDir,'pending-restore.json');
    return { count:backups.length,latest:backups[0]||null,pendingRestore:fs.existsSync(markerPath),retention:safeRetention };
  }

  return { createBackup,listBackups,validateBackup,prepareRestore,pruneBackups,getBackupStatus };
}

module.exports = { createBackupService, inspectSqlite, sha256File, ensureBackupTable };
