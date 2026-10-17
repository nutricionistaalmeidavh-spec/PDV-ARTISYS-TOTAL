'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

async function fixture({lan=false}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-phase9-auth-'));
  let seq=0;
  const runtime=createPdvRuntime({dbPath:path.join(dir,'pdv.sqlite'),idFactory:p=>`${p}-${++seq}`,serverVersion:'1.4.0',minimumTerminalVersion:'1.0.0'});
  runtime.catalog.createUser({id:'admin1',username:'admin',name:'Admin',profileId:'profile-administrator',password:'senha-admin-123'});
  runtime.catalog.createUser({id:'manager1',username:'manager',name:'Gerente',profileId:'profile-manager',password:'senha-manager-123'});
  runtime.catalog.createUser({id:'cashier1',username:'cashier',name:'Operador',profileId:'profile-cashier',password:'senha-cashier-123'});
  runtime.catalog.upsertProduct({id:'p1',name:'Produto P0',sku:'P0',salePriceCents:2000,costCents:800,trackStock:true,minimumStock:0});
  runtime.catalog.upsertCustomer({id:'c1',name:'Cliente P0'});
  const server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'install-secret',requireTerminalAuth:lan});
  const address=await server.start();
  return{dir,runtime,server,base:`http://${address.host}:${address.port}`,async close(){await server.stop();runtime.close();fs.rmSync(dir,{recursive:true,force:true});}};
}

async function pair(ctx,terminalId){
  const pairing=ctx.runtime.terminals.createPairingCode({createdBy:'admin1'});
  const response=await fetch(`${ctx.base}/api/v1/lan/pair`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:pairing.code,terminalId,name:terminalId,fingerprint:`fp-${terminalId}`,appVersion:'1.4.0'})});
  assert.equal(response.status,201);
  return response.json();
}

async function login(ctx,username,password,paired=null){
  const headers={'content-type':'application/json'};
  const body={username,password,terminalId:paired?.terminalId||'PDV-01'};
  if(paired){headers['x-terminal-id']=paired.terminalId;headers['x-terminal-key']=paired.credential;}else headers['x-pdv-token']='install-secret';
  const response=await fetch(`${ctx.base}/api/v1/auth/login`,{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal(response.status,200);
  return (await response.json()).sessionToken;
}

async function api(ctx,token,pathname,{method='GET',body}={}){
  const headers={authorization:`Bearer ${token}`};
  if(body!==undefined){headers['content-type']='application/json';}
  return fetch(`${ctx.base}${pathname}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
}

test('embedded Phase 9 accepts the logged session and never installation token as admin identity',async()=>{
  const ctx=await fixture();
  try{
    const token=await login(ctx,'manager','senha-manager-123');
    const locations=await api(ctx,token,'/api/v1/stock-locations');
    assert.equal(locations.status,200);

    const supplierResponse=await api(ctx,token,'/api/v1/suppliers',{method:'POST',body:{name:'Fornecedor Manager',document:'12345678000199'}});
    assert.equal(supplierResponse.status,201);
    const supplier=await supplierResponse.json();

    const poResponse=await api(ctx,token,'/api/v1/purchase-orders',{method:'POST',body:{supplierId:supplier.id,locationId:'MAIN',items:[{productId:'p1',quantity:2,unitCostCents:1000}]}});
    assert.equal(poResponse.status,201);
    const po=await poResponse.json();
    assert.equal(po.createdById,'manager1');

    const installOnly=await fetch(`${ctx.base}/api/v1/stock-locations`,{headers:{'x-pdv-token':'install-secret'}});
    assert.equal(installOnly.status,401);
  }finally{await ctx.close();}
});

test('cashier keeps cashier privileges on Phase 9 routes',async()=>{
  const ctx=await fixture();
  try{
    const token=await login(ctx,'cashier','senha-cashier-123');
    assert.equal((await api(ctx,token,'/api/v1/stock-locations')).status,200);
    assert.equal((await api(ctx,token,'/api/v1/suppliers',{method:'POST',body:{name:'Nao pode'}})).status,403);
    assert.equal((await api(ctx,token,'/api/v1/purchase-orders',{method:'POST',body:{supplierId:'x',locationId:'MAIN',items:[{productId:'p1',quantity:1,unitCostCents:1000}]}})).status,403);
    assert.equal((await api(ctx,token,'/api/v1/stock-transfers',{method:'POST',body:{fromLocationId:'MAIN',toLocationId:'X',items:[{productId:'p1',quantity:1}]}})).status,403);
    const quote=await api(ctx,token,'/api/v1/sales-orders',{method:'POST',body:{customerId:'c1',locationId:'MAIN',fulfillmentType:'PICKUP',items:[{productId:'p1',quantity:1}]}});
    assert.equal(quote.status,201);
    assert.equal((await quote.json()).createdBy,'cashier1');
  }finally{await ctx.close();}
});

test('LAN manager remains manager and can execute procurement while LAN cashier cannot',async()=>{
  const ctx=await fixture({lan:true});
  try{
    const managerTerminal=await pair(ctx,'PDV-MANAGER');
    const managerToken=await login(ctx,'manager','senha-manager-123',managerTerminal);
    const supplierResponse=await api(ctx,managerToken,'/api/v1/suppliers',{method:'POST',body:{name:'Fornecedor LAN'}});
    assert.equal(supplierResponse.status,201);
    const supplier=await supplierResponse.json();
    const po=await api(ctx,managerToken,'/api/v1/purchase-orders',{method:'POST',body:{supplierId:supplier.id,locationId:'MAIN',items:[{productId:'p1',quantity:1,unitCostCents:900}]}});
    assert.equal(po.status,201);
    assert.equal((await po.json()).createdById,'manager1');

    const cashierTerminal=await pair(ctx,'PDV-CASHIER');
    const cashierToken=await login(ctx,'cashier','senha-cashier-123',cashierTerminal);
    const forbidden=await api(ctx,cashierToken,'/api/v1/purchase-orders',{method:'POST',body:{supplierId:supplier.id,locationId:'MAIN',items:[{productId:'p1',quantity:1,unitCostCents:900}]}});
    assert.equal(forbidden.status,403);
  }finally{await ctx.close();}
});
