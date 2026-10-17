'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createReceiptRouter}=require('../server/receipt-router');

function request({method='GET',url='/api/v1/printing/preferences',token='session',body=null}={}){
  const source=body==null?[]:[Buffer.from(JSON.stringify(body))];
  const req=Readable.from(source);
  req.method=method;req.url=url;req.headers={authorization:`Bearer ${token}`};
  return req;
}
function response(){
  const state={status:null,headers:null,body:''};
  return {state,get headersSent(){return state.status!==null;},writeHead(status,headers){state.status=status;state.headers=headers;},end(value=''){state.body+=String(value);}};
}
function settingsStore(seed={}){
  const values=new Map(Object.entries(seed));const writes=[];
  return {
    values,writes,
    get:(key,{defaultValue})=>values.has(key)?values.get(key):defaultValue,
    set:(key,value,{scope,actor})=>{values.set(key,value);writes.push({key,value,scope,actor});return {key,value,scope};}
  };
}
function runtime(settings){return {
  settings,
  sales:{getSaleDetails:()=>null},
  authorization:{
    require:({principal,capability})=>{
      if(principal?.kind==='human'&&principal.id==='u2'&&capability==='settings.manage')return true;
      throw Object.assign(new Error('Permissao insuficiente.'),{statusCode:403});
    }
  }
};}
function sessions(){return new Map([
  ['cashier',{userId:'u1',profileId:'profile-cashier',expiresAt:Date.now()+60000}],
  ['manager',{userId:'u2',profileId:'profile-manager',expiresAt:Date.now()+60000}]
]);}
async function call(router,opts){const req=request(opts);const res=response();assert.equal(await router(req,res),true);return {...res.state,json:res.state.body?JSON.parse(res.state.body):null};}

test('cashier can read normalized printing preferences but cannot change global configuration',async()=>{
  const settings=settingsStore({'printing.paperMm':58,'printing.columnsMode':'auto','printing.deviceName':'POS58'});
  const router=createReceiptRouter({runtime:runtime(settings),sessionStore:sessions(),env:{}});
  const get=await call(router,{token:'cashier'});
  assert.equal(get.status,200);
  assert.equal(get.json.paperMm,58);
  assert.equal(get.json.columns,32);
  assert.equal(get.json.deviceName,'POS58');

  const put=await call(router,{method:'PUT',token:'cashier',body:{paperMm:80,columnsMode:'auto'}});
  assert.equal(put.status,403);
  assert.equal(settings.writes.length,0);
});

test('manager can persist validated global printing preferences',async()=>{
  const settings=settingsStore();
  const router=createReceiptRouter({runtime:runtime(settings),sessionStore:sessions(),env:{}});
  const put=await call(router,{method:'PUT',token:'manager',body:{deviceName:'POS80 Printer',paperMm:80,columnsMode:'manual',columns:42,autoPrint:false,showSystemDialog:true,cut:true,openDrawerAfterPrint:false}});
  assert.equal(put.status,200);
  assert.equal(put.json.deviceName,'POS80 Printer');
  assert.equal(put.json.paperMm,80);
  assert.equal(put.json.columns,42);
  assert.equal(settings.values.get('printing.deviceName'),'POS80 Printer');
  assert.equal(settings.values.get('printing.columns'),42);
  assert.equal(settings.writes.every(row=>row.scope==='global'&&row.actor.kind==='human'&&row.actor.userId==='u2'),true);
});

test('invalid printing preference payload is rejected without partial writes',async()=>{
  const settings=settingsStore();
  const router=createReceiptRouter({runtime:runtime(settings),sessionStore:sessions(),env:{}});
  const put=await call(router,{method:'PUT',token:'manager',body:{paperMm:70,columnsMode:'auto'}});
  assert.equal(put.status,400);
  assert.match(put.json.error,/58 ou 80/i);
  assert.equal(settings.writes.length,0);
});
