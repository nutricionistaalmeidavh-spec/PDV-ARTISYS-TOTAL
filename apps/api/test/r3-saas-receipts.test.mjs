import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createApi} from '../src/worker.mjs';
import {hashPassword} from '../src/password.mjs';

const origin='https://pdv-r3-saas.test',NOW=Date.parse('2026-10-18T12:00:00Z');
const pass='R3TestingPasswordStrong#123';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZfWQAAAAASUVORK5CYII=';
async function setup(){
 const db=openLocalDatabase();
 const url=new URL('../migrations/',import.meta.url);
 const sqlFiles=readdirSync(url).filter(name=>/^\d{4}.*\.sql$/.test(name)).sort();
 for(const file of sqlFiles)db.exec(readFileSync(new URL(file,url),'utf8'));
 const hash=await hashPassword(pass);
 const stamp=new Date(NOW).toISOString();
 for(const [id,email] of [['owner','owner@r3.test'],['other','other@r3.test'],['viewer','viewer@r3.test']])
  await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').bind(id,email,id,hash,stamp).run();
 for(const t of ['a','b']){
  await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind(t,'r3-'+t,'R3 '+t,stamp).run();
  await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)').bind('branch-'+t,t,'MAIN','Matriz',stamp).run();
 }
 for(const [t,u,role] of [['a','owner','OWNER'],['b','other','OWNER'],['a','viewer','READ_ONLY']])
  await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)').bind(t,u,role,stamp).run();
 const api=createApi({DB:db,AUTH_ENABLED:'true'},{now:()=>NOW});
 const call=async(path,{cookie,method='GET',body}={})=>{
  const headers={};if(cookie)headers.cookie=cookie;
  if(method!=='GET')headers.origin=origin;
  if(body!==undefined)headers['content-type']='application/json';
  const response=await api.fetch(new Request(origin+path,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})}));
  return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 };
 const login=async(email)=>(await call('/api/v1/auth/login',{method:'POST',body:{email,password:pass}})).cookie;
 const owner=await login('owner@r3.test'),other=await login('other@r3.test'),viewer=await login('viewer@r3.test');
 return {db,call,owner,other,viewer,close:()=>db.close(),stamp};
}
const apiPath=(tenant,branch,section)=>'/api/v1/tenants/'+tenant+'/'+section+'?branchId='+branch;

test('cap-030 immutable SaaS sale receipt keeps branding snapshot after store settings change and reprint',async()=>{
 const x=await setup();try{
  const path=apiPath('a','branch-a','printing/branding');
  let q=await x.call(path,{cookie:x.owner});
  assert.equal(q.status,200);assert.equal(q.body.branding.name,'PDV TOTAL');
  q=await x.call(path,{cookie:x.owner,method:'PUT',body:{branchId:'branch-a',name:'Loja Original',address:'Rua A',phone:'(16)1234',logoDataUrl:PNG}});
  assert.equal(q.status,200);assert.equal(q.body.branding.name,'Loja Original');
  assert.equal(q.body.branding.logoDataUrl,PNG);
  await x.db.prepare('INSERT INTO sales(id,tenant_id,branch_id,operator_id,sale_number,status,created_at) VALUES(?,?,?,?,?,?,?)').bind('sale-a','a','branch-a','owner','0001','OPEN',x.stamp).run();
  await x.db.prepare("UPDATE sales SET status='COMPLETED',completed_at=? WHERE id='sale-a'").bind(x.stamp).run();
  q=await x.call(apiPath('a','branch-a','sales/sale-a/receipt'),{cookie:x.owner});
  assert.equal(q.status,200);assert.equal(q.body.branding.name,'Loja Original');
  assert.equal(q.body.sale.status,'COMPLETED');
  assert.equal(q.body.fiscal,false);
  await x.call(path,{cookie:x.owner,method:'PUT',body:{branchId:'branch-a',name:'Loja Nova',address:'Nova rua',phone:'999',logoDataUrl:null}});
  q=await x.call(apiPath('a','branch-a','sales/sale-a/receipt'),{cookie:x.owner});
  assert.equal(q.body.branding.name,'Loja Original');
  assert.equal(q.body.branding.logoDataUrl,PNG);
  const stored=await x.db.prepare("SELECT branding_json FROM r3_sale_branding_snapshots WHERE sale_id='sale-a'").bind().first();
  assert.equal(JSON.parse(stored.branding_json).name,'Loja Original');
  await assert.rejects(x.db.prepare("DELETE FROM r3_sale_branding_snapshots WHERE sale_id='sale-a'").run(),/IMMUTABLE/);
 }finally{x.close();}
});

test('cap-030 hosted branding cannot be read across tenants or written without settings.manage',async()=>{
 const x=await setup();try{
  const pa=apiPath('a','branch-a','printing/branding');
  assert.equal((await x.call(pa,{cookie:x.viewer,method:'PUT',body:{branchId:'branch-a',name:'INTRUSO'}})).status,403);
  assert.equal((await x.call(pa,{cookie:x.other})).status,404);
  assert.equal((await x.call(apiPath('a','branch-b','printing/branding'),{cookie:x.owner})).status,404);
  assert.equal((await x.call(pa,{cookie:x.owner,method:'PUT',body:{branchId:'branch-a',name:'<script>alert(1)</script>\n Loja',logoDataUrl:'data:image/svg+xml;base64,PHN2Zz4='}})).status,400);
  assert.equal((await x.call(pa,{cookie:x.owner,method:'PUT',body:{branchId:'branch-a',name:'Loja',logoDataUrl:'data:image/png;base64,aGVsbG8='}})).status,400);
  const ok=await x.call(pa,{cookie:x.owner});
  assert.equal(ok.body.branding.name,'PDV TOTAL','invalid attempts cannot mutate branding');
 }finally{x.close();}
});

test('cap-029 prebill uses current canonical identity, while final receipt requires COMPLETED sale',async()=>{
 const x=await setup();try{
  await x.db.prepare('INSERT INTO sales(id,tenant_id,branch_id,operator_id,sale_number,status,created_at) VALUES(?,?,?,?,?,?,?)').bind('sale-open','a','branch-a','owner','0002','OPEN',x.stamp).run();
  await x.call(apiPath('a','branch-a','printing/branding'),{cookie:x.owner,method:'PUT',body:{branchId:'branch-a',name:'Cafe SaaS',address:'Av. Paulista'}});
  let v=await x.call(apiPath('a','branch-a','sales/sale-open/prebill'),{cookie:x.owner});
  assert.equal(v.status,200);assert.equal(v.body.documentType,'PREBILL');
  assert.equal(v.body.branding.name,'Cafe SaaS');
  assert.equal((await x.call(apiPath('a','branch-a','sales/sale-open/receipt'),{cookie:x.owner})).status,409);
  assert.equal((await x.call(apiPath('b','branch-b','sales/sale-open/prebill'),{cookie:x.other})).status,404);
  assert.equal((await x.call(apiPath('a','branch-a','sales/sale-open/prebill'),{cookie:x.other})).status,404);
 }finally{x.close();}
});
