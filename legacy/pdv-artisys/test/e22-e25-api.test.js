'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

async function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-e22-e25-api-'));let seq=0;const runtime=createPdvRuntime({dbPath:path.join(dir,'pdv.sqlite'),idFactory:p=>`${p}-${++seq}`,appVersion:'0.9.0',serverVersion:'0.9.0'});
 runtime.catalog.createUser({id:'admin1',username:'admin',name:'Admin',profileId:'profile-administrator',password:'senha-forte-123'});
 const server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'install'});const address=await server.start();const base=`http://${address.host}:${address.port}`;
 const login=await fetch(`${base}/api/v1/auth/login`,{method:'POST',headers:{'content-type':'application/json','x-pdv-token':'install'},body:JSON.stringify({username:'admin',password:'senha-forte-123',terminalId:'PDV-01'})});const token=(await login.json()).sessionToken;
 const req=async (url,options={})=>{const response=await fetch(`${base}${url}`,{...options,headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...(options.headers||{})}});let body=null;const text=await response.text();if(text)body=JSON.parse(text);return{status:response.status,body};};
 return{dir,runtime,server,req,async close(){await server.stop();runtime.close();fs.rmSync(dir,{recursive:true,force:true});}};
}

test('runtime exposes E22-E25 operational services',async()=>{const ctx=await fixture();try{
 assert.ok(ctx.runtime.backups);assert.ok(ctx.runtime.settings);assert.ok(ctx.runtime.imports);assert.ok(ctx.runtime.logger);assert.ok(ctx.runtime.health);assert.ok(ctx.runtime.diagnostics);
}finally{await ctx.close();}});

test('backup settings and import API are authenticated operational workflows',async()=>{const ctx=await fixture();try{
 let r=await ctx.req('/api/v1/settings/store.name',{method:'PUT',body:JSON.stringify({scope:'global',value:'Loja API'})});assert.equal(r.status,200);assert.equal(r.body.value,'Loja API');
 r=await ctx.req('/api/v1/settings?scope=global');assert.equal(r.status,200);assert.equal(r.body.some(x=>x.key==='store.name'),true);
 r=await ctx.req('/api/v1/backups',{method:'POST',body:JSON.stringify({reason:'manual-api'})});assert.equal(r.status,201);assert.equal(r.body.valid,true);const backupId=r.body.id;
 r=await ctx.req('/api/v1/backups');assert.equal(r.status,200);assert.equal(r.body.length,1);
 r=await ctx.req(`/api/v1/backups/${encodeURIComponent(backupId)}/validate`,{method:'POST',body:'{}'});assert.equal(r.status,200);assert.equal(r.body.valid,true);
 const csv='sku;name;salePriceCents;costCents\nP001;Produto API;1290;500';
 r=await ctx.req('/api/v1/imports/preview',{method:'POST',body:JSON.stringify({type:'products',format:'csv',content:csv,collisionPolicy:'CREATE'})});assert.equal(r.status,201);assert.equal(r.body.summary.invalid,0);const batchId=r.body.batchId;
 r=await ctx.req(`/api/v1/imports/${batchId}/commit`,{method:'POST',body:'{}'});assert.equal(r.status,200);assert.equal(r.body.status,'COMMITTED');assert.equal(ctx.runtime.catalog.listProducts().some(p=>p.sku==='P001'),true);
}finally{await ctx.close();}});

test('audit health logs and diagnostics endpoints expose sanitized support data',async()=>{const ctx=await fixture();try{
 ctx.runtime.logger.log({level:'error',subsystem:'test',message:'controlled',context:{token:'never',ok:true}});
 let r=await ctx.req('/api/v1/system/health');assert.equal(r.status,200);assert.equal(r.body.database.ok,true);assert.ok(r.body.schemaVersion>=3);
 r=await ctx.req('/api/v1/system/logs?level=error');assert.equal(r.status,200);assert.equal(JSON.stringify(r.body).includes('never'),false);assert.equal(r.body[0].context.ok,true);
 r=await ctx.req('/api/v1/audit?action=settings.update');assert.equal(r.status,200);assert.ok(r.body.length>=0);
 r=await ctx.req('/api/v1/system/diagnostics',{method:'POST',body:'{}'});assert.equal(r.status,201);assert.equal(r.body.sha256.length,64);assert.equal('filePath' in r.body,false);assert.ok(fs.existsSync(path.join(ctx.dir,'diagnostics',r.body.fileName)));
}finally{await ctx.close();}});
