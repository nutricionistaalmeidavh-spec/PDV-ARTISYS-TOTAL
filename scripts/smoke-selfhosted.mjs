// Full local Node+SQLite+PWA smoke: no Cloudflare account or paid service.
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const temp=await mkdtemp(join(tmpdir(),'pdv-total-selfhost-'));
const probe=createServer();
await new Promise((yes,no)=>probe.once('error',no).listen(0,'127.0.0.1',yes));
const port=probe.address().port;
await new Promise(yes=>probe.close(yes));
const base='http://127.0.0.1:'+port;
const child=spawn(process.execPath,['--experimental-sqlite',resolve(root,'apps/api/src/server.mjs')],{
  env:{...process.env,PORT:String(port),PDV_HOST:'127.0.0.1',
    LOCAL_DB_PATH:join(temp,'test.sqlite'),AUTH_ENABLED:'false'},
  stdio:['ignore','pipe','pipe']
});
let stderr='';child.stderr.on('data',d=>stderr=(stderr+d.toString()).slice(-3500));
try{
  let ready=false;
  for(let attempt=0;attempt<60;attempt++){
    if(child.exitCode!==null)break;
    try{const result=await fetch(base+'/api/v1/health',{signal:AbortSignal.timeout(300)});
      if(result.status===200){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(ready,'Local API did not start: '+stderr);
  const shell=await fetch(base+'/');
  assert.equal(shell.status,200);
  const html=await shell.text();
  assert.match(html,/PDV ArtiSys/i);
  assert.match(html,/R\$ 89,90/);
  assert.doesNotMatch(html,/teste grátis|data-open-login|data-open-register/i);
  assert.match(html,/id="hero-title"/);
  const app=await fetch(base+'/app/');
  assert.equal(app.status,200);
  assert.match(await app.text(),/report-xlsx\.js/);
  assert.match(shell.headers.get('content-type'),/text\/html/);
  const js=await fetch(base+'/report-xlsx.js');
  assert.equal(js.status,200);
  assert.match(await js.text(),/PdvReportXlsx/);
  const manifest=await fetch(base+'/manifest.webmanifest');
  assert.equal(manifest.status,200);
  assert.equal((await manifest.json()).display,'standalone');
  const blocked=await fetch(base+'/%2e%2e/apps/api/src/server.mjs');
  assert.notEqual(blocked.status,200);
  const api=await fetch(base+'/api/v1/health');
  assert.equal(api.status,200);
  const access=await fetch(base+'/api/v1/auth/session');
  assert.notEqual(access.status,200,'Unauthenticated personal data access must be blocked');
  console.log('Self-hosted PWA + SQLite API: same-origin smoke passed on loopback.');
}finally{
  child.kill('SIGTERM');
  await rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
