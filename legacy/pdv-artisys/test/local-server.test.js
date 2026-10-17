const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const { createPdvRuntime }=require('../js/core/pdv-runtime');
const { createLocalServer }=require('../server/local-server');

async function setup(options={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-server-'));let seq=0;const runtime=createPdvRuntime({dbPath:path.join(dir,'pdv.sqlite'),idFactory:p=>`${p}-${++seq}`});
  runtime.catalog.createUser({id:'admin1',username:'admin',name:'Admin',profileId:'profile-administrator',password:'senha-forte-123'});
  const server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'installation-secret',bodyLimitBytes:options.bodyLimitBytes||1024*1024});
  const address=await server.start();const base=`http://${address.host}:${address.port}`;
  return{dir,runtime,server,base,async cleanup(){await server.stop();runtime.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
async function login(base){const res=await fetch(`${base}/api/v1/auth/login`,{method:'POST',headers:{'content-type':'application/json','x-pdv-token':'installation-secret'},body:JSON.stringify({username:'admin',password:'senha-forte-123',terminalId:'pdv-01'})});assert.equal(res.status,200);return (await res.json()).sessionToken;}
function auth(token){return{authorization:`Bearer ${token}`,'content-type':'application/json'};}

test('health is public while operational routes require an authenticated session',async()=>{const ctx=await setup();try{let res=await fetch(`${ctx.base}/api/v1/health`);assert.equal(res.status,200);assert.equal((await res.json()).ok,true);res=await fetch(`${ctx.base}/api/v1/products`);assert.equal(res.status,401);res=await fetch(`${ctx.base}/api/v1/auth/login`,{method:'POST',headers:{'content-type':'application/json','x-pdv-token':'wrong'},body:JSON.stringify({username:'admin',password:'senha-forte-123'})});assert.equal(res.status,401);const token=await login(ctx.base);res=await fetch(`${ctx.base}/api/v1/products`,{headers:{authorization:`Bearer ${token}`}});assert.equal(res.status,200);}finally{await ctx.cleanup();}});

test('server rejects invalid JSON and oversized request bodies',async()=>{const ctx=await setup({bodyLimitBytes:128});try{const token=await login(ctx.base);let res=await fetch(`${ctx.base}/api/v1/products`,{method:'POST',headers:auth(token),body:'{invalid'});assert.equal(res.status,400);res=await fetch(`${ctx.base}/api/v1/products`,{method:'POST',headers:auth(token),body:JSON.stringify({name:'x'.repeat(500),salePriceCents:100})});assert.equal(res.status,413);}finally{await ctx.cleanup();}});

test('API runs product stock cash and sale flow with automatic event dispatch',async()=>{const ctx=await setup();try{const token=await login(ctx.base);let res=await fetch(`${ctx.base}/api/v1/products`,{method:'POST',headers:auth(token),body:JSON.stringify({id:'p1',sku:'1',barcode:'789',name:'Teclado',salePriceCents:10000,minimumStock:1})});assert.equal(res.status,201);res=await fetch(`${ctx.base}/api/v1/inventory/movements`,{method:'POST',headers:auth(token),body:JSON.stringify({productId:'p1',type:'opening',quantityDelta:5})});assert.equal(res.status,201);res=await fetch(`${ctx.base}/api/v1/cash/sessions`,{method:'POST',headers:{...auth(token),'x-mutation-id':'mut-cash'},body:JSON.stringify({id:'cs1',terminalId:'pdv-01',initialCashCents:10000})});assert.equal(res.status,201);res=await fetch(`${ctx.base}/api/v1/sales`,{method:'POST',headers:auth(token),body:JSON.stringify({id:'s1',saleNumber:'000001',terminalId:'pdv-01'})});assert.equal(res.status,201);res=await fetch(`${ctx.base}/api/v1/sales/s1/items`,{method:'POST',headers:auth(token),body:JSON.stringify({productId:'p1',quantity:2})});assert.equal(res.status,200);res=await fetch(`${ctx.base}/api/v1/sales/s1/complete`,{method:'POST',headers:{...auth(token),'x-mutation-id':'mut-sale'},body:JSON.stringify({payments:[{method:'CASH',amountCents:20000}]})});assert.equal(res.status,200);const completed=await res.json();assert.equal(completed.sale.status,'COMPLETED');assert.equal(completed.dispatch.failed,0);res=await fetch(`${ctx.base}/api/v1/inventory/p1`,{headers:{authorization:`Bearer ${token}`}});assert.equal((await res.json()).quantity,3);res=await fetch(`${ctx.base}/api/v1/sales/s1`,{headers:{authorization:`Bearer ${token}`}});assert.equal((await res.json()).status,'COMPLETED');}finally{await ctx.cleanup();}});
