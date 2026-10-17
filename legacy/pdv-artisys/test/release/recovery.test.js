'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../../js/core/pdv-runtime');
const {applyPendingRestore}=require('../../js/core/backup/pending-restore');

test('release gate: validated backup restores atomically and records safety backup',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-release-recovery-'));const dbPath=path.join(dir,'pdv.sqlite');
 try{
   let runtime=createPdvRuntime({dbPath,appVersion:'release-test'});runtime.catalog.createUser({id:'admin',username:'admin',name:'Administrador',profileId:'profile-administrator',password:'Release-Recovery-123!'});runtime.settings.set('store.name','Antes',{actor:{userId:'admin',profileId:'profile-administrator'}});const backup=runtime.backups.createBackup('release-gate');runtime.settings.set('store.name','Depois',{actor:{userId:'admin',profileId:'profile-administrator'}});const prepared=runtime.backups.prepareRestore(backup.id,{actor:{userId:'admin',profileId:'profile-administrator'}});assert.ok(prepared.safetyBackupId);runtime.close();
   const applied=applyPendingRestore({dbPath,backupDir:path.join(dir,'backups')});assert.equal(applied.applied,true);assert.equal(applied.safetyBackupId,prepared.safetyBackupId);
   runtime=createPdvRuntime({dbPath});assert.equal(runtime.settings.get('store.name',{defaultValue:null}),'Antes');assert.equal(runtime.db.prepare('PRAGMA quick_check').get().quick_check,'ok');runtime.close();
 }finally{try{fs.rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});}catch{/* limpeza best-effort: o gate valida restore, não timing de unlock do Windows */}}
});
