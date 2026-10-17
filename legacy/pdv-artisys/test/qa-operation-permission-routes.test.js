'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Readable}=require('node:stream');
const {createVerticalRouter}=require('../server/vertical-router');

function request({method='POST',path='/',token='token',body={}}={}){
  const req=Readable.from(body==null?[]:[Buffer.from(JSON.stringify(body))]);
  req.method=method;req.url=path;req.headers={host:'localhost',authorization:'Bearer '+token};
  return req;
}
function response(){return{statusCode:0,payload:null,writeHead(code){this.statusCode=code;},end(value){this.payload=value?JSON.parse(String(value)):null;}};}
async function call(handler,input){const res=response();await handler(request(input),res);return res;}

function runtimeFor(permissions=[]){
  const grants=new Set(permissions);
  const requireGrant=capability=>{if(!grants.has(capability)){const error=new Error('Permissao insuficiente.');error.statusCode=403;throw error;}return true;};
  return{
    catalog:{getUser:()=>({id:'user-1',active:true})},
    authorization:{require:({capability})=>requireGrant(capability)},
    modules:{
      requireAccess:id=>{assert.equal(id,'FOOD');return requireGrant('restaurant.access');},
      requireManage:id=>{assert.equal(id,'FOOD');return requireGrant('modules.manage');},
      list:()=>[]
    },
    pizzeria:{upsertSize:data=>data,upsertFlavor:data=>data,upsertCrust:data=>data},
    delivery:{
      updateStatus:(id,status)=>({id,status}),cancel:(id,reason)=>({id,status:'CANCELLED',reason}),
      assignCourier:(id,courier)=>({id,courier}),createSale:id=>({id:'sale-'+id})
    },
    marketBakery:{
      createBakeryOrder:data=>({id:'bakery-1',...data}),getBakeryOrder:id=>({id,status:'OPEN'}),
      updateBakeryOrderStatus:(id,status)=>({id,status}),cancelBakeryOrder:(id,reason)=>({id,status:'CANCELLED',reason})
    },
    restaurantSettlement:{
      createItemSettlement:id=>({settlement:{id:'s-'+id}}),createEqualSettlement:id=>({settlement:{id:'e-'+id}}),
      completeSettlement:id=>({settlementId:id}),cancelOrderItem:id=>({orderItemId:id,cancelled:true}),
      mergeSessions:(id,target)=>({sourceSessionId:id,targetSessionId:target}),
      transferItems:(id,target)=>({sourceSessionId:id,targetSessionId:target})
    },
    logger:{log(){}}
  };
}
function handler(permissions){return createVerticalRouter({
  runtime:runtimeFor(permissions),
  sessionStore:new Map([['token',{userId:'user-1',terminalId:'PDV-1',expiresAt:Date.now()+60000}]])
});}

test('vertical customer operations enforce their granular permission beyond FOOD access',async()=>{
  let h=handler(['restaurant.access']);
  assert.equal((await call(h,{path:'/api/v1/vertical/delivery/d1/status',method:'PATCH',body:{status:'DELIVERED'}})).statusCode,403);
  assert.equal((await call(h,{path:'/api/v1/vertical/delivery/d1/cancel',body:{reason:'teste'}})).statusCode,403);
  assert.equal((await call(h,{path:'/api/v1/vertical/bakery/orders/b1',method:'GET',body:null})).statusCode,403);
  assert.equal((await call(h,{path:'/api/v1/vertical/restaurant/sessions/a/merge',body:{targetSessionId:'b'}})).statusCode,403);

  h=handler(['restaurant.access','restaurant.orders.create','restaurant.orders.view','restaurant.orders.cancel','restaurant.orders.transfer','sales.create']);
  assert.equal((await call(h,{path:'/api/v1/vertical/delivery/d1/status',method:'PATCH',body:{status:'DELIVERED'}})).statusCode,200);
  assert.equal((await call(h,{path:'/api/v1/vertical/delivery/d1/cancel',body:{reason:'teste'}})).statusCode,200);
  assert.equal((await call(h,{path:'/api/v1/vertical/delivery/d1/sale',body:{}})).statusCode,201);
  assert.equal((await call(h,{path:'/api/v1/vertical/bakery/orders/b1',method:'GET',body:null})).statusCode,200);
  assert.equal((await call(h,{path:'/api/v1/vertical/restaurant/sessions/a/merge',body:{targetSessionId:'b'}})).statusCode,200);
});

test('pizzeria catalog editing requires product management plus FOOD access, not module administration',async()=>{
  const allowed=handler(['restaurant.access','products.manage']);
  assert.equal((await call(allowed,{path:'/api/v1/vertical/pizzeria/catalog',body:{kind:'size',id:'g'}})).statusCode,201);
  const denied=handler(['restaurant.access']);
  assert.equal((await call(denied,{path:'/api/v1/vertical/pizzeria/catalog',body:{kind:'size',id:'g'}})).statusCode,403);
});

test('printing retry and reprint routes are protected by settings permissions',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','server','router.js'),'utf8');
  assert.match(source,/GET'&&pathname==='\/api\/v1\/print\/jobs'\)\{requireCapability\(session,'settings\.view'\)/);
  assert.match(source,/POST'&&printRetry\)\{requireCapability\(session,'settings\.manage'\)/);
  assert.match(source,/POST'&&printReprint\)\{requireCapability\(session,'settings\.manage'\)/);
});
