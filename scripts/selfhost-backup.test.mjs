import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBackup,stageRestore,verifyBackup} from './selfhost-backup.mjs';

async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'pdv-backup-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const dbPath=join(dir,'live.sqlite'),backupPath=join(dir,'snapshot.sqlite');
  const db=new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;"+
    "CREATE TABLE tenants(id TEXT PRIMARY KEY, name TEXT);"+
    "CREATE TABLE users(id TEXT PRIMARY KEY, name TEXT);"+
    "CREATE TABLE tenant_memberships(tenant_id TEXT REFERENCES tenants(id), user_id TEXT REFERENCES users(id));"+
    "CREATE TABLE auth_sessions(id TEXT PRIMARY KEY);"+
    "INSERT INTO tenants VALUES ('one','Original');"+
    "INSERT INTO users VALUES ('person','Operator');"+
    "INSERT INTO tenant_memberships VALUES ('one','person');");
  db.close();
  return {dir,dbPath,backupPath};
}
test('cap-051 WAL-aware backup stays consistent and restore never overwrites',async t=>{
  const {dir,dbPath,backupPath}=await fixture(t);
  const created=await createBackup(dbPath,backupPath);
  assert.equal(created.manifest.format,'pdv-total-sqlite-backup-v1');
  assert.match(created.manifest.sha256,/^[a-f0-9]{64}$/);
  assert.equal((await verifyBackup(backupPath)).manifest.sha256,created.manifest.sha256);
  const active=new DatabaseSync(dbPath);
  active.exec("UPDATE tenants SET name='Altered' WHERE id='one'");active.close();
  const restored=join(dir,'restored.sqlite');
  await stageRestore(backupPath,restored);
  const db=new DatabaseSync(restored,{readOnly:true});
  assert.equal(db.prepare('SELECT name FROM tenants').get().name,'Original');
  db.close();
  await assert.rejects(stageRestore(backupPath,restored),/Destino ocupado/);
  await assert.rejects(createBackup(dbPath,backupPath),/Backup já existe/);
});
test('backup SHA tampering blocks restore before writing a file',async t=>{
  const {dir,dbPath,backupPath}=await fixture(t);
  await createBackup(dbPath,backupPath);
  const bytes=await readFile(backupPath);bytes[bytes.length-1]^=255;
  await writeFile(backupPath,bytes);
  const target=join(dir,'restored.sqlite');
  await assert.rejects(stageRestore(backupPath,target),/Checksum SHA-256/);
  await assert.rejects(readFile(target),/ENOENT/);
});
test('rejects a SQLite database without canonical identity tables',async t=>{
  const {dir}=await fixture(t);
  const source=join(dir,'unrelated.sqlite'),target=join(dir,'invalid.sqlite');
  const db=new DatabaseSync(source);db.exec('CREATE TABLE nonsense(x)');db.close();
  await assert.rejects(createBackup(source,target),/Tabela canônica ausente/);
  await assert.rejects(readFile(target),/ENOENT/);
});
