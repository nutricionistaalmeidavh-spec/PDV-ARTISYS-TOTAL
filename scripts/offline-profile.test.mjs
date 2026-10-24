import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,statSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validateOfflineProfile,writeOfflineProfile} from '../scripts/offline-profile.mjs';

test('offline PC wizard validates gateway scope, TLS and writes a 0600 credential file',()=>{
 const dir=mkdtempSync(join(tmpdir(),'pdv-offline-setup-'));
 try{
  const cert=join(dir,'cert.pem'),key=join(dir,'key.pem');
  writeFileSync(cert,'CERT');writeFileSync(key,'KEY');
  const profile=validateOfflineProfile({
   cloudOrigin:'https://cloud.example.test',localOrigin:'https://pdv.loja.lan:8443',
   gatewayId:'gateway-valid',token:'a'.repeat(64),tenantId:'tenant-1',branchId:'branch-1',
   certPath:cert,keyPath:key,dataPath:join(dir,'db.sqlite')});
  assert.equal(profile.PDV_OFFLINE_REPLICA_ENABLED,'true');
  assert.equal(profile.PDV_OFFLINE_CASH_ENABLED,'false','financial writes require separate opt in');
  assert.equal(profile.PDV_BIND_HOST,'0.0.0.0');
  const dest=join(dir,'profile.json');
  writeOfflineProfile(dest,profile);
  assert.equal(readFileSync(dest,'utf8').includes('a'.repeat(64)),true);
  if(process.platform!=='win32')assert.equal(statSync(dest).mode&0o777,0o600);
  assert.throws(()=>writeOfflineProfile(dest,profile),/já existe/);
  assert.throws(()=>validateOfflineProfile({...profile,cloudOrigin:'http://localhost:5555'}),/HTTPS/);
  assert.throws(()=>validateOfflineProfile({...profile,token:'bad'}),/Token/);
 }finally{rmSync(dir,{force:true,recursive:true});}
});
