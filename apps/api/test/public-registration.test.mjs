import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createApi} from '../src/worker.mjs';
const schema=readFileSync(new URL('../migrations/0001_identity.sql',import.meta.url),'utf8');
const signupSchema=readFileSync(new URL('../migrations/0030_public_registration.sql',import.meta.url),'utf8');
const origin='https://pdvtotal.example.test',now=Date.parse('2026-10-19T14:00:00Z');
const valid={displayName:'Ana Silva',businessName:'Restaurante Ana',email:'ana@example.com',password:'SenhaLongaSegura2026!'};
function fixture(vars={AUTH_ENABLED:'true',REGISTRATION_ENABLED:'true',TRUST_CF_CONNECTING_IP:'true'}){
  const db=openLocalDatabase();
  db.exec(schema);db.exec(signupSchema);
  const api=createApi({DB:db,...vars},{now:()=>now});
  const send=(payload=valid,ip='203.0.113.5')=>api.fetch(new Request(origin+'/api/v1/auth/register',{
    method:'POST',headers:{origin,'content-type':'application/json','cf-connecting-ip':ip},body:JSON.stringify(payload)
  }));
  return {db,api,send,close:()=>db.close()};
}
test('registration atomically creates one pending tenant, owner and branch; approval unlocks existing login',async()=>{
  const x=fixture();
  try {
    const out=await x.send();
    assert.equal(out.status,202);
    assert.equal((await out.json()).status,'pending-approval');
    const user=await x.db.prepare('SELECT id,email_norm AS email FROM users').bind().first();
    const tenant=await x.db.prepare('SELECT id,name,active FROM tenants').bind().first();
    const member=await x.db.prepare('SELECT active,profile_key AS profile FROM tenant_memberships').bind().first();
    const branch=await x.db.prepare('SELECT tenant_id AS tenantId,code FROM branches').bind().first();
    assert.equal(user.email,'ana@example.com');assert.equal(tenant.name,'Restaurante Ana');
    assert.equal(tenant.active,0);assert.equal(member.profile,'OWNER');assert.equal(member.active,0);
    assert.equal(branch.tenantId,tenant.id);assert.equal(branch.code,'MAIN');
    const login=()=>x.api.fetch(new Request(origin+'/api/v1/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:valid.email,password:valid.password})}));
    assert.equal((await login()).status,403);
    await x.db.prepare('UPDATE tenants SET active=1 WHERE id=?').bind(tenant.id).run();
    await x.db.prepare('UPDATE tenant_memberships SET active=1 WHERE tenant_id=?').bind(tenant.id).run();
    assert.equal((await login()).status,200);
  }finally{x.close();}
});
test('duplicate emails receive a generic response and do not create extra tenants',async()=>{
  const x=fixture();
  try {
    const first=await x.send();
    const repeated=await x.send();
    assert.equal(first.status,202);
    assert.equal(repeated.status,202);
    assert.deepEqual(await repeated.json(),await first.json(),
      'duplicate e-mail must not be discoverable from the signup response');
    assert.equal((await x.db.prepare('SELECT COUNT(*) AS n FROM tenants').bind().first()).n,1);
  }finally{x.close();}
});
test('strong password validation, per-IP rate limiting, and separate IP buckets',async()=>{
  const x=fixture();
  try {
    assert.equal((await x.send({...valid,password:'weak'})).status,400);
    assert.equal((await x.send({...valid,displayName:'A'})).status,400);
    for(let i=0;i<3;i++)assert.equal((await x.send({...valid,email:'user'+i+'@example.com'})).status,202);
    assert.equal((await x.send({...valid,email:'fourth@example.com'})).status,429);
    assert.equal((await x.send({...valid,email:'different@example.com'},'198.51.100.4')).status,202);
    assert.equal((await x.db.prepare('SELECT COUNT(*) AS n FROM tenants').bind().first()).n,4);
  }finally{x.close();}
});
test('registration requires same-origin CSRF and opt-in flags',async()=>{
  const x=fixture({AUTH_ENABLED:'true',REGISTRATION_ENABLED:'false'});
  try{
    assert.equal((await x.send()).status,503);
    const r=await x.api.fetch(new Request(origin+'/api/v1/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(valid)}));
    assert.equal(r.status,403);
    assert.equal((await x.db.prepare('SELECT COUNT(*) AS n FROM users').bind().first()).n,0);
  }finally{x.close();}
});
test('production auth flag disables registration before database writes',async()=>{
  const x=fixture({AUTH_ENABLED:'false',REGISTRATION_ENABLED:'true'});
  try{
    assert.equal((await x.send()).status,503);
    assert.equal((await x.db.prepare('SELECT COUNT(*) AS n FROM public_signup_throttles').bind().first()).n,0);
  }finally{x.close();}
});
test('bot honeypot does not provision identity records',async()=>{
  const x=fixture();
  try{
    const response=await x.send({...valid,website:'bot.example'});
    assert.equal(response.status,202);
    assert.equal((await response.json()).status,'pending-approval');
    assert.equal((await x.db.prepare('SELECT COUNT(*) AS n FROM users').bind().first()).n,0);
  }finally{x.close();}
});

test('untrusted signup client headers cannot reset self-hosted rate limits',async()=>{
 const x=fixture({AUTH_ENABLED:'true',REGISTRATION_ENABLED:'true',TRUST_CF_CONNECTING_IP:'false'});
 try{
  for(let i=0;i<3;i++)
   assert.equal((await x.send({...valid,email:'untrusted'+i+'@example.test'},'198.51.100.'+(i+1))).status,202);
  assert.equal((await x.send({...valid,email:'blocked@example.test'},'198.51.100.75')).status,429);
 }finally{x.close();}
});
