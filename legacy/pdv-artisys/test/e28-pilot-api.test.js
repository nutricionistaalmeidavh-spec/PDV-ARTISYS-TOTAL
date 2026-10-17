'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

async function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-pilot-api-'));const runtime=createPdvRuntime({dbPath:path.join(dir,'pdv.sqlite')});runtime.catalog.createUser({id:'admin1',username:'admin',name:'Admin',profileId:'profile-administrator',password:'senha-forte-123'});
 const server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'install'});const addr=await server.start();const base=`http://${addr.host}:${addr.port}`;
 const login=await fetch(`${base}/api/v1/auth/login`,{method:'POST',headers:{'content-type':'application/json','x-pdv-token':'install'},body:JSON.stringify({username:'admin',password:'senha-forte-123',terminalId:'PDV-01'})});const token=(await login.json()).sessionToken;
 const req=async(url,options={})=>{const response=await fetch(`${base}${url}`,{...options,headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...(options.headers||{})}});const text=await response.text();return{status:response.status,body:text?JSON.parse(text):null};};
 return{runtime,req,async close(){await server.stop();runtime.close();fs.rmSync(dir,{recursive:true,force:true});}};
}

test('runtime and authenticated API expose persistent pilot readiness',async()=>{const ctx=await fixture();try{
 assert.ok(ctx.runtime.pilot);let r=await ctx.req('/api/v1/pilot');assert.equal(r.status,200);assert.ok(r.body.length>=12);
 r=await ctx.req('/api/v1/pilot/lan-test',{method:'PATCH',body:JSON.stringify({status:'READY',note:'LAN ok',evidence:{terminalId:'PDV-02'}})});assert.equal(r.status,200);assert.equal(r.body.status,'READY');
 r=await ctx.req('/api/v1/pilot/readiness');assert.equal(r.status,200);assert.equal(r.body.ready,false);assert.equal(r.body.status,'IN_PROGRESS');
}finally{await ctx.close();}});
