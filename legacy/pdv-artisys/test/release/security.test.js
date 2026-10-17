'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../../js/core/pdv-runtime');

test('release gate: public support surfaces never expose secret-like values',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-release-security-'));const runtime=createPdvRuntime({dbPath:path.join(dir,'pdv.sqlite'),appVersion:'release-test'});
 try{
   runtime.catalog.createUser({id:'admin',username:'admin',name:'Administrador',profileId:'profile-administrator',password:'Release-Security-123!'});
   assert.throws(()=>runtime.settings.set('provider.token','TOP-SECRET',{actor:{userId:'admin',profileId:'profile-administrator'}}),/sensivel/i);
   runtime.logger.log({level:'error',subsystem:'security-test',message:'controlled',context:{token:'TOP-SECRET',authorization:'Bearer TOP-SECRET',safe:'visible'}});
   const logs=runtime.logger.list({limit:10});const serialized=JSON.stringify(logs);assert.equal(serialized.includes('TOP-SECRET'),false);assert.equal(serialized.includes('Bearer'),false);assert.equal(logs[0].context.safe,'visible');
   const bundle=runtime.diagnostics.createPackage({actor:{kind:'system',role:'system'}});const raw=fs.readFileSync(bundle.filePath);assert.equal(raw.includes(Buffer.from('TOP-SECRET')),false);assert.equal(raw.includes(Buffer.from('Bearer TOP-SECRET')),false);
 }finally{runtime.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('release gate: terminal credentials are stored as derived hashes',()=>{
 const runtime=createPdvRuntime();try{
   const pair=runtime.terminals.createPairingCode({createdBy:'admin'});
   const terminal=runtime.terminals.pairTerminal({code:pair.code,terminalId:'PDV-SEC',name:'Seguro',fingerprint:'release-security-terminal',appVersion:'1.0.0'});
   assert.ok(terminal.credential);
   const row=runtime.db.prepare('SELECT credential_hash,credential_salt FROM terminals WHERE terminal_id=?').get('PDV-SEC');
   assert.ok(row.credential_hash);assert.ok(row.credential_salt);assert.equal(row.credential_hash.includes(terminal.credential),false);assert.equal(runtime.terminals.authenticateTerminal('PDV-SEC',terminal.credential).ok,true);
 }finally{runtime.close();}
});
