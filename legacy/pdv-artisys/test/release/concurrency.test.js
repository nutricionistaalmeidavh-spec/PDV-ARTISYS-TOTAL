'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../../js/core/pdv-runtime');

test('release gate: duplicate mutation remains canonical across restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-release-concurrency-'));const dbPath=path.join(dir,'pdv.sqlite');let calls=0;
 try{
   let runtime=createPdvRuntime({dbPath});
   const first=await Promise.all(Array.from({length:12},()=>runtime.mutations.execute({mutationId:'release-mutation-1',method:'POST',path:'/sale/complete'},async()=>{calls+=1;await new Promise(r=>setTimeout(r,5));return{statusCode:200,payload:{saleId:'S1',ok:true}};})));
   assert.equal(calls,1);assert.equal(new Set(first.map(x=>JSON.stringify(x))).size,1);runtime.close();
   runtime=createPdvRuntime({dbPath});const restarted=await runtime.mutations.execute({mutationId:'release-mutation-1',method:'POST',path:'/sale/complete'},async()=>{calls+=1;return{statusCode:500,payload:{ok:false}};});
   assert.equal(calls,1);assert.deepEqual(restarted,{statusCode:200,payload:{saleId:'S1',ok:true}});runtime.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
