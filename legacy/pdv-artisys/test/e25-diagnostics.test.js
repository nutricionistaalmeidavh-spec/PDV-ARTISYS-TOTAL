'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {createSettingsService}=require('../js/core/settings/settings-service');
const {createSystemLogger}=require('../js/core/observability/system-logger');
const {createSystemHealth}=require('../js/core/observability/system-health');
const {createDiagnosticPackage}=require('../js/core/observability/diagnostic-package');

function listStoredZipEntries(buffer){
  const entries=[];let offset=0;
  while(offset+30<=buffer.length && buffer.readUInt32LE(offset)===0x04034b50){
    const compressedSize=buffer.readUInt32LE(offset+18);const nameLen=buffer.readUInt16LE(offset+26);const extraLen=buffer.readUInt16LE(offset+28);
    const name=buffer.subarray(offset+30,offset+30+nameLen).toString('utf8');
    const start=offset+30+nameLen+extraLen;const end=start+compressedSize;
    entries.push({name,content:buffer.subarray(start,end).toString('utf8')});offset=end;
  }
  return entries;
}

test('diagnostic package is a valid safe ZIP with only public support data',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-diag-'));const dbPath=path.join(dir,'pdv.sqlite');const db=openDatabase(dbPath);let seq=0;const now=()=>new Date(1789000800000+seq++*1000).toISOString();
  try{
    runMigrations(db,now);const settings=createSettingsService({db,now});const logger=createSystemLogger({db,now});
    settings.set('store.name','Loja Teste',{actor:{kind:'system',userId:'system',role:'system'}});
    logger.log({level:'error',subsystem:'fiscal',message:'Falha controlada',context:{saleId:'s1',token:'NAO_PODE_VAZAR',authorization:'Bearer SEGREDO'}});
    const health=createSystemHealth({db,version:'0.9.0'});
    const diagnostics=createDiagnosticPackage({db,health,settings,logger,diagnosticsDir:path.join(dir,'diagnostics'),version:'0.9.0',now,idFactory:()=> 'diag-1'});
    const result=diagnostics.createPackage({actor:{userId:'admin',profileId:'profile-administrator'}});
    assert.equal(result.id,'diag-1');assert.match(result.fileName,/\.zip$/);assert.equal(result.sha256.length,64);assert.ok(result.size>0);assert.ok(fs.existsSync(result.filePath));
    const raw=fs.readFileSync(result.filePath);assert.equal(raw.readUInt32LE(0),0x04034b50);
    const entries=listStoredZipEntries(raw);const names=entries.map(e=>e.name).sort();
    assert.deepEqual(names,['health.json','logs.json','manifest.json','migrations.json','settings-public.json']);
    const joined=entries.map(e=>e.content).join('\n');assert.equal(joined.includes('NAO_PODE_VAZAR'),false);assert.equal(joined.includes('Bearer SEGREDO'),false);assert.equal(joined.includes('pdv.sqlite'),false);assert.equal(names.some(name=>/sqlite|database|secret|credential/i.test(name)),false);
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('diagnostic package requires settings.manage',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-diag-role-'));const db=openDatabase(path.join(dir,'pdv.sqlite'));try{
    runMigrations(db);const settings=createSettingsService({db});const logger=createSystemLogger({db});const health=createSystemHealth({db});const authorization={require(){throw Object.assign(new Error('Permissao insuficiente.'),{statusCode:403});}};const diagnostics=createDiagnosticPackage({db,health,settings,logger,authorization,diagnosticsDir:path.join(dir,'diagnostics')});
    assert.throws(()=>diagnostics.createPackage({actor:{kind:'human',userId:'mgr'}}),/permissao/i);
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
