'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

async function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-ui-parity-'));
  let seq=0;
  const runtime=createPdvRuntime({dbPath:path.join(dir,'pdv.sqlite'),idFactory:p=>`${p}-${++seq}`,serverVersion:'1.4.0'});
  runtime.catalog.createUser({id:'admin1',username:'admin',name:'Admin',profileId:'profile-administrator',password:'senha-admin-123'});
  runtime.catalog.upsertProduct({id:'p1',name:'Produto Local',sku:'LOC-1',salePriceCents:1000,costCents:400,trackStock:true,minimumStock:1});
  const server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'install-secret'});
  const address=await server.start();
  return{dir,runtime,server,base:`http://${address.host}:${address.port}`,async close(){await server.stop();runtime.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
async function login(ctx){
  const response=await fetch(`${ctx.base}/api/v1/auth/login`,{method:'POST',headers:{'content-type':'application/json','x-pdv-token':'install-secret'},body:JSON.stringify({username:'admin',password:'senha-admin-123',terminalId:'PDV-01'})});
  assert.equal(response.status,200);return(await response.json()).sessionToken;
}
async function api(ctx,token,pathname,{method='GET',body}={}){
  const headers={authorization:`Bearer ${token}`};if(body!==undefined)headers['content-type']='application/json';
  return fetch(`${ctx.base}${pathname}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
}

test('terminal stock binding and local stock read model are operable through authenticated API',async()=>{
  const ctx=await fixture();
  try{
    const token=await login(ctx);
    let response=await api(ctx,token,'/api/v1/stock-locations',{method:'POST',body:{id:'LOJA-2',name:'Loja 2',type:'STORE'}});assert.equal(response.status,201);
    response=await api(ctx,token,'/api/v1/terminal-stock-locations');assert.equal(response.status,200);let rows=await response.json();assert.ok(rows.some(row=>row.terminalId==='PDV-01'&&row.locationId==='MAIN'));
    response=await api(ctx,token,'/api/v1/terminal-stock-locations/PDV-01',{method:'PUT',body:{locationId:'LOJA-2'}});assert.equal(response.status,200);assert.equal((await response.json()).locationId,'LOJA-2');
    response=await api(ctx,token,'/api/v1/terminal-stock-locations');rows=await response.json();const bound=rows.find(row=>row.terminalId==='PDV-01');assert.equal(bound.locationId,'LOJA-2');assert.equal(bound.fallback,false);
    response=await api(ctx,token,'/api/v1/inventory/movements',{method:'POST',body:{productId:'p1',locationId:'LOJA-2',type:'opening',quantityDelta:7,reason:'saldo loja 2'}});assert.equal(response.status,201);
    response=await api(ctx,token,'/api/v1/stock-balances?locationId=LOJA-2');assert.equal(response.status,200);const balances=await response.json();assert.equal(balances.find(row=>row.productId==='p1').quantity,7);
    response=await api(ctx,token,'/api/v1/stock-balances?aggregate=true');assert.equal(response.status,200);assert.equal((await response.json()).find(row=>row.productId==='p1').quantity,7);
  }finally{await ctx.close();}
});

test('P0 customer operations are wired to visible desktop actions',()=>{
  const ui=fs.readFileSync(path.join(__dirname,'..','desktop','renderer','operational-route-extensions.js'),'utf8');
  const index=fs.readFileSync(path.join(__dirname,'..','desktop','renderer','index.html'),'utf8');
  new Function(ui);
  assert.match(index,/operational-route-extensions\.js/);
  for(const marker of [
    'Estoque por local','bindTerminalStockLocation','Cancelar devolução','createFinanceAccount','reverseFinanceSettlement',
  ]) assert.ok(ui.includes(marker),`UI parity marker ausente: ${marker}`);
});
