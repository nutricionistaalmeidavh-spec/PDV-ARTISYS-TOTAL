'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

async function setup(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-e40-api-'));let seq=0;
  const runtime=createPdvRuntime({dbPath:path.join(dir,'pdv.sqlite'),idFactory:p=>`${p}-${++seq}`});
  const server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'install-secret',requireTerminalAuth:false});
  const address=await server.start();return{runtime,server,dir,base:`http://${address.host}:${address.port}`,async close(){await server.stop();runtime.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
const installHeaders={'x-pdv-token':'install-secret','content-type':'application/json'};
function sessionHeaders(token){return{authorization:`Bearer ${token}`,'content-type':'application/json'};}
async function bootstrap(ctx){
  let res=await fetch(`${ctx.base}/api/v1/setup/admin`,{method:'POST',headers:installHeaders,body:JSON.stringify({username:'admin',name:'Admin',password:'senha-forte-123'})});assert.equal(res.status,201);
  res=await fetch(`${ctx.base}/api/v1/auth/login`,{method:'POST',headers:installHeaders,body:JSON.stringify({username:'admin',password:'senha-forte-123',terminalId:'PDV-01'})});assert.equal(res.status,200);return(await res.json()).sessionToken;
}

test('E42 modules are discoverable and enablement persists through authenticated settings',async()=>{
  const ctx=await setup();try{const token=await bootstrap(ctx);const h=sessionHeaders(token);
    let res=await fetch(`${ctx.base}/api/v1/vertical/modules`,{headers:h});assert.equal(res.status,200);let modules=await res.json();
    assert.deepEqual(modules.map(module=>module.id),['FOOD','WHOLESALE']);
    assert.equal(modules.find(m=>m.id==='FOOD').enabled,true);
    res=await fetch(`${ctx.base}/api/v1/settings/modules.FOOD.enabled`,{method:'PUT',headers:h,body:JSON.stringify({value:false,scope:'global'})});assert.equal(res.status,200);
    res=await fetch(`${ctx.base}/api/v1/vertical/modules`,{headers:h});modules=await res.json();assert.equal(modules.find(m=>m.id==='FOOD').enabled,false);
    res=await fetch(`${ctx.base}/api/v1/settings/modules.FOOD.enabled`,{method:'PUT',headers:h,body:JSON.stringify({value:true,scope:'global'})});assert.equal(res.status,200);
  }finally{await ctx.close();}}
);

test('E40-E43 configured pizza is created by local API and retains configuration in canonical sale',async()=>{
  const ctx=await setup();try{const token=await bootstrap(ctx);const h=sessionHeaders(token);
    let res=await fetch(`${ctx.base}/api/v1/products`,{method:'POST',headers:h,body:JSON.stringify({id:'pizza',name:'Pizza',salePriceCents:3000,trackStock:false})});assert.equal(res.status,201);
    res=await fetch(`${ctx.base}/api/v1/vertical/pizzeria/profile`,{method:'POST',headers:h,body:JSON.stringify({productId:'pizza',pricingPolicy:'HIGHEST_FLAVOR'})});assert.equal(res.status,201);
    for(const body of [{kind:'size',id:'g',productId:'pizza',name:'Grande',maxFlavors:2,priceDeltaCents:500},{kind:'flavor',id:'cal',productId:'pizza',name:'Calabresa',priceDeltaCents:400},{kind:'flavor',id:'mar',productId:'pizza',name:'Marguerita',priceDeltaCents:200},{kind:'crust',id:'cat',productId:'pizza',name:'Catupiry',priceDeltaCents:600}]){
      res=await fetch(`${ctx.base}/api/v1/vertical/pizzeria/catalog`,{method:'POST',headers:h,body:JSON.stringify(body)});assert.equal(res.status,201);
    }
    res=await fetch(`${ctx.base}/api/v1/vertical/pizzeria/price`,{method:'POST',headers:h,body:JSON.stringify({productId:'pizza',sizeId:'g',flavorIds:['cal','mar'],crustId:'cat'})});assert.equal(res.status,200);const priced=await res.json();assert.equal(priced.unitPriceCents,4500);
    res=await fetch(`${ctx.base}/api/v1/sales`,{method:'POST',headers:h,body:JSON.stringify({id:'s1',saleNumber:'1',terminalId:'PDV-01'})});assert.equal(res.status,201);
    res=await fetch(`${ctx.base}/api/v1/vertical/sales/s1/configured-item`,{method:'POST',headers:h,body:JSON.stringify({productId:'pizza',quantity:1,unitPriceCents:priced.unitPriceCents,configurationSnapshot:priced.configurationSnapshot})});assert.equal(res.status,200);const sale=await res.json();assert.equal(sale.items[0].configuration.pizza.size.name,'Grande');
  }finally{await ctx.close();}}
);

test('E45-E47 Alimentação gates food flows while weight remains a Core endpoint',async()=>{
  const ctx=await setup();try{const token=await bootstrap(ctx);const h=sessionHeaders(token);
    let res=await fetch(`${ctx.base}/api/v1/settings/modules.FOOD.enabled`,{method:'PUT',headers:h,body:JSON.stringify({value:false,scope:'global'})});assert.equal(res.status,200);
    res=await fetch(`${ctx.base}/api/v1/vertical/delivery`,{method:'POST',headers:h,body:JSON.stringify({customerName:'Ana',fulfillmentType:'PICKUP',paymentMethod:'PIX'})});assert.equal(res.status,409);assert.match((await res.json()).error,/FOOD desativado/);
    res=await fetch(`${ctx.base}/api/v1/vertical/catalog/weight/profile`,{method:'POST',headers:h,body:JSON.stringify({id:'w',name:'Balanca',prefix:'20',totalLength:13,productStart:2,productLength:5,weightStart:7,weightLength:5,decimalPlaces:3})});assert.equal(res.status,201);
    res=await fetch(`${ctx.base}/api/v1/vertical/catalog/weight/parse`,{method:'POST',headers:h,body:JSON.stringify({barcode:'2000123002500'})});assert.equal(res.status,200);assert.equal((await res.json()).grams,250);
    res=await fetch(`${ctx.base}/api/v1/settings/modules.FOOD.enabled`,{method:'PUT',headers:h,body:JSON.stringify({value:true,scope:'global'})});assert.equal(res.status,200);
    res=await fetch(`${ctx.base}/api/v1/vertical/delivery`,{method:'POST',headers:h,body:JSON.stringify({customerName:'Ana',fulfillmentType:'PICKUP',paymentMethod:'PIX'})});assert.equal(res.status,201);assert.equal((await res.json()).status,'NEW');
    res=await fetch(`${ctx.base}/api/v1/vertical/fast-food`,{method:'POST',headers:h,body:'{}'});assert.equal(res.status,201);assert.equal((await res.json()).dailyNumber,1);
  }finally{await ctx.close();}}
);
