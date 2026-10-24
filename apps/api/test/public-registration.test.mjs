import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createApi} from '../src/worker.mjs';
const schema=readFileSync(new URL('../migrations/0001_identity.sql',import.meta.url),'utf8');
const signupSchema=readFileSync(new URL('../migrations/0030_public_registration.sql',import.meta.url),'utf8');
const saasSchema=readFileSync(new URL('../migrations/0031_saas_access.sql',import.meta.url),'utf8');
const origin='https://pdvtotal.example.test',now=Date.parse('2026-10-19T14:00:00Z');
const valid={displayName:'Ana Silva',businessName:'Restaurante Ana',email:'ana@example.com',password:'SenhaLongaSegura2026!'};
function fixture(vars={AUTH_ENABLED:'true',REGISTRATION_ENABLED:'true',TRUST_CF_CONNECTING_IP:'true'},clock=now){
  const db=openLocalDatabase();
  db.exec(schema);db.exec(signupSchema);db.exec(saasSchema);
  const api=createApi({DB:db,...vars},{now:()=>clock});
  const send=(payload=valid,ip='203.0.113.5')=>api.fetch(new Request(origin+'/api/v1/auth/register',{
    method:'POST',headers:{origin,'content-type':'application/json','cf-connecting-ip':ip},body:JSON.stringify(payload)
  }));
  return {db,api,send,close:()=>db.close()};
}
test('registration atomically activates scoped tenant, owner and 14-day trial without review',async()=>{
  const x=fixture();
  try {
    const out=await x.send();
    assert.equal(out.status,202);
    assert.equal((await out.json()).status,'trial-ready');
    const user=await x.db.prepare('SELECT id,email_norm AS email FROM users').bind().first();
    const tenant=await x.db.prepare('SELECT id,name,active FROM tenants').bind().first();
    const member=await x.db.prepare('SELECT active,profile_key AS profile FROM tenant_memberships').bind().first();
    const branch=await x.db.prepare('SELECT tenant_id AS tenantId,code FROM branches').bind().first();
    assert.equal(user.email,'ana@example.com');assert.equal(tenant.name,'Restaurante Ana');
    assert.equal(tenant.active,1);assert.equal(member.profile,'OWNER');assert.equal(member.active,1);
    assert.equal(branch.tenantId,tenant.id);assert.equal(branch.code,'MAIN');
    const login=()=>x.api.fetch(new Request(origin+'/api/v1/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:valid.email,password:valid.password})}));
    assert.equal((await login()).status,200);
    const trial=await x.db.prepare('SELECT status,plan_key AS planKey,ends_at AS endsAt FROM saas_subscriptions WHERE tenant_id=?').bind(tenant.id).first();
    assert.equal(trial.status,'TRIAL');assert.equal(trial.planKey,'trial');
    assert.equal(trial.endsAt,new Date(now+14*86400000).toISOString());
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
    assert.equal((await response.json()).status,'trial-ready');
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


test('welcome and account use Brasília at the UTC midnight boundary without changing 14 days',async()=>{
 const sent=[],clock=Date.parse('2026-10-24T02:46:00Z');
 const x=fixture({AUTH_ENABLED:'true',REGISTRATION_ENABLED:'true',EMAIL_FROM:'welcome@artisys.dev',
  EMAIL_PUBLIC_BASE_URL:'https://pdv.artisys.dev',EMAIL:{async send(message){sent.push(message);return {messageId:'welcome-test'};}}},clock);
 try{
  assert.equal((await x.send({...valid,businessName:'Restaurante <img src=x onerror=alert(1)>'})).status,202);
  const sub=await x.db.prepare('SELECT ends_at FROM saas_subscriptions').bind().first();
  assert.equal(sub.ends_at,'2026-11-07T02:46:00.000Z');
  assert.equal(sent.length,1);
  assert.match(sent[0].text,/06\/11\/2026, 23:46 \(Brasília\)/);
  assert.match(sent[0].html,/06\/11\/2026, 23:46 \(Brasília\)/);
  assert.match(sent[0].text,/https:\/\/pdv\.artisys\.dev\/app\//);
  assert.match(sent[0].html,/&lt;img/);
  assert.doesNotMatch(sent[0].html,/<img|onerror=alert\(1\)>/);
  assert.doesNotMatch(sent[0].text,/workers\.dev/);
 }finally{x.close();}
});

test('email provider failure never revokes or blocks the automatic trial',async()=>{
 const x=fixture({AUTH_ENABLED:'true',REGISTRATION_ENABLED:'true',EMAIL_FROM:'welcome@artisys.dev',
  EMAIL:{async send(){throw Error('unavailable');}}});
 try{
  assert.equal((await x.send()).status,202);
  assert.equal((await x.db.prepare('SELECT status FROM saas_subscriptions').bind().first()).status,'TRIAL');
 }finally{x.close();}
});
