import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';

const origin='http://127.0.0.1:8788';
const child=spawn('npx',['--yes','wrangler@4.137.0','dev','--local','--ip','127.0.0.1','--port','8788','--var','AUTH_ENABLED:true'],{
  stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32',env:{...process.env,CI:'true'}
});
let stderr='',stdout='';
child.stderr.on('data',b=>stderr=(stderr+b.toString()).slice(-10000));
child.stdout.on('data',b=>stdout=(stdout+b.toString()).slice(-10000));
try {
  let ready=false,latest;
  for(let i=0;i<50;i++){
    if(child.exitCode!==null)break;
    try {
      const res=await fetch(origin+'/api/v1/health',{signal:AbortSignal.timeout(900)});
      latest=res;
      if(res.status===200&&(await res.json()).status==='identity-ready'){ready=true;break;}
    }catch{}
    await sleep(300);
  }
  assert.ok(ready,'Cloudflare Workerd did not become ready: '+(latest?.status||'no response')+'\n'+stderr+'\n'+stdout);
  const headers={'origin':origin,'content-type':'application/json'};
  const login=await fetch(origin+'/api/v1/auth/login',{
    method:'POST',headers,signal:AbortSignal.timeout(5000),body:JSON.stringify({
      email:'owner@example.test',password:'DummyStrongPassOnlyForCI2026'
    })
  });
  assert.equal(login.status,200,'Cloudflare PBKDF2 or session login failed: '+await login.text());
  const cookie=(login.headers.get('set-cookie')||'').split(';')[0];
  assert.ok(cookie.startsWith('__Host-pdvtotal_session=')||cookie.startsWith('pdvtotal_local_session='));
  const session=await fetch(origin+'/api/v1/auth/session',{headers:{cookie},signal:AbortSignal.timeout(5000)});
  assert.equal(session.status,200,'Cloudflare session failed');
  const identity=await session.json();
  assert.equal(identity.memberships.length,1);
  const tenantId=identity.memberships[0].tenantId;
  const denied=await fetch(origin+'/api/v1/tenants/another-tenant/branches',{headers:{cookie},signal:AbortSignal.timeout(5000)});
  assert.equal(denied.status,404,'Cross-tenant access was not blocked');
  const branch=await fetch(origin+'/api/v1/tenants/'+tenantId+'/branches',{headers:{cookie},signal:AbortSignal.timeout(5000)});
  assert.equal(branch.status,200,'Canonical branch read failed');
  assert.equal((await branch.json()).branches.length,1);
  const logout=await fetch(origin+'/api/v1/auth/session',{method:'DELETE',headers:{cookie,origin},signal:AbortSignal.timeout(5000)});
  assert.equal(logout.status,200,'Logout failed');
  const revoked=await fetch(origin+'/api/v1/auth/session',{headers:{cookie},signal:AbortSignal.timeout(5000)});
  assert.equal(revoked.status,401,'Session was not revoked');
  console.log('PASS: real Cloudflare Workerd + D1 login, PBKDF2 100k, canonical tenant, branch isolation, logout.');
}finally{
  // npx may spawn a long-lived Wrangler grandchild; kill the whole process group.
  const stop=signal=>{try{if(process.platform==='win32')child.kill(signal);else process.kill(-child.pid,signal);}catch{}};
  stop('SIGTERM');
  await sleep(400);
  if(child.exitCode===null)stop('SIGKILL');
}
