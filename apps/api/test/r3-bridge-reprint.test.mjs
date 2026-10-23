import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../../web/local-bridge-client.js',import.meta.url),'utf8');

test('cap-025 first spool receipt is idempotent while manual reprint has a fresh safe identifier',async()=>{
  const store=new Map(),jobs=[];
  const root={
    sessionStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},
    crypto:{randomUUID:()=> 'f0000000-0000-4000-8000-000000000001'},
    fetch:async(_,init)=>{const body=JSON.parse(init.body);jobs.push(body);return {ok:true,json:async()=>({job:{id:body.id,status:'SUBMITTED'}})};}
  };
  runInNewContext(source,{window:root});
  root.PdvLocalBridge.pair('a'.repeat(64));
  const sale={id:'sale-r3-print',status:'COMPLETED'};
  await root.PdvLocalBridge.print(sale,'CUPOM');
  await root.PdvLocalBridge.print(sale,'CUPOM');
  await root.PdvLocalBridge.print(sale,'CUPOM',{reprint:true});
  assert.equal(jobs[0].id,jobs[1].id,'same original job must never get a second spool identity');
  assert.notEqual(jobs[0].id,jobs[2].id,'reprint must be explicit and independently auditable');
  assert.match(jobs[2].id,/^reprint-/);
  assert.equal(jobs.every(j=>j.saleId===sale.id&&j.text==='CUPOM'),true);
});


test('P3: browser pede consentimento local e recebe segredo sem digitação manual',async()=>{
 const stored=new Map(),attempts=[];
 const root={
   sessionStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},
   fetch:async(url,init)=>{
     attempts.push({url,init});
     if(url.endsWith('/v1/pair'))return {ok:true,json:async()=>({token:'e'.repeat(64)})};
     if(url.endsWith('/v1/status'))return {ok:true,json:async()=>({ready:true,service:'pdv-total-local'})};
     throw Error('unexpected');
   }
 };
 runInNewContext(source,{window:root});
 const result=await root.PdvLocalBridge.pairAutomatically();
 assert.equal(result.ready,true);
 assert.equal(root.PdvLocalBridge.pairedToken(),'e'.repeat(64));
 assert.equal(attempts[0].init.method,'POST');
 assert.equal(attempts[1].init.headers.authorization,'Bearer '+'e'.repeat(64));
});
