import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {openLocalDatabase} from '../src/local-db.mjs';
import {applyLocalMigrations} from '../src/local-migrations.mjs';

test('selfhost canonical migrations run once; restart neither repeats ALTERs nor loses rows',async()=>{
  const db=openLocalDatabase();
  try{
    const first=await applyLocalMigrations(db);
    assert.equal(first.applied,18);
    assert.equal(first.total,18);
    await db.prepare("INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)").bind('a','site-a','First shop',new Date().toISOString()).run();
    const second=await applyLocalMigrations(db);
    assert.deepEqual(second,{applied:0,total:18});
    const row=await db.prepare('SELECT name FROM tenants WHERE id=?').bind('a').first();
    assert.equal(row.name,'First shop');
  }finally{db.close();}
});

test('migrations stop before touching a legacy untracked database',async()=>{
  const db=openLocalDatabase();
  try{
    db.exec("CREATE TABLE preexisting_customer_data(id TEXT PRIMARY KEY); INSERT INTO preexisting_customer_data VALUES ('one');");
    await assert.rejects(applyLocalMigrations(db),/migração assistida obrigatória/);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM preexisting_customer_data').bind().first()).n,1);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='schema_migrations'").bind().first()).n,0);
  }finally{db.close();}
});

test('checksum tampering and failed migration roll back atomically',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'pdv-migration-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const one=join(folder,'0001_first.sql'),two=join(folder,'0002_second.sql');
  await writeFile(one,'CREATE TABLE test_only(id TEXT PRIMARY KEY);');
  await writeFile(two,'ALTER TABLE test_only ADD COLUMN note TEXT;');
  const db=openLocalDatabase();
  try{
    assert.deepEqual(await applyLocalMigrations(db,{directory:folder}),{total:2,applied:2});
    await writeFile(one,'CREATE TABLE test_only(id TEXT PRIMARY KEY, malicious TEXT);');
    await assert.rejects(applyLocalMigrations(db,{directory:folder}),/Migração canônica foi alterada/);
    await writeFile(one,'CREATE TABLE test_only(id TEXT PRIMARY KEY);');
    await writeFile(join(folder,'0003_invalid.sql'),'CREATE TABLE orphaned(id TEXT);\nTHIS IS INVALID;');
    await assert.rejects(applyLocalMigrations(db,{directory:folder}));
    const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").bind().all()).results.map(x=>x.name);
    assert.equal(tables.includes('orphaned'),false);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').bind().first()).n,2);
  }finally{db.close();}
});
