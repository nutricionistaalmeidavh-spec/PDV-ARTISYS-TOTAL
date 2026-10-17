'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../js/core/database/sqlite-database');
const { runMigrations } = require('../js/core/database/migrations');
const { createBackupService } = require('../js/core/backup/backup-service');
const { applyPendingRestore } = require('../js/core/backup/pending-restore');

function fixture(retention = 30) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-backup-'));
  const dbPath = path.join(dir, 'pdv.sqlite');
  const backupDir = path.join(dir, 'backups');
  const db = openDatabase(dbPath);
  let tick = 0;
  const now = () => new Date(1788999000000 + tick++ * 1000).toISOString();
  runMigrations(db, now);
  return { dir, dbPath, backupDir, db, now, retention, close(){ try{db.close();}catch{} fs.rmSync(dir,{recursive:true,force:true}); } };
}

test('backup writes consistent SQLite snapshot, manifest, SHA-256 and validated record', () => {
  const f = fixture();
  try {
    f.db.prepare("INSERT INTO categories(id,name,active,created_at,updated_at) VALUES ('c1','Bebidas',1,?,?)").run(f.now(),f.now());
    const service = createBackupService({ db:f.db, dbPath:f.dbPath, backupDir:f.backupDir, now:f.now, appVersion:'0.4.0' });
    const backup = service.createBackup('manual');
    assert.equal(backup.reason, 'manual');
    assert.equal(backup.valid, true);
    assert.match(backup.sha256, /^[a-f0-9]{64}$/);
    assert.ok(fs.existsSync(backup.filePath));
    assert.ok(fs.existsSync(backup.manifestPath));
    const manifest = JSON.parse(fs.readFileSync(backup.manifestPath,'utf8'));
    assert.equal(manifest.sha256, backup.sha256);
    assert.equal(manifest.schemaVersion >= 3, true);
    assert.equal(service.validateBackup(backup.id).valid, true);
  } finally { f.close(); }
});

test('corrupted backup is rejected and cannot schedule restore', () => {
  const f = fixture();
  try {
    const service = createBackupService({ db:f.db, dbPath:f.dbPath, backupDir:f.backupDir, now:f.now });
    const backup = service.createBackup('manual');
    fs.appendFileSync(backup.filePath, Buffer.from('corruption'));
    const validation = service.validateBackup(backup.id);
    assert.equal(validation.valid, false);
    assert.match(validation.errors.join(' '), /checksum|sha/i);
    assert.throws(() => service.prepareRestore(backup.id,{actor:{userId:'admin1',profileId:'profile-administrator'}}), /invalido|integridade|checksum/i);
  } finally { f.close(); }
});

test('retention prunes oldest backups without touching the newest valid snapshots', () => {
  const f = fixture(2);
  try {
    const service = createBackupService({ db:f.db, dbPath:f.dbPath, backupDir:f.backupDir, now:f.now, retention:2 });
    service.createBackup('one'); service.createBackup('two'); service.createBackup('three');
    const backups = service.listBackups();
    assert.equal(backups.length, 2);
    assert.deepEqual(backups.map(b=>b.reason), ['three','two']);
  } finally { f.close(); }
});

test('restore is prepared first and applied atomically only on next startup', () => {
  const f = fixture();
  try {
    f.db.prepare("INSERT INTO categories(id,name,active,created_at,updated_at) VALUES ('before','Antes',1,?,?)").run(f.now(),f.now());
    const service = createBackupService({ db:f.db, dbPath:f.dbPath, backupDir:f.backupDir, now:f.now });
    const backup = service.createBackup('baseline');
    f.db.prepare("INSERT INTO categories(id,name,active,created_at,updated_at) VALUES ('after','Depois',1,?,?)").run(f.now(),f.now());
    const prepared = service.prepareRestore(backup.id,{actor:{userId:'admin1',profileId:'profile-administrator'}});
    assert.equal(prepared.pending, true);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM categories WHERE id='after'").get().n, 1);
    f.db.close();
    const result = applyPendingRestore({ dbPath:f.dbPath, backupDir:f.backupDir });
    assert.equal(result.applied, true);
    const restored = openDatabase(f.dbPath);
    try {
      assert.equal(restored.prepare("SELECT COUNT(*) AS n FROM categories WHERE id='before'").get().n, 1);
      assert.equal(restored.prepare("SELECT COUNT(*) AS n FROM categories WHERE id='after'").get().n, 0);
      assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    } finally { restored.close(); }
  } finally { fs.rmSync(f.dir,{recursive:true,force:true}); }
});
