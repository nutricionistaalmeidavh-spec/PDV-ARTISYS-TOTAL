'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

async function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-finance-api-'));let seq=0;
  const runtime=createPdvRuntime({dbPath:path.join(dir,'pdv.sqlite'),idFactory:p=>`${p}-${++seq}`});
  runtime.catalog.createUser({id:'admin1',username:'admin',name:'Admin',profileId:'profile-administrator',password:'senha-admin-123'});
  runtime.catalog.createUser({id:'manager1',username:'manager',name:'Gerente',profileId:'profile-manager',password:'senha-manager-123'});
  runtime.catalog.createUser({id:'cashier1',username:'cashier',name:'Caixa',profileId:'profile-cashier',password:'senha-cashier-123'});
  const server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'install-secret'});const address=await server.start();
  return{runtime,server,dir,base:`http://${address.host}:${address.port}`,async close(){await server.stop();runtime.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
async function login(ctx,user,password){const r=await fetch(`${ctx.base}/api/v1/auth/login`,{method:'POST',headers:{'content-type':'application/json','x-pdv-token':'install-secret'},body:JSON.stringify({username:user,password,terminalId:'PDV-01'})});assert.equal(r.status,200);return(await r.json()).sessionToken;}
async function api(ctx,token,url,{method='GET',body}={}){const headers={authorization:`Bearer ${token}`};if(body!==undefined)headers['content-type']='application/json';return fetch(`${ctx.base}${url}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});}

test('manager configures dimensions and reads management projections while cashier is denied',async()=>{
 const ctx=await fixture();try{
  const manager=await login(ctx,'manager','senha-manager-123');const cashier=await login(ctx,'cashier','senha-cashier-123');
  assert.equal((await api(ctx,manager,'/api/v1/erp-finance/dre-groups')).status,200);
  const center=await api(ctx,manager,'/api/v1/erp-finance/cost-centers',{method:'POST',body:{id:'STORE',name:'Loja'}});assert.equal(center.status,201);
  const category=await api(ctx,manager,'/api/v1/erp-finance/categories',{method:'POST',body:{id:'POWER',name:'Energia',kind:'EXPENSE',dreGroupId:'OPERATING_EXPENSE'}});assert.equal(category.status,201);
  const entry=ctx.runtime.finance.createEntry({kind:'PAYABLE',description:'Energia',amountCents:10000,dueAt:'2026-09-25T12:00:00.000Z'}, {userId:'manager1',profileId:'profile-manager'});
  const dimensions=await api(ctx,manager,`/api/v1/erp-finance/entries/${entry.id}/dimensions`,{method:'PATCH',body:{categoryId:'POWER',costCenterId:'STORE',competencyDate:'2026-09-01'}});assert.equal(dimensions.status,200);
  for(const endpoint of ['dashboard?from=2026-09-01&to=2026-09-30','dre?basis=accrual&from=2026-09-01&to=2026-09-30','cashflow?from=2026-09-01&to=2026-09-30&projectionDays=30'])assert.equal((await api(ctx,manager,`/api/v1/erp-finance/${endpoint}`)).status,200);
  assert.equal((await api(ctx,cashier,'/api/v1/erp-finance/dre-groups')).status,403);
  assert.equal((await api(ctx,cashier,'/api/v1/erp-finance/cost-centers',{method:'POST',body:{name:'Nao'}})).status,403);
 }finally{await ctx.close();}
});

test('invalid dimensions are controlled 400 and unknown drilldown is 404',async()=>{
 const ctx=await fixture();try{const token=await login(ctx,'admin','senha-admin-123');const entry=ctx.runtime.finance.createEntry({kind:'PAYABLE',description:'Teste',amountCents:5000,dueAt:'2026-09-25T12:00:00.000Z'},{userId:'admin1',profileId:'profile-administrator'});assert.equal((await api(ctx,token,`/api/v1/erp-finance/entries/${entry.id}/dimensions`,{method:'PATCH',body:{categoryId:'INEXISTENTE'}})).status,400);assert.equal((await api(ctx,token,'/api/v1/erp-finance/drilldown?entryId=missing')).status,404);}finally{await ctx.close();}
});
