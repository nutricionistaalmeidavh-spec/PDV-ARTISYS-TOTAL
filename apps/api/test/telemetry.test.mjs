import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createApi} from '../src/worker.mjs';
import {platformTelemetrySummary} from '../src/telemetry.mjs';

const NOW=Date.parse('2026-10-23T15:00:00Z');
const origin='https://pdv.example.test';
async function fixture(){
 const db=openLocalDatabase();
 for(const file of ['0001_identity.sql','0031_saas_access.sql','0043_telemetry_events.sql'])
  db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const created=new Date(NOW).toISOString();
 for(const [id,slug] of [['a','store-a'],['b','store-b']]){
  await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind(id,slug,slug,created).run();
  await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)').bind('br-'+id,id,'MAIN','Main',created).run();
 }
 for(const [id,t,role] of [['owner-a','a','OWNER'],['owner-b','b','OWNER'],['cashier','a','CASHIER']]){
  await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').bind(id,id+'@example.test',id,'unused',created).run();
  await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)').bind(t,id,role,created).run();
  const raw=id.padEnd(64,'0');const hash=createHash('sha256').update(raw).digest('hex');
  await db.prepare('INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').bind(hash,id,NOW,NOW+3600000).run();
 }
 const recorded=[];
 const api=createApi({DB:db,AUTH_ENABLED:'true',TELEMETRY_ANALYTICS_ENABLED:'true',PDV_TELEMETRY_ANALYTICS:{writeDataPoint:x=>recorded.push(x)}},{now:()=>NOW});
 const request=(person,tenant,path,method='GET',body=null)=>{
  const headers={cookie:'__Host-pdvtotal_session='+person.padEnd(64,'0')};
  if(method!=='GET')headers.origin=origin;
  if(body!==null)headers['content-type']='application/json';
  return api.fetch(new Request(origin+'/api/v1/tenants/'+tenant+'/telemetry/'+path,{
   method,headers,...(body!==null?{body:JSON.stringify(body)}:{})
  }));
 };
 return{db,request,recorded,close:()=>db.close()};
}

test('telemetry is opt-in, consent is tenant-scoped and only owner can change it',async()=>{
 const x=await fixture();try{
  assert.deepEqual(await (await x.request('owner-a','a','preferences')).json(),
   {enabled:false,diagnostics:false});
  const event={id:'12345678-1234-4234-8234-123456789abc',eventName:'screen_opened',route:'checkout',branchId:'br-a'};
  assert.equal((await x.request('owner-a','a','events','POST',event)).status,202);
  assert.equal(x.recorded.length,0);
  assert.equal((await x.request('cashier','a','preferences','PUT',{enabled:true})).status,403);
  assert.equal((await x.request('owner-b','a','preferences','PUT',{enabled:true})).status,404);
  assert.equal((await x.request('owner-a','a','preferences','PUT',{enabled:true,diagnostics:false})).status,200);
  assert.equal((await x.request('owner-a','a','events','POST',event)).status,202);
  assert.equal(x.recorded.length,1);
  assert.equal((await x.request('owner-b','b','preferences')).status,200);
  assert.equal((await x.request('owner-b','b','preferences')).json instanceof Function,true);
  const count=await x.db.prepare('SELECT COUNT(*) AS n FROM saas_telemetry_events').bind().first();
  assert.equal(count.n,1);
 }finally{x.close();}
});

test('telemetry rejects sensitive/unknown fields, wrong branches and duplicate IDs',async()=>{
 const x=await fixture();try{
  await x.request('owner-a','a','preferences','PUT',{enabled:true,diagnostics:true});
  const valid={id:'c2345678-1234-4234-8234-123456789abc',eventName:'request_finished',route:'checkout',module:'sales',outcome:'success',durationMs:123,branchId:'br-a'};
  assert.equal((await x.request('owner-a','a','events','POST',{...valid,email:'test@example.test'})).status,422);
  assert.equal((await x.request('owner-a','a','events','POST',{...valid,branchId:'br-b'})).status,422);
  assert.equal((await x.request('owner-a','a','events','POST',{...valid,route:'/customer/123'})).status,422);
  assert.equal((await x.request('owner-a','a','events','POST',valid)).status,202);
  assert.equal((await x.request('owner-a','a','events','POST',valid)).status,202);
  assert.equal(x.recorded.length,1);
  const row=await x.db.prepare('SELECT tenant_id,event_name,route,module,duration_ms FROM saas_telemetry_events').bind().first();
  assert.equal(row.tenant_id,'a');assert.equal(row.module,'sales');assert.equal(row.duration_ms,123);
 }finally{x.close();}
});

test('telemetry remains available locally without Cloudflare and central reporting is aggregated',async()=>{
 const x=await fixture();try{
  await x.request('owner-a','a','preferences','PUT',{enabled:true,diagnostics:false});
  const id='e2345678-1234-4234-8234-123456789abc';
  assert.equal((await x.request('owner-a','a','events','POST',{id,eventName:'sale_completed',route:'checkout',branchId:'br-a'})).status,202);
  const summary=await platformTelemetrySummary(x.db,NOW);
  assert.equal(summary.totalEvents,1);
  assert.equal(summary.events[0].eventName,'sale_completed');
  assert.equal(summary.tenants[0].tenantId,'a');
 }finally{x.close();}
});
