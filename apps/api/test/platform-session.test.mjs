import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createApi} from '../src/worker.mjs';
const now=Date.parse('2026-10-19T12:00:00Z'),origin='https://pdv-total.example.test',secret='private-platform-admin-token-at-least-32-characters';
test('platform admin UI uses CLI-only one-time ticket, HttpOnly session and server-side delegation',async()=>{
 const db=openLocalDatabase(),clock={value:now};
 try{
  for(const name of ['0001_identity.sql','0031_saas_access.sql','0034_platform_ui_sessions.sql'])
   db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  const api=createApi({DB:db,PLATFORM_ADMIN_TOKEN:secret,AUTH_ENABLED:'false'},{now:()=>clock.value});
  const call=(path,method='GET',body=null,headers={})=>api.fetch(new Request(origin+path,{method,
    headers:{...headers,...(!['GET','HEAD'].includes(method)?{origin}:{}),...(body?{'content-type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})}));
  const unauthorized=await call('/api/v1/platform/ticket','POST',{});
  assert.equal(unauthorized.status,403);
  const issued=await call('/api/v1/platform/ticket','POST',{}, {authorization:'Bearer '+secret});
  assert.equal(issued.status,201,await issued.clone().text());
  const ticket=(await issued.json()).ticket;
  assert.match(ticket,/^[a-f0-9]{64}$/);
  assert.equal((await call('/api/v1/platform/ui/summary')).status,401);
  const exchange=await call('/api/v1/platform/auth/exchange','POST',{ticket});
  assert.equal(exchange.status,200,await exchange.clone().text());
  assert.match(exchange.headers.get('set-cookie'),/HttpOnly/);
  assert.match(exchange.headers.get('set-cookie'),/Secure/);
  assert.equal((await call('/api/v1/platform/auth/exchange','POST',{ticket})).status,401);
  const cookie=exchange.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/v1/platform/ui/me','GET',null,{cookie})).status,200);
  const metrics=await call('/api/v1/platform/ui/summary','GET',null,{cookie});
  assert.equal(metrics.status,200,await metrics.clone().text());
  assert.equal((await metrics.json()).summary.totalTenants,0);
  assert.equal((await call('/api/v1/platform/ui/bootstrap','POST',{}, {cookie})).status,404);
  assert.equal((await call('/api/v1/platform/auth/logout','POST',{}, {cookie})).status,200);
  assert.equal((await call('/api/v1/platform/ui/me','GET',null,{cookie})).status,401);
 }finally{db.close();}
});
test('one-time admin ticket cannot be exchanged after expiry',async()=>{
 const db=openLocalDatabase(),clock={value:now};
 try{
  for(const name of ['0001_identity.sql','0031_saas_access.sql','0034_platform_ui_sessions.sql'])
   db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  const api=createApi({DB:db,PLATFORM_ADMIN_TOKEN:secret,AUTH_ENABLED:'false'},{now:()=>clock.value});
  const issue=await api.fetch(new Request(origin+'/api/v1/platform/ticket',{method:'POST',headers:{origin,authorization:'Bearer '+secret,'content-type':'application/json'},body:'{}'}));
  const {ticket}=await issue.json();clock.value+=300001;
  const request=new Request(origin+'/api/v1/platform/auth/exchange',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({ticket})});
  assert.equal((await api.fetch(request)).status,401);
 }finally{db.close();}
});
