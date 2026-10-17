import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createApi} from '../src/worker.mjs';
import {hashPassword,verifyPassword,ITERATIONS} from '../src/password.mjs';

const sql=readFileSync(new URL('../migrations/0001_identity.sql',import.meta.url),'utf8');
const origin='https://pdv-total.example.test';
const NOW=Date.parse('2026-10-17T10:00:00Z');
const stamp=new Date(NOW).toISOString();

async function fixture() {
  const db=openLocalDatabase();
  db.exec(sql);
  const h=await hashPassword('Teste-Seguro-Longo-2026!');
  for(const [id,email] of [['u-a','alice@example.com'],['u-b','bob@example.com']]){
    await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').bind(id,email,id,h,stamp).run();
  }
  for(const id of ['a','b']) {
    await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind(id,'tenant-'+id,'Loja '+id,stamp).run();
    await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)').bind('branch-'+id,id,'MAIN','Matriz '+id,stamp).run();
  }
  await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)').bind('a','u-a','OWNER',stamp).run();
  await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)').bind('b','u-b','READ_ONLY',stamp).run();
  const api=createApi({DB:db},{now:()=>NOW});
  const request=async(path,method='GET',data=null,cookie='',sendOrigin=true)=>{
    const headers={};
    if(cookie)headers.cookie=cookie;
    if(!['GET','HEAD'].includes(method)&&sendOrigin)headers.origin=origin;
    if(data!==null)headers['content-type']='application/json';
    const req=new Request(origin+path,{method,headers,...(data!==null?{body:JSON.stringify(data)}:{})});
    return api.fetch(req);
  };
  const login=async(email,password='Teste-Seguro-Longo-2026!')=>{
    const r=await request('/api/v1/auth/login','POST',{email,password});
    return {response:r,cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
  };
  return {db,api,request,login,close:()=>db.close()};
}

test('health is minimal and no commercial mutations are exposed',async()=>{
  const x=await fixture();
  try{
    const r=await x.request('/api/v1/health');
    assert.equal(r.status,200);
    assert.equal((await r.json()).status,'identity-ready');
    const {cookie}=await x.login('alice@example.com');
    for(const route of ['/api/v1/sales','/api/v1/inventory','/api/v1/cash']) {
      const out=await x.request(route,'POST',{},cookie);
      assert.equal(out.status,404,'domain mutations must remain unavailable until canonical core is adapted');
    }
  }finally{x.close();}
});

test('membership data and branches cannot leak across companies',async()=>{
  const x=await fixture();
  try {
    const {response,cookie}=await x.login('alice@example.com');
    assert.equal(response.status,200);
    assert.match(cookie,/__Host-pdvtotal_session=/);
    assert.match(response.headers.get('set-cookie'),/HttpOnly/);
    assert.match(response.headers.get('set-cookie'),/Secure/);
    const s=await x.request('/api/v1/auth/session','GET',null,cookie);
    assert.equal(s.status,200);
    const user=await s.json();
    assert.equal(user.principal.kind,'human');
    assert.deepEqual(user.memberships.map(m=>m.tenantId),['a']);
    const self=await x.request('/api/v1/tenants/a/branches','GET',null,cookie);
    assert.equal(self.status,200);
    assert.deepEqual((await self.json()).branches.map(x=>x.id),['branch-a']);
    for(const route of ['/api/v1/tenants/b/context','/api/v1/tenants/b/branches','/api/v1/tenants/b/members']){
      const forbidden=await x.request(route,'GET',null,cookie);
      assert.equal(forbidden.status,404,route);
    }
  }finally{x.close();}
});

test('permission checks reuse canonical default-profile permission catalogue',async()=>{
  const x=await fixture();
  try{
    const a=(await x.login('alice@example.com')).cookie;
    const b=(await x.login('bob@example.com')).cookie;
    const owners=await x.request('/api/v1/tenants/a/members','GET',null,a);
    assert.equal(owners.status,200);
    assert.deepEqual((await owners.json()).members.map(m=>m.id),['u-a']);
    const readonly=await x.request('/api/v1/tenants/b/members','GET',null,b);
    // READ_ONLY includes users.view in the original PDV contract.
    assert.equal(readonly.status,200);
    await x.db.prepare("UPDATE tenant_memberships SET profile_key='CASHIER' WHERE tenant_id='b' AND user_id='u-b'").bind().run();
    const cashier=await x.request('/api/v1/tenants/b/members','GET',null,b);
    assert.equal(cashier.status,403);
  }finally{x.close();}
});

test('disabled memberships and inactive users lose access immediately',async()=>{
  const x=await fixture();
  try{
    const a=(await x.login('alice@example.com')).cookie;
    await x.db.prepare("UPDATE tenant_memberships SET active=0 WHERE tenant_id='a'").bind().run();
    assert.equal((await x.request('/api/v1/tenants/a/context','GET',null,a)).status,404);
    await x.db.prepare("UPDATE users SET active=0 WHERE id='u-a'").bind().run();
    assert.equal((await x.request('/api/v1/auth/session','GET',null,a)).status,401);
  }finally{x.close();}
});

test('login is origin-gated, generic on credentials, throttled, and logout revokes session',async()=>{
  const x=await fixture();
  try{
    const wrongOrigin=await x.request('/api/v1/auth/login','POST',{email:'alice@example.com',password:'abc'},'',false);
    assert.equal(wrongOrigin.status,403);
    for(let i=0;i<5;i++){
      const r=await x.request('/api/v1/auth/login','POST',{email:'alice@example.com',password:'errada'});
      assert.equal(r.status,401);
      assert.equal((await r.json()).error,'Credenciais inválidas.');
    }
    assert.equal((await x.login('alice@example.com')).response.status,429);
    const bob=(await x.login('bob@example.com')).cookie;
    assert.equal((await x.request('/api/v1/auth/session','DELETE',null,bob,false)).status,403);
    assert.equal((await x.request('/api/v1/auth/session','DELETE',null,bob)).status,200);
    assert.equal((await x.request('/api/v1/auth/session','GET',null,bob)).status,401);
  }finally{x.close();}
});


test('localhost HTTP session cookie uses its own non-Host prefix without weakening production cookies',async()=>{
  const x=await fixture();
  try {
    const local='http://localhost:4175';
    const api=createApi({DB:x.db,COOKIE_SECURE:'false'},{now:()=>NOW});
    const login=await api.fetch(new Request(local+'/api/v1/auth/login',{
      method:'POST',headers:{origin:local,'content-type':'application/json'},
      body:JSON.stringify({email:'alice@example.com',password:'Teste-Seguro-Longo-2026!'})
    }));
    assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie');
    assert.match(cookie,/^pdvtotal_local_session=/);
    assert.doesNotMatch(cookie,/__Host-/);
    assert.doesNotMatch(cookie,/; Secure/);
    const current=await api.fetch(new Request(local+'/api/v1/auth/session',{
      headers:{cookie:cookie.split(';')[0]}
    }));
    assert.equal(current.status,200);
  }finally{x.close();}
});

test('Cloudflare WebCrypto password hashing stays within the 100,000 iteration runtime limit',async()=>{
  assert.equal(ITERATIONS,100000);
  const hashed=await hashPassword('Another-Strong-Password-2026!');
  assert.match(hashed,/^pbkdf2:sha256:100000:[0-9a-f]{32}:[0-9a-f]{64}$/);
  assert.equal(await verifyPassword('Another-Strong-Password-2026!',hashed),true);
  assert.equal(await verifyPassword('wrong',hashed),false);
  assert.equal(await verifyPassword('wrong',hashed.replace(':100000:',':210000:')),false);
});

test('health reports setup-required until the isolated D1 identity schema has been migrated',async()=>{
  const db=openLocalDatabase();
  const api=createApi({DB:db});
  try{
    const result=await api.fetch(new Request(origin+'/api/v1/health'));
    assert.equal(result.status,503);
    assert.equal((await result.json()).status,'setup-required');
    db.exec(sql);
    const ready=await api.fetch(new Request(origin+'/api/v1/health'));
    assert.equal(ready.status,200);
    assert.equal((await ready.json()).status,'identity-ready');
  }finally{db.close();}
});

test('public Cloudflare deployment keeps authentication disabled until explicitly enabled',async()=>{
  const db=openLocalDatabase();
  db.exec(sql);
  const api=createApi({DB:db,AUTH_ENABLED:'false'});
  try{
    const h=await api.fetch(new Request(origin+'/api/v1/health'));
    assert.equal(h.status,200);
    const r=await api.fetch(new Request(origin+'/api/v1/auth/login',{
      method:'POST',headers:{origin,'content-type':'application/json'},
      body:JSON.stringify({email:'owner@example.test',password:'DummyStrongPassOnlyForCI2026'})
    }));
    assert.equal(r.status,503);
    const attempts=await db.prepare('SELECT COUNT(*) AS n FROM login_throttles').bind().first();
    assert.equal(attempts.n,0,'staging login must not write into D1');
  }finally{db.close();}
});
