import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Browser-level regression: a newly added branch sorted ahead of Matriz must
// not silently move a second cashier to another branch on login.
test('tenant login consistently selects canonical MAIN branch regardless of alphabetical order',async()=>{
 const calls=[];
 const window={
  location:{origin:'https://pdv.example.test'},
  fetch:async url=>{
   const path=new URL(url).pathname;
   calls.push(path);
   if(path==='/api/v1/tenants/tenant-qa/branches')return {
    ok:true,status:200,headers:{get:()=> 'application/json'},
    json:async()=>({branches:[
     {id:'branch-new',code:'WEBQA02',name:'Filial browser QA'},
     {id:'branch-main',code:'MAIN',name:'Matriz'}
    ]})
   };
   if(path==='/api/v1/tenants/tenant-qa/context')return {
    ok:true,status:200,headers:{get:()=> 'application/json'},
    json:async()=>({name:'Restaurante QA',profileKey:'OWNER'})
   };
   throw new Error('Unexpected '+path);
  }
 };
 runInNewContext(readFileSync(new URL('../apps/web/api-client.js',import.meta.url),'utf8'),{window,URL});
 const client=new window.PdvApiClient.ApiClient();
 const first=await client.chooseWebTenant({tenantId:'tenant-qa'});
 assert.equal(first.branch.id,'branch-main','new branch cannot unexpectedly replace the matrix');
 assert.equal(client.branchId,'branch-main');
 assert.equal(client.tenantId,'tenant-qa');
 assert.equal(calls.length,2);
});
