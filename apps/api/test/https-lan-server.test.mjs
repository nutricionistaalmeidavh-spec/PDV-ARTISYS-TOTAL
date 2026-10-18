import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {request as httpsRequest} from 'node:https';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLanServer,lanConfig} from '../src/https-lan-server.mjs';
import {applyLocalMigrations} from '../src/local-migrations.mjs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {hashPassword} from '../src/password.mjs';

test('LAN server requires an exact public HTTPS origin and explicit TLS/auth',()=>{
  const base={PDV_PUBLIC_ORIGIN:'https://localhost:8443',PDV_LAN_PORT:'8443',
    PDV_TLS_KEY:'/certs/key.pem',PDV_TLS_CERT:'/certs/cert.pem',AUTH_ENABLED:'true'};
  assert.throws(()=>lanConfig({...base,PDV_PUBLIC_ORIGIN:'http://localhost:8443'}),/HTTPS/);
  assert.throws(()=>lanConfig({...base,AUTH_ENABLED:'false'}),/Habilitação explícita/);
  assert.throws(()=>lanConfig({...base,PDV_LAN_PORT:'9999'}),/corresponder/);
  assert.throws(()=>lanConfig({...base,PDV_TLS_KEY:undefined}),/TLS obrigatório/);
});

test('cap-002 LAN: two authenticated HTTPS terminals, strict host/CSRF, RBAC and tenant isolation',async t=>{
  try{execFileSync('openssl',['version'],{stdio:'ignore'});}
  catch{t.skip('OpenSSL CLI not available to create short-lived test certificate');return;}
  const folder=await mkdtemp(join(tmpdir(),'pdv-lan-'));
  const cleanup=[];
  t.after(async()=>{
    for(const close of cleanup.reverse())await close();
    await rm(folder,{recursive:true,force:true});
  });
  const keyPath=join(folder,'server.key'),certPath=join(folder,'server.crt');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-sha256','-nodes',
    '-keyout',keyPath,'-out',certPath,'-days','1','-subj','/CN=localhost',
    '-addext','subjectAltName=DNS:localhost'],{stdio:'ignore'});
  const webRoot=join(folder,'web');
  await mkdir(webRoot);
  await writeFile(join(webRoot,'index.html'),'<html><body>PDV Total fixture</body></html>');
  await writeFile(join(webRoot,'sw.js'),'// Offline shell fixture');
  await writeFile(join(webRoot,'app.js'),'window.appReady=true;');
  await writeFile(join(folder,'secret.env'),'CANNOT-BE-SERVED');
  const db=openLocalDatabase(join(folder,'pdv.sqlite'));
  cleanup.push(()=>db.close());
  await applyLocalMigrations(db);
  const stamp=new Date().toISOString();
  const hash=await hashPassword('A-long-offline-test-password!');
  for(const [id,mail] of [['owner','owner@example.test'],['cashier','cashier@example.test'],['other','other@example.test']])
    await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
      .bind(id,mail,id,hash,stamp).run();
  for(const [id,slug] of [['a','store-a'],['b','store-b']]){
    await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind(id,slug,slug,stamp).run();
    await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)')
      .bind('branch-'+id,id,'MAIN','Matriz',stamp).run();
  }
  for(const [tenant,user,role] of [['a','owner','OWNER'],['a','cashier','CASHIER'],['b','other','OWNER']])
    await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)')
      .bind(tenant,user,role,stamp).run();
  const server=createLanServer({origin:'https://localhost:8443',tlsKey:await readFile(keyPath),
    tlsCert:await readFile(certPath),db,webRoot});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  cleanup.push(()=>new Promise(resolve=>server.close(resolve)));

  const port=server.address().port;
  const send=(path,method='GET',body,headers={})=>new Promise((resolve,reject)=>{
    const data=body===undefined?undefined:JSON.stringify(body);
    const req=httpsRequest({host:'127.0.0.1',port,path,method,rejectUnauthorized:false,
      headers:{host:'localhost:8443',...(data?{'content-type':'application/json'}:{}),...headers}},
    res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
    });
    req.on('error',reject);req.end(data);
  });
  const page=await send('/');
  assert.equal(page.status,200);
  assert.match(page.body,/PDV Total fixture/);
  assert.match(page.headers['content-security-policy'],/frame-ancestors 'none'/);
  assert.equal((await send('/sw.js')).status,200);
  assert.equal((await send('/secret.env')).status,404);
  assert.equal((await send('/%2e%2e/secret.env')).status,400);
  assert.equal((await send('/api/v1/health')).status,200);
  assert.equal((await send('/', 'POST',{})).status,405);
  assert.equal((await send('/api/v1/auth/login','POST',{email:'owner@example.test',password:'A-long-offline-test-password!'},
    {origin:'https://evil.example.test'})).status,403);
  assert.equal((await send('/api/v1/health','GET',undefined,{host:'attacker.example'})).status,421);
  async function login(email){
    const res=await send('/api/v1/auth/login','POST',
      {email,password:'A-long-offline-test-password!'},{origin:'https://localhost:8443'});
    assert.equal(res.status,200,res.body);
    assert.match(res.headers['set-cookie'][0],/Secure/);
    assert.match(res.headers['set-cookie'][0],/HttpOnly/);
    return res.headers['set-cookie'][0].split(';')[0];
  }
  const ownerCookie=await login('owner@example.test');
  const cashierCookie=await login('cashier@example.test');
  const otherCookie=await login('other@example.test');
  assert.notEqual(ownerCookie,cashierCookie,'distinct terminals must not share sessions');
  assert.equal((await send('/api/v1/auth/session','GET',undefined,{cookie:ownerCookie})).status,200);
  assert.equal((await send('/api/v1/tenants/a/members','GET',undefined,{cookie:ownerCookie})).status,200);
  assert.equal((await send('/api/v1/tenants/a/members','GET',undefined,{cookie:cashierCookie})).status,403);
  assert.equal((await send('/api/v1/tenants/b/context','GET',undefined,{cookie:ownerCookie})).status,404);
  assert.equal((await send('/api/v1/tenants/a/context','GET',undefined,{cookie:otherCookie})).status,404);
  assert.equal((await send('/api/v1/tenants/a/branches','GET',undefined,{cookie:cashierCookie})).status,200);
  const logout=await send('/api/v1/auth/session','DELETE',{},{
    cookie:ownerCookie,origin:'https://localhost:8443'});
  assert.equal(logout.status,200);
  assert.equal((await send('/api/v1/auth/session','GET',undefined,{cookie:ownerCookie})).status,401);
  assert.equal((await send('/api/v1/auth/session','GET',undefined,{cookie:cashierCookie})).status,200);
});
