import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {applyLocalMigrations} from '../src/local-migrations.mjs';
import {createApi} from '../src/worker.mjs';
import {tenantWriteAllowed} from '../src/saas-control.mjs';

const origin='https://pdv.artisys.dev';
const NOW=Date.parse('2026-10-23T12:00:00.000Z');
const secret='private-commercial-bridge-secret-2026-123456';
const buyer={displayName:'Ana Compradora',businessName:'Café da Ana',email:'ana+trial@example.test',password:'SenhaSeguraComLetras2026!'};

async function fixture({failEmail=false}={}){
 const db=openLocalDatabase();
 await applyLocalMigrations(db);
 const sent=[];
 const env={
  DB:db,AUTH_ENABLED:'true',REGISTRATION_ENABLED:'true',
  TRUST_CF_CONNECTING_IP:'true',SAAS_ENTITLEMENTS_ENABLED:'true',
  ARTISYS_PLATFORM_CENTRAL_ENABLED:'true',ARTISYS_PLATFORM_BRIDGE_ENABLED:'true',
  ARTISYS_PLATFORM_BRIDGE_SECRET:secret,EMAIL_FROM:'welcome@artisys.dev',
  EMAIL:{send:async m=>{
   if(failEmail)throw Error('simulated transport failure');
   sent.push(m);return {messageId:'mail-'+sent.length};
  }}
 };
 const api=createApi(env,{now:()=>NOW});
 const post=(path,data,headers={})=>api.fetch(new Request(origin+path,{
  method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(data)
 }));
 const central=async (payload)=>{
  const timestamp=String(NOW),nonce=crypto.randomUUID(),body=JSON.stringify(payload);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sign=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+nonce+'.'+body)));
  const signature=[...sign].map(x=>x.toString(16).padStart(2,'0')).join('');
  return api.fetch(new Request(origin+'/api/v1/integrations/artisys/platform',{method:'POST',
   headers:{'content-type':'application/json','x-artisys-platform-timestamp':timestamp,
    'x-artisys-platform-nonce':nonce,'x-artisys-platform-signature':'sha256='+signature},
   body
  }));
 };
 return {db,env,api,sent,post,central,close:()=>db.close()};
}

test('production opt-in and landing invite users to request a reviewed 14-day trial, not immediate unapproved access',()=>{
 const raw=readFileSync(new URL('../../../wrangler.jsonc',import.meta.url),'utf8');
 const config=JSON.parse(raw.replace(/^\s*\/\/.*$/gm,''));
 assert.equal(config.vars.REGISTRATION_ENABLED,'true');
 assert.equal(config.vars.TENANT_SELF_SIGNUP_ENABLED,'false');
 const html=readFileSync(new URL('../../../apps/landing/index.html',import.meta.url),'utf8');
 assert.match(html,/Solicitar teste grátis/);
 assert.match(html,/14 dias/);
 assert.match(html,/aprovação da ArtiSys/i);
 const js=readFileSync(new URL('../../../apps/landing/landing.js',import.meta.url),'utf8');
 assert.match(js,/fetch\('\/api\/v1\/auth\/register'/);
 assert.match(js,/credentials:'same-origin'/);
});

test('landing request → signed ArtiSys approval → new 14-day trial → existing owner login and monthly license',async()=>{
 const x=await fixture();
 try{
  const register=await x.post('/api/v1/auth/register',buyer,{'cf-connecting-ip':'198.51.100.10'});
  assert.equal(register.status,202,await register.clone().text());
  const tenant=await x.db.prepare('SELECT id,active FROM tenants WHERE name=?').bind(buyer.businessName).first();
  assert.equal(tenant.active,0);
  assert.equal((await x.post('/api/v1/auth/login',{email:buyer.email,password:buyer.password})).status,403);
  assert.equal(await tenantWriteAllowed(x.db,tenant.id,x.env,NOW),false);
  assert.equal(x.sent.length,0);

  const pending=await x.central({action:'tenants'});
  assert.equal(pending.status,200);
  const listings=(await pending.json()).pendingTenants;
  assert.equal(listings.filter(t=>t.id===tenant.id).length,1);
  const approved=await x.central({action:'approve',tenantId:tenant.id});
  assert.equal(approved.status,200,await approved.clone().text());
  const approvedData=await approved.json();
  assert.equal(approvedData.approved,true);
  assert.equal(approvedData.emailSent,true);
  assert.equal(approvedData.trialEndsAt,new Date(NOW+14*86400000).toISOString());
  assert.equal(x.sent.length,1);
  assert.equal(x.sent[0].to,buyer.email);
  assert.match(x.sent[0].text,/14 dias/);
  assert.match(x.sent[0].text,/https:\/\/pdv\.artisys\.dev\/app\//);

  const duplicate=await x.central({action:'approve',tenantId:tenant.id});
  assert.equal(duplicate.status,409);
  assert.equal(x.sent.length,1);
  const subscription=await x.db.prepare('SELECT status,plan_key AS planKey,ends_at AS endsAt FROM saas_subscriptions WHERE tenant_id=?').bind(tenant.id).first();
  assert.equal(subscription.status,'TRIAL');
  assert.equal(subscription.planKey,'trial');
  assert.equal(subscription.endsAt,approvedData.trialEndsAt);
  assert.equal(await tenantWriteAllowed(x.db,tenant.id,x.env,NOW),true);
  assert.equal(await tenantWriteAllowed(x.db,tenant.id,x.env,NOW+14*86400000),false);
  assert.equal((await x.post('/api/v1/auth/login',{email:buyer.email,password:buyer.password})).status,200);

  const grant=await x.central({action:'owner-license',data:{email:buyer.email,months:1,reason:'Contrato ArtiSys aprovado para o estabelecimento'}});
  assert.equal(grant.status,201,await grant.clone().text());
  const manual=await grant.json();
  assert.equal(manual.tenantId,tenant.id,'do not create another tenant for the same owner');
  assert.equal(manual.emailSent,true);
  assert.equal(manual.expiresAt,'2026-11-23T12:00:00.000Z');
  assert.equal((await x.db.prepare('SELECT COUNT(*) AS n FROM tenants').bind().first()).n,1);
  assert.equal(x.sent.length,2);
  assert.match(x.sent[1].text,/recuperar-senha\/#token=/);
  assert.equal(await tenantWriteAllowed(x.db,tenant.id,x.env,NOW+15*86400000),true);
 }finally{x.close();}
});

test('approval remains committed and returns emailSent=false when transactional email transport fails',async()=>{
 const x=await fixture({failEmail:true});
 try{
  assert.equal((await x.post('/api/v1/auth/register',buyer)).status,202);
  const tenant=await x.db.prepare('SELECT id FROM tenants').bind().first();
  const approved=await x.central({action:'approve',tenantId:tenant.id});
  assert.equal(approved.status,200);
  assert.equal((await approved.json()).emailSent,false);
  assert.equal(await tenantWriteAllowed(x.db,tenant.id,x.env,NOW),true);
  assert.equal((await x.post('/api/v1/auth/login',{email:buyer.email,password:buyer.password})).status,200);
 }finally{x.close();}
});
