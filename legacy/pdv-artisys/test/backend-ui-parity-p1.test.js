'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Readable}=require('node:stream');
const {createVerticalRouter}=require('../server/vertical-router');

function request({method='GET',path='/',token='',body=null}={}){
  const req=Readable.from(body==null?[]:[Buffer.from(JSON.stringify(body))]);
  req.method=method;req.url=path;req.headers={host:'localhost'};
  if(token)req.headers.authorization=`Bearer ${token}`;
  return req;
}
function response(){
  return{
    statusCode:0,headers:null,payload:null,
    writeHead(statusCode,headers){this.statusCode=statusCode;this.headers=headers;},
    end(value){this.payload=value?JSON.parse(String(value)):null;}
  };
}
async function call(handler,input){const res=response();await handler(request(input),res);return res;}

function runtime(calls){
  return{
    logger:{log(){}},
    authorization:{require(){return true;},can(){return true;}},
    modules:{list(){return[];}},
    restaurantSettlement:{
      createEqualSettlement(id,data,actor){calls.push({op:'equal',id,data,actor});return{settlement:{id:'settlement-1'}};},
      cancelOrderItem(id,reason,actor){calls.push({op:'cancel-item',id,reason,actor});return{orderItemId:id,cancelled:true};}
    },
    marketBakery:{
      getBakeryOrder(id){calls.push({op:'bakery-get',id});return{id,status:'OPEN'};},
      cancelBakeryOrder(id,reason,actor){calls.push({op:'bakery-cancel',id,reason,actor});return{id,status:'CANCELLED'};}
    }
  };
}

function sessions(){return new Map([['token-manager',{userId:'manager-1',profileId:'profile-manager',terminalId:'PDV-01',expiresAt:Date.now()+60_000}]]);}

test('vertical P1 routes reject unauthenticated access when sharing the desktop session store',async()=>{
  const calls=[];const handler=createVerticalRouter({runtime:runtime(calls),sessionStore:sessions()});
  const res=await call(handler,{method:'GET',path:'/api/v1/vertical/bakery/orders/b1'});
  assert.equal(res.statusCode,401);
  assert.match(res.payload.error,/Sessao invalida/i);
  assert.equal(calls.length,0);
});

test('restaurant equal split receives the authenticated manager actor and terminal',async()=>{
  const calls=[];const handler=createVerticalRouter({runtime:runtime(calls),sessionStore:sessions()});
  const res=await call(handler,{method:'POST',path:'/api/v1/vertical/restaurant/sessions/session-1/settlements/equal',token:'token-manager',body:{parts:2,operatorId:'manager-1'}});
  assert.equal(res.statusCode,201);
  assert.equal(calls[0].op,'equal');
  assert.equal(calls[0].data.terminalId,'PDV-01');
  assert.deepEqual(calls[0].actor,{kind:'human',userId:'manager-1',terminalId:'PDV-01'});
});

test('manager identity reaches protected restaurant item cancellation',async()=>{
  const calls=[];const handler=createVerticalRouter({runtime:runtime(calls),sessionStore:sessions()});
  const res=await call(handler,{method:'POST',path:'/api/v1/vertical/restaurant/order-items/item-1/cancel',token:'token-manager',body:{reason:'duplicado'}});
  assert.equal(res.statusCode,200);
  assert.equal(calls[0].actor.userId,'manager-1');
  assert.equal(calls[0].reason,'duplicado');
});

test('bakery order lookup and cancellation are exposed through the vertical HTTP boundary',async()=>{
  const calls=[];const handler=createVerticalRouter({runtime:runtime(calls),sessionStore:sessions()});
  const lookup=await call(handler,{method:'GET',path:'/api/v1/vertical/bakery/orders/b1',token:'token-manager'});
  assert.equal(lookup.statusCode,200);assert.equal(lookup.payload.id,'b1');
  const cancelled=await call(handler,{method:'POST',path:'/api/v1/vertical/bakery/orders/b1/cancel',token:'token-manager',body:{reason:'cliente desistiu'}});
  assert.equal(cancelled.statusCode,200);assert.equal(cancelled.payload.status,'CANCELLED');
  assert.deepEqual(calls.map(item=>item.op),['bakery-get','bakery-cancel']);
});
