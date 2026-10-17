'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {archiveInstallation}=require('../desktop/installation-lifecycle.cjs');

test('new-store archive and safety backup reopen with original records while new database is empty',t=>{
 const userData=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-archive-integration-'));
 t.after(()=>fs.rmSync(userData,{recursive:true,force:true}));
 const dbPath=path.join(userData,'pdv-artisys.sqlite');const backupDir=path.join(userData,'backups');
 const runtime=createPdvRuntime({dbPath,backupDir});
 let closed=false;t.after(()=>{if(!closed)runtime.close();});
 runtime.catalog.createUser({id:'original-admin',username:'original',name:'Administrador original',profileId:'profile-administrator',password:'Original-Password-123!',active:true});
 runtime.db.exec('CREATE TABLE archive_probe(id TEXT PRIMARY KEY,value TEXT NOT NULL)');
 runtime.db.prepare('INSERT INTO archive_probe VALUES(?,?)').run('sale-original','Preserve original business data');
 fs.writeFileSync(path.join(userData,'data-server.json'),JSON.stringify({mode:'lan-host',selected:true,port:4312}));
 fs.writeFileSync(path.join(userData,'hardware.json'),'{"scale":{"port":"COM1"}}');
 const backup=runtime.backups.createBackup('pre-new-installation',{prune:false});assert.equal(backup.valid,true);
 runtime.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');runtime.close();closed=true;
 const archive=archiveInstallation({userData,confirmation:'NOVA LOJA',backup});
 assert.equal(fs.existsSync(dbPath),false);assert.equal(fs.existsSync(path.join(userData,'data-server.json')),false);
 for(const file of [path.join(archive.archivePath,'pdv-artisys.sqlite'),backup.filePath]){
  const restored=openDatabase(file);try{
   assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
   assert.equal(restored.prepare('SELECT value FROM archive_probe').get().value,'Preserve original business data');
   assert.equal(restored.prepare('SELECT username FROM users').get().username,'original');
  }finally{restored.close();}
 }
 assert.equal(JSON.parse(fs.readFileSync(path.join(archive.archivePath,'data-server.json'),'utf8')).port,4312);
 assert.equal(fs.existsSync(path.join(userData,'hardware.json')),true);
 const fresh=createPdvRuntime({dbPath,backupDir});try{assert.equal(fresh.catalog.countUsers(),0);assert.equal(fresh.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='archive_probe'").get().n,0);}finally{fresh.close();}
 assert.equal(fs.existsSync(backup.filePath),true);
});
