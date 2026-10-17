'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createRestaurantRouter}=require('../server/restaurant-router');

function responseCapture(){
  return {
    statusCode:null,
    headers:null,
    body:'',
    writeHead(statusCode,headers){this.statusCode=statusCode;this.headers=headers;},
    end(chunk=''){this.body+=String(chunk||'');}
  };
}

function request(url,{method='GET',headers={},body=null}={}){
  const bytes=body==null?Buffer.alloc(0):Buffer.from(JSON.stringify(body));
  const req=Readable.from(bytes.length?[bytes]:[]);
  req.url=url;
  req.method=method;
  req.headers={host:'localhost',...headers};
  return req;
}

async function call(router,url,options){
  const res=responseCapture();
  assert.equal(await router(request(url,options),res),true);
  return {status:res.statusCode,payload:res.body?JSON.parse(res.body):null};
}

test('restaurant desktop mutations are rejected when FOOD module is disabled',async t=>{
  const runtime=createPdvRuntime();
  t.after(()=>runtime.close());
  runtime.modules.setEnabled('FOOD',false,{kind:'system',id:'system'});
  const router=createRestaurantRouter({runtime});

  const result=await call(router,'/api/v1/restaurant/tables',{
    method:'POST',
    body:{label:'Mesa indevida',seats:4}
  });

  assert.equal(result.status,409);
  assert.equal(result.payload?.code,'MODULE_DISABLED');
  assert.match(result.payload?.error||'',/FOOD.*desativado/i);
  assert.equal(runtime.restaurant.listTables().length,0);
});

test('restaurant mobile mutations are rejected when FOOD module is disabled',async t=>{
  const runtime=createPdvRuntime();
  t.after(()=>runtime.close());
  const device=runtime.mobileDevices.createDevice({name:'Garcom QA',deviceType:'WAITER'},{kind:'system',id:'system'});
  runtime.modules.setEnabled('FOOD',false,{kind:'system',id:'system'});
  const router=createRestaurantRouter({runtime});

  const result=await call(router,'/api/v1/mobile/orders',{
    method:'POST',
    headers:{'x-device-id':device.id,'x-device-key':device.credential},
    body:{sessionId:'sessao-inexistente',items:[]}
  });

  assert.equal(result.status,409);
  assert.equal(result.payload?.code,'MODULE_DISABLED');
  assert.match(result.payload?.error||'',/FOOD.*desativado/i);
});
