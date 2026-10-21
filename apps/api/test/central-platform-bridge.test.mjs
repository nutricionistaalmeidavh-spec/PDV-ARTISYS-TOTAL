import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createApi} from '../src/worker.mjs';
import {tenantWriteAllowed} from '../src/saas-control.mjs';

const origin='https://pdv-total.example.test',secret='private-bridge-secret-unique-to-pdv-admin-2026';
const OLD='existing-legacy-platform-admin-token-2026-xyz';
const NOW=Date.parse('2026-10-20T12:00:00.000Z');
async function fixture(config={}){
 const db=openLocalDatabase();
 for(const file of ['0001_identity.sql','0030_public_registration.sql','0031_saas_access.sql','0033_p2_account_security.sql','0034_platform_ui_sessions.sql','0035_password_resets.sql','0036_central_platform_bridge.sql','0041_central_owner_licenses.sql'])
  db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const api=createApi({DB:db,AUTH_ENABLED:'false',PLATFORM_ADMIN_TOKEN:OLD,ARTISYS_PLATFORM_CENTRAL_ENABLED:'true',
  ARTISYS_PLATFORM_BRIDGE_SECRET:secret,...config},{now:()=>NOW});
 const sign=async(body,ts=NOW,nonce=crypto.randomUUID())=>{
  const input=String(ts)+'.'+nonce+'.'+body;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(input)))).map(n=>n.toString(16).padStart(2,'0')).join('');
  return {headers:{'content-type':'application/json','x-artisys-platform-timestamp':String(ts),
    'x-artisys-platform-nonce':nonce,'x-artisys-platform-signature':'sha256='+sig},body};
 };
 return {db,api,sign,close:()=>db.close()};
}
test('central admin uses signed bridge and only PDV retains tenant records',async()=>{
 const x=await fixture();
 try{
  const req=async action=>{
   const signed=await x.sign(JSON.stringify(action));
   return x.api.fetch(new Request(origin+'/api/v1/integrations/artisys/platform',{method:'POST',...signed}));
  };
  assert.equal((await req({action:'summary'})).status,200);
  const boot=await req({action:'bootstrap',data:{email:'admin@example.test',ownerName:'Proprietario',password:'TestingStrongPassword2026!',slug:'pdv-store',name:'PDV Loja'}});
  assert.equal(boot.status,201,await boot.clone().text());
  const {tenantId}=await boot.json();
  const tenants=await req({action:'tenants'});
  assert.equal(tenants.status,200);
  assert.ok((await tenants.json()).tenants.some(t=>t.id===tenantId));
  assert.equal((await req({action:'audit'})).status,200);
  assert.equal((await req({action:'approve',tenantId:'fake'})).status,404);
  assert.equal((await req({action:'subscription',tenantId,status:'ACTIVE',planKey:'monthly'})).status,403,
   'central admin bridge cannot override verified payments or paid access');
  assert.equal((await x.api.fetch(new Request(origin+'/api/v1/platform/summary',{headers:{authorization:'Bearer '+OLD}}))).status,404,
   'legacy platform admin is disabled after central cutover');
  assert.equal((await x.api.fetch(new Request(origin+'/api/v1/platform/ticket',{method:'POST',headers:{origin,authorization:'Bearer '+OLD}}))).status,404);
 }finally{x.close();}
});
test('first company generates its internal identifier from an accented business name',async()=>{
 const x=await fixture();
 try{
  const signed=await x.sign(JSON.stringify({action:'bootstrap',data:{email:'owner@example.test',ownerName:'Pessoa Proprietaria',password:'TestingStrongPassword2026!',name:'Burguerzão'}}));
  const response=await x.api.fetch(new Request(origin+'/api/v1/integrations/artisys/platform',{method:'POST',...signed}));
  assert.equal(response.status,201,await response.clone().text());
  const {tenantId}=await response.json();
  const company=await x.db.prepare('SELECT slug,name FROM tenants WHERE id=?').bind(tenantId).first();
  assert.equal(company.slug,'burguerzao');
  assert.equal(company.name,'Burguerzão');
 }finally{x.close();}
});

test('first company reports the specific invalid field without creating records',async()=>{
 const x=await fixture();
 try{
  const valid={email:'owner@example.test',ownerName:'Pessoa Proprietaria',password:'TestingStrongPassword2026!',name:'Burguerzão'};
  for(const [patch,message] of [
   [{email:'owner@gmail'},'Informe um e-mail completo, como nome@gmail.com.'],
   [{ownerName:''},'Informe o nome do proprietário (até 100 caracteres).'],
   [{name:''},'Informe o nome do estabelecimento (até 100 caracteres).'],
   [{password:'short'},'A senha inicial deve ter entre 12 e 256 caracteres.']
  ]){
   const signed=await x.sign(JSON.stringify({action:'bootstrap',data:{...valid,...patch}}));
   const response=await x.api.fetch(new Request(origin+'/api/v1/integrations/artisys/platform',{method:'POST',...signed}));
   assert.equal(response.status,400);
   assert.equal((await response.json()).error,message);
  }
  assert.equal((await x.db.prepare('SELECT COUNT(*) AS n FROM tenants').bind().first()).n,0);
 }finally{x.close();}
});

test('central bridge rejects requests without signature, tampering, stale time, replay, browser origin and unknown actions',async()=>{
 const x=await fixture();
 try{
  const endpoint=origin+'/api/v1/integrations/artisys/platform',body=JSON.stringify({action:'summary'});
  assert.equal((await x.api.fetch(new Request(endpoint,{method:'POST',body}))).status,403);
  const s=await x.sign(body);
  assert.equal((await x.api.fetch(new Request(endpoint,{method:'POST',...s,headers:{...s.headers,origin}}))).status,403);
  assert.equal((await x.api.fetch(new Request(endpoint,{method:'POST',...s,body:JSON.stringify({action:'tenants'})}))).status,403);
  const valid=await x.api.fetch(new Request(endpoint,{method:'POST',...s}));
  assert.equal(valid.status,200,await valid.clone().text());
  assert.equal((await x.api.fetch(new Request(endpoint,{method:'POST',...s}))).status,409);
  const stale=await x.sign(body,NOW-300001);
  assert.equal((await x.api.fetch(new Request(endpoint,{method:'POST',...stale}))).status,403);
  const unknown=await x.sign(JSON.stringify({action:'subscription'}));
  assert.equal((await x.api.fetch(new Request(endpoint,{method:'POST',...unknown}))).status,403);
 }finally{x.close();}
});
test('bridge flag and secret fail closed without breaking the preexisting admin before migration',async()=>{
 const x=await fixture({ARTISYS_PLATFORM_CENTRAL_ENABLED:'false',ARTISYS_PLATFORM_BRIDGE_ENABLED:'false'});
 try{
  const s=await x.sign(JSON.stringify({action:'summary'}));
  assert.equal((await x.api.fetch(new Request(origin+'/api/v1/integrations/artisys/platform',{method:'POST',...s}))).status,404);
  assert.equal((await x.api.fetch(new Request(origin+'/api/v1/platform/summary',{headers:{authorization:'Bearer '+OLD}}))).status,200);
 }finally{x.close();}
 const y=await fixture({ARTISYS_PLATFORM_BRIDGE_SECRET:''});
 try{
  const s=await y.sign(JSON.stringify({action:'summary'}));
  assert.equal((await y.api.fetch(new Request(origin+'/api/v1/integrations/artisys/platform',{method:'POST',...s}))).status,503);
  assert.equal((await y.api.fetch(new Request(origin+'/api/v1/platform/summary',{headers:{authorization:'Bearer '+OLD}}))).status,404);
 }finally{y.close();}
});

test('production flags persist through Wrangler deploy while legacy admin cutover remains gated',()=>{
 const raw=readFileSync(new URL('../../../wrangler.jsonc',import.meta.url),'utf8');
 const config=JSON.parse(raw.replace(/^\s*\/\/.*$/gm,''));
 assert.equal(config.vars.AUTH_ENABLED,'true');
 assert.equal(config.vars.ARTISYS_BILLING_ENABLED,'true');
 assert.equal(config.vars.ARTISYS_PLATFORM_BRIDGE_ENABLED,'true');
 assert.equal(config.vars.ARTISYS_PLATFORM_CENTRAL_ENABLED,'false');
 assert.equal(config.vars.REGISTRATION_ENABLED,'false');
 assert.equal(config.vars.EMAIL_VERIFICATION_REQUIRED,'false');
 assert.equal(config.d1_databases[0].database_name,'pdv-artisys-total');
});


test('admin grants owner license by e-mail, emails a 48h one-use password link and never falsifies Asaas payment',async()=>{
 const sent=[];
 const x=await fixture({SAAS_ENTITLEMENTS_ENABLED:'true',EMAIL_FROM:'welcome@artisys.dev',
  EMAIL:{send:async message=>{sent.push(message);return {messageId:'test-email-1'};}}});
 try{
  const req=async action=>{
   const signed=await x.sign(JSON.stringify(action));
   return x.api.fetch(new Request(origin+'/api/v1/integrations/artisys/platform',{method:'POST',...signed}));
  };
  const grant=await req({action:'owner-license',data:{email:'buyer@example.test',businessName:'Lanchonete Exemplo',days:30,reason:'Liberação comercial manual verificada'}});
  assert.equal(grant.status,201,await grant.clone().text());
  const body=await grant.json();
  assert.equal(body.email,'buyer@example.test');
  assert.equal(sent.length,1);
  assert.match(sent[0].text,/recuperar-senha\/\#token=/);
  const tenant=await x.db.prepare('SELECT name,active FROM tenants WHERE id=?').bind(body.tenantId).first();
  assert.equal(tenant.name,'Lanchonete Exemplo');assert.equal(tenant.active,1);
  const subscription=await x.db.prepare('SELECT plan_key AS plan,status FROM saas_subscriptions WHERE tenant_id=?').bind(body.tenantId).first();
  assert.equal(subscription.status,'CANCELLED');
  assert.equal(subscription.plan,'manual');
  const manual=await x.db.prepare('SELECT active,expires_at AS expiresAt,owner_email AS email,owner_user_id AS ownerId FROM saas_admin_licenses WHERE tenant_id=?').bind(body.tenantId).first();
  assert.equal(await tenantWriteAllowed(x.db,body.tenantId,{SAAS_ENTITLEMENTS_ENABLED:'true'},NOW),true);
  assert.equal(manual.active,1);assert.equal(manual.expiresAt,body.expiresAt);
  assert.equal(manual.email,'buyer@example.test');
  const user=await x.db.prepare("SELECT u.id FROM users u JOIN tenant_memberships m ON m.user_id=u.id WHERE m.tenant_id=? AND m.profile_key='OWNER'").bind(body.tenantId).first();
  const reset=await x.db.prepare('SELECT expires_at AS until FROM saas_password_resets WHERE user_id=?').bind(user.id).first();
  assert.equal(reset.until,NOW+48*3600000);
  const list=await (await req({action:'tenants'})).json();
  assert.equal(list.tenants.find(t=>t.id===body.tenantId).manualLicenseActive,true);
  assert.equal((await req({action:'revoke-license',tenantId:body.tenantId})).status,200);
  assert.equal((await x.db.prepare('SELECT active FROM saas_admin_licenses WHERE tenant_id=?').bind(body.tenantId).first()).active,0);
  assert.equal(await tenantWriteAllowed(x.db,body.tenantId,{SAAS_ENTITLEMENTS_ENABLED:'true'},NOW),false);
  const events=await (await req({action:'audit'})).json();
  assert.ok(events.events.some(e=>e.kind==='OWNER_LICENSE_GRANTED'));
  assert.ok(events.events.some(e=>e.kind==='OWNER_LICENSE_REVOKED'));
 }finally{x.close();}
});
test('manual license cannot be granted without e-mail transport and rejects invalid durations',async()=>{
 const x=await fixture();
 try{
  const req=async data=>{
   const signed=await x.sign(JSON.stringify({action:'owner-license',data}));
   return x.api.fetch(new Request(origin+'/api/v1/integrations/artisys/platform',{method:'POST',...signed}));
  };
  const valid={email:'buyer@example.test',days:30,reason:'Liberação manual testada'};
  assert.equal((await req(valid)).status,503);
  assert.equal((await req({...valid,days:-1})).status,400);
  assert.equal((await x.db.prepare('SELECT COUNT(*) AS n FROM users').bind().first()).n,0);
 }finally{x.close();}
});
