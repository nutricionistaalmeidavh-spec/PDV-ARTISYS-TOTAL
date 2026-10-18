import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {prepareLocalServer,prepareLocalTerminal,canonicalLanOrigin,
  checkLocalServer} from '../../../scripts/r2-deploy.mjs';

async function temporary(t){
  const directory=await mkdtemp(join(tmpdir(),'pdv-r2-profile-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const cert=join(directory,'local-cert.pem'),key=join(directory,'local-key.pem');
  await writeFile(cert,'TEST-ONLY CERT FIXTURE');
  await writeFile(key,'TEST-ONLY PRIVATE KEY FIXTURE');
  return {directory,cert,key};
}
test('cap-001 R2 Windows local-first server can be configured and launched from a native cmd without cloud secrets',async t=>{
  const x=await temporary(t);
  assert.equal(canonicalLanOrigin('https://pdv.loja.local:8443'),'https://pdv.loja.local:8443');
  assert.throws(()=>canonicalLanOrigin('http://pdv.loja.local'),/HTTPS/);
  assert.throws(()=>canonicalLanOrigin('https://user:pass@pdv.loja.local'),/HTTPS/);
  const profile=await prepareLocalServer({directory:join(x.directory,'server'),
    origin:'https://pdv.loja.local:8443',key:x.key,cert:x.cert,
    database:join(x.directory,'db.sqlite')});
  assert.equal(profile.role,'SERVER');
  assert.equal(profile.cloudRequired,false);
  const cmd=await readFile(profile.shortcutPath,'utf8');
  assert.match(cmd,/^@echo off/m);
  assert.match(cmd,/r2-deploy\.mjs" launch-server --config/);
  assert.ok(!cmd.includes('PDV_OWNER_PASSWORD'));
  const raw=await readFile(profile.configPath,'utf8'),saved=JSON.parse(raw);
  assert.equal(saved.role,'SERVER');
  assert.equal(saved.database,join(x.directory,'db.sqlite'));
  assert.ok(!raw.includes('password')&&!raw.includes('deviceToken'));
  const checked=await checkLocalServer(profile.configPath);
  assert.equal(checked.readyForLaunch,true);
  const script=fileURLToPath(new URL('../../../scripts/r2-deploy.mjs',import.meta.url));
  const direct=JSON.parse(execFileSync(process.execPath,[script,'check-server','--config',profile.configPath],
    {encoding:'utf8'}));
  assert.equal(direct.readyForLaunch,true);
  await assert.rejects(prepareLocalServer({directory:join(x.directory,'server'),
    origin:'https://pdv.loja.local:8443',key:x.key,cert:x.cert,
    database:join(x.directory,'db.sqlite')}),/EEXIST/,
    'an existing installation must never be silently overwritten');
});
test('cap-056 R2 server/terminal profiles keep SQLite and credentials on the server only',async t=>{
  const x=await temporary(t);
  const server=await prepareLocalServer({directory:join(x.directory,'server'),
    origin:'https://127.0.0.1:8443',key:x.key,cert:x.cert,
    database:join(x.directory,'data.sqlite')});
  const terminal=await prepareLocalTerminal({directory:join(x.directory,'terminal'),
    origin:'https://127.0.0.1:8443'});
  const shortcut=await readFile(terminal.shortcutPath,'utf8');
  assert.equal(terminal.role,'TERMINAL');
  assert.equal(terminal.cloudRequired,false);
  assert.match(shortcut,/^\[InternetShortcut\]\r?\nURL=https:\/\/127\.0\.0\.1:8443\//);
  assert.equal(shortcut.includes('SQLite'),false);
  assert.equal(shortcut.includes('password'),false);
  assert.ok(!shortcut.includes(x.key),'terminal shortcut must not contain the server private key path');
  assert.ok(!shortcut.includes(server.configPath),'terminal profile cannot expose the server config');
  await assert.rejects(prepareLocalTerminal({directory:join(x.directory,'terminal'),
    origin:'https://127.0.0.1:8443'}),/EEXIST/);
  await assert.rejects(prepareLocalTerminal({directory:join(x.directory,'bad'),
    origin:'http://localhost:8443'}),/HTTPS/);
});
