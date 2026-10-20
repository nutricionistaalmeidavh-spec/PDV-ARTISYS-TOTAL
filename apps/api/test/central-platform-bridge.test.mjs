import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createApi} from '../src/worker.mjs';

const origin='https://pdv-total.example.test',secret='private-bridge-secret-unique-to-pdv-admin-2026';
const OLD='existing-legacy-platform-admin-token-2026-xyz';
const NOW=Date.parse('2026-10-20T12:00:00.000Z');
async function fixture(config={}){
 const db=openLocalDatabase();
 for(const file of ['0001_identity.sql','0030_public_registration.sql','0031_saas_access.sql','0034_platform_ui_sessions.sql','0036_central_platform_bridge.sql'])
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
