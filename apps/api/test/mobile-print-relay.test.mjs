import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createApi} from '../src/worker.mjs';
import {hashPassword} from '../src/password.mjs';

const origin='https://relay.test',now=Date.parse('2026-10-23T12:00:00Z');
async function setup(){
 const db=openLocalDatabase(),folder=new URL('../migrations/',import.meta.url);
 for(const name of readdirSync(folder).filter(x=>/^\d{4}.*\.sql$/.test(x)).sort())db.exec(readFileSync(new URL(name,folder),'utf8'));
 const pw=await hashPassword('SecurePassword2026!'),stamp=new Date(now).toISOString();
 for(const [id,email] of [['owner','owner@relay.test'],['cashier','cashier@relay.test'],['other','other@relay.test']])
  await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').bind(id,email,id,pw,stamp).run();
 for(const t of ['a','b']){
  await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind(t,'relay-'+t,'Store '+t,stamp).run();
  await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)').bind('branch-'+t,t,'MAIN','Main',stamp).run();
 }
 for(const [t,u,role] of [['a','owner','OWNER'],['a','cashier','CASHIER'],['b','other','OWNER']])
  await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)').bind(t,u,role,stamp).run();
 const api=createApi({DB:db,AUTH_ENABLED:'true'},{now:()=>now});
 const call=async(path,{method='GET',cookie,token,body,withOrigin=true}={})=>{
  const headers={};if(cookie)headers.cookie=cookie;
  if(token)headers.authorization='Bearer '+token;
  if(method!=='GET'&&withOrigin)headers.origin=origin;
  if(body!==undefined)headers['content-type']='application/json';
  const r=await api.fetch(new Request(origin+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}));
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
 };
 const login=async(email)=>(await call('/api/v1/auth/login',{method:'POST',body:{email,password:'SecurePassword2026!'}})).cookie;
 const owner=await login('owner@relay.test'),cashier=await login('cashier@relay.test'),other=await login('other@relay.test');
 const saleId='sale-mobile-1';
 await db.prepare("INSERT INTO sales(id,tenant_id,branch_id,operator_id,sale_number,status,created_at) VALUES(?,?,?,?,?,'OPEN',?)")
  .bind(saleId,'a','branch-a','owner','1001',stamp).run();
 await db.prepare("UPDATE sales SET status='COMPLETED',completed_at=? WHERE id=?").bind(stamp,saleId).run();
 const apiPath=(section,tenant='a')=>'/api/v1/tenants/'+tenant+'/printing/remote/'+section;
 return {db,call,apiPath,owner,cashier,other,saleId,close:()=>db.close()};
}
test('phase 5: owner can register PC only in own branch, cashier cannot mint agent token',async()=>{
 const x=await setup();try{
  const p=x.apiPath('agents');
  assert.equal((await x.call(p,{cookie:x.cashier,method:'POST',body:{branchId:'branch-a',label:'PC 1'}})).status,403);
  assert.equal((await x.call(p,{cookie:x.other,method:'POST',body:{branchId:'branch-a',label:'PC 1'}})).status,404);
  const enrolled=await x.call(p,{cookie:x.owner,method:'POST',body:{branchId:'branch-a',label:'PC Caixa'}});
  assert.equal(enrolled.status,201,JSON.stringify(enrolled.data));
  assert.match(enrolled.data.token,/^[a-f0-9]{64}$/);
  const list=await x.call(p+'?branchId=branch-a',{cookie:x.cashier});
  assert.equal(list.status,200);
  assert.equal(list.data.agents[0].id,enrolled.data.agent.id);
  assert.equal(JSON.stringify(list.data).includes(enrolled.data.token),false);
  assert.equal((await x.call(x.apiPath('agents','b')+'?branchId=branch-b',{cookie:x.other})).data.agents.length,0);
 }finally{x.close();}
});
test('phase 5: authorized mobile queues canonical completed receipt, PC claims once, accepted spool != paper',async()=>{
 const x=await setup();try{
  const agent=(await x.call(x.apiPath('agents'),{cookie:x.owner,method:'POST',body:{branchId:'branch-a',label:'PC Fila'}})).data;
  const p=x.apiPath('jobs'),payload={branchId:'branch-a',agentId:agent.agent.id,saleId:x.saleId};
  const first=await x.call(p,{cookie:x.cashier,method:'POST',body:payload});
  assert.equal(first.status,201,JSON.stringify(first.data));
  assert.equal(first.data.job.status,'PENDING');
  const repeated=await x.call(p,{cookie:x.cashier,method:'POST',body:payload});
  assert.equal(repeated.data.job.id,first.data.job.id,'first copy dedupes across mobile terminals');
  assert.equal((await x.call(p,{cookie:x.other,method:'POST',body:{...payload,branchId:'branch-b'}})).status,404);
  const next=await x.call('/api/v1/print-relay/agent/next',{method:'POST',token:agent.token,body:{},withOrigin:false});
  assert.equal(next.status,200,JSON.stringify(next.data));
  assert.equal(next.data.job.id,first.data.job.id);
  assert.match(next.data.job.text,/CUPOM NAO FISCAL/);
  assert.equal((await x.call('/api/v1/print-relay/agent/next',{method:'POST',token:agent.token,body:{},withOrigin:false})).data.job,null);
  const ack=await x.call('/api/v1/print-relay/agent/ack',{method:'POST',token:agent.token,withOrigin:false,
    body:{jobId:next.data.job.id,leaseToken:next.data.job.leaseToken,status:'SUBMITTED'}});
  assert.equal(ack.status,200,JSON.stringify(ack.data));
  assert.equal(ack.data.job.status,'SUBMITTED');
  assert.equal(ack.data.job.physicallyPrinted,false);
  const history=await x.call(p+'?branchId=branch-a',{cookie:x.cashier});
  assert.equal(history.data.jobs[0].status,'SUBMITTED');
  const replay=await x.call('/api/v1/print-relay/agent/ack',{method:'POST',token:agent.token,withOrigin:false,
    body:{jobId:next.data.job.id,leaseToken:next.data.job.leaseToken,status:'SUBMITTED'}});
  assert.equal(replay.status,200,'acknowledgment may be retried safely');
 }finally{x.close();}
});
test('phase 5/6: revocation blocks PC and cross-branch print, failures do not auto retry',async()=>{
 const x=await setup();try{
  const enroll=await x.call(x.apiPath('agents'),{cookie:x.owner,method:'POST',body:{branchId:'branch-a',label:'PC'}});
  const {agent,token}=enroll.data;
  assert.equal((await x.call('/api/v1/print-relay/agent/next',{method:'POST',token:'a'.repeat(64),body:{},withOrigin:false})).status,401);
  assert.equal((await x.call(x.apiPath('jobs'),{cookie:x.cashier,method:'POST',body:{branchId:'branch-a',agentId:agent.id,saleId:'not-a-sale'}})).status,404);
  const sent=await x.call(x.apiPath('jobs'),{cookie:x.cashier,method:'POST',body:{branchId:'branch-a',agentId:agent.id,saleId:x.saleId}});
  const claim=await x.call('/api/v1/print-relay/agent/next',{method:'POST',token,body:{},withOrigin:false});
  const badAck=await x.call('/api/v1/print-relay/agent/ack',{method:'POST',token,body:{jobId:sent.data.job.id,leaseToken:'b'.repeat(64),status:'SUBMITTED'},withOrigin:false});
  assert.equal(badAck.status,409);
  await x.call('/api/v1/print-relay/agent/ack',{method:'POST',token,body:{jobId:claim.data.job.id,leaseToken:claim.data.job.leaseToken,status:'FAILED',error:'Printer offline'},withOrigin:false});
  const again=await x.call('/api/v1/print-relay/agent/next',{method:'POST',token,body:{},withOrigin:false});
  assert.equal(again.data.job,null);
  const revoke=await x.call(x.apiPath('agents/'+agent.id),{cookie:x.owner,method:'DELETE',body:{branchId:'branch-a'}});
  assert.equal(revoke.status,200);
  assert.equal((await x.call('/api/v1/print-relay/agent/next',{method:'POST',token,body:{},withOrigin:false})).status,401);
 }finally{x.close();}
});
