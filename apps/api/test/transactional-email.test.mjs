import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {hashPassword,verifyPassword} from '../src/password.mjs';
import {createApi} from '../src/worker.mjs';
import {sendTransactionalEmail} from '../src/transactional-email.mjs';

const origin='https://pdv.example.test',now=Date.parse('2026-10-20T12:00:00Z');
const stamp=new Date(now).toISOString();
const from='welcome@artisys.dev';
const pwd='Password-Old-Secure-2026';
function mailer(){
 const sent=[];
 return {sent,EMAIL:{async send(message){sent.push(message);return {messageId:'mock-'+sent.length};}},EMAIL_FROM:from};
}
async function fixture(extras={}){
 const db=openLocalDatabase();
 for(const f of ['0001_identity.sql','0031_saas_access.sql','0033_p2_account_security.sql','0035_password_resets.sql'])
  db.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
  .bind('owner','owner@example.test','Owner',await hashPassword(pwd),stamp).run();
 await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind('tenant','tenant-one','Restaurante Teste',stamp).run();
 await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)').bind('branch','tenant','MAIN','Matriz',stamp).run();
 await db.prepare("INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)").bind('tenant','owner','OWNER',stamp).run();
 const env={DB:db,AUTH_ENABLED:'true',...extras};
 const api=createApi(env,{now:()=>now});
 const req=async(path,body,cookie='')=>{
  const headers={origin,'content-type':'application/json',...(cookie?{cookie}:{})};
  return api.fetch(new Request(origin+path,{method:'POST',headers,body:JSON.stringify(body)}));
 };
 return {db,env,req,close:()=>db.close()};
}

test('native Cloudflare EMAIL binding sends branded transactional email without API keys',async()=>{
 const x=mailer();
 const sent=await sendTransactionalEmail(x,{to:'user@example.test',subject:'Confirme seu e-mail',text:'Acesse sua conta.'});
 assert.equal(sent.delivered,true);
 assert.equal(x.sent[0].to,'user@example.test');
 assert.equal(x.sent[0].from.email,from);
 assert.equal(x.sent[0].subject,'Confirme seu e-mail');
 assert.equal(x.sent[0].text,'Acesse sua conta.');
});

test('native Cloudflare invitations are automatically emailed and the browser receives no secret token',async()=>{
 const email=mailer(),x=await fixture(email);
 try{
  const login=await x.req('/api/v1/auth/login',{email:'owner@example.test',password:pwd});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const invite=await x.req('/api/v1/tenants/tenant/invitations',{email:'new@example.test',profileKey:'CASHIER'},cookie);
  assert.equal(invite.status,201,await invite.clone().text());
  const data=await invite.json();
  assert.equal(data.emailSent,true);
  assert.equal(Object.hasOwn(data,'invitationToken'),false,'automatic mode must not echo bearer invitation token into browser');
  assert.equal(email.sent.length,1);
  assert.equal(email.sent[0].to,'new@example.test');
  assert.match(email.sent[0].text,/[a-f0-9]{64}/);
  assert.equal(email.sent[0].text.includes('token='),false);
 }finally{x.close();}
});

test('native Cloudflare verification requires no webhook bridge and supports one-use code',async()=>{
 const email=mailer(),x=await fixture(email);
 try{
  const login=await x.req('/api/v1/auth/login',{email:'owner@example.test',password:pwd});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const sent=await x.req('/api/v1/auth/email/request',{},cookie);
  assert.equal(sent.status,200,await sent.clone().text());
  assert.equal(email.sent.length,1);
  assert.equal(email.sent[0].to,'owner@example.test');
  const token=email.sent[0].text.match(/#token=([a-f0-9]{64})/)?.[1];
  assert.ok(token);
  assert.equal((await x.req('/api/v1/auth/email/verify',{token})).status,200);
  assert.equal((await x.req('/api/v1/auth/email/verify',{token})).status,409);
 }finally{x.close();}
});

test('password reset mails one-use code, hides unknown accounts and revokes existing sessions',async()=>{
 const mail=mailer(),x=await fixture(mail);
 try{
  const login=await x.req('/api/v1/auth/login',{email:'owner@example.test',password:pwd});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const unknown=await x.req('/api/v1/auth/password/reset/request',{email:'not-found@example.test'});
  assert.equal(unknown.status,202);
  const request=await x.req('/api/v1/auth/password/reset/request',{email:'owner@example.test'});
  assert.equal(request.status,202,await request.clone().text());
  assert.deepEqual(await unknown.json(),await request.json(),'prevent account enumeration');
  assert.equal(mail.sent.length,1);
  const token=mail.sent[0].text.match(/#token=([a-f0-9]{64})/)?.[1];
  assert.ok(token);
  const confirm=await x.req('/api/v1/auth/password/reset/confirm',{token,password:'New-Stronger-2026-Password'});
  assert.equal(confirm.status,200,await confirm.clone().text());
  assert.equal((await x.req('/api/v1/auth/password/reset/confirm',{token,password:'New-Stronger-2026-Password'})).status,409);
  assert.equal((await x.req('/api/v1/auth/session',{},cookie)).status===200,false);
  assert.equal((await x.req('/api/v1/auth/login',{email:'owner@example.test',password:pwd})).status,401);
  assert.equal((await x.req('/api/v1/auth/login',{email:'owner@example.test',password:'New-Stronger-2026-Password'})).status,200);
 }finally{x.close();}
});

test('same email cannot request unlimited password reset links within window',async()=>{
 const mail=mailer(),x=await fixture(mail);
 try{
  const a=await x.req('/api/v1/auth/password/reset/request',{email:'owner@example.test'});
  const b=await x.req('/api/v1/auth/password/reset/request',{email:'owner@example.test'});
  assert.equal(a.status,202);assert.equal(b.status,202);
  assert.equal(mail.sent.length,1,'repeat should be throttled without account-existence clues');
 }finally{x.close();}
});

test('without paid email binding core remains self-hosted and invitations can be issued privately',async()=>{
 const x=await fixture();
 try{
  const login=await x.req('/api/v1/auth/login',{email:'owner@example.test',password:pwd});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const invite=await x.req('/api/v1/tenants/tenant/invitations',{email:'new@example.test',profileKey:'CASHIER'},cookie);
  const info=await invite.json();
  assert.equal(invite.status,201);assert.equal(info.emailSent,false);
  assert.match(info.invitationToken,/^[a-f0-9]{64}$/);
  assert.equal((await x.req('/api/v1/auth/password/reset/request',{email:'owner@example.test'})).status,503);
 }finally{x.close();}
});
