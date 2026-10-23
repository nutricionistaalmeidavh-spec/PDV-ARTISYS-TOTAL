import {createAdvancedFinanceService} from './advanced-finance.mjs';
import policy from '../../../packages/core/js/core/auth/authorization-service.js';
import profiles from '../../../packages/core/js/core/auth/default-profiles.js';
const {createAuthorizationService}=policy,{DEFAULT_PROFILE_PERMISSIONS}=profiles;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const allowed=(member,user,capability)=>createAuthorizationService({resolvePermissions:()=>DEFAULT_PROFILE_PERMISSIONS[member.profileKey==='OWNER'?'ADMINISTRATOR':member.profileKey]||[]})
 .can({principal:{kind:'human',id:user},capability});
async function bodyOf(request){
 if(!String(request.headers.get('content-type')||'').includes('application/json'))throw Object.assign(new Error('Envie JSON.'),{status:415});
 if(Number(request.headers.get('content-length')||0)>262144)throw Object.assign(new Error('Extrato muito grande; divida em lotes.'),{status:413});
 const raw=await request.text();
 if(raw.length>262144)throw Object.assign(new Error('Extrato muito grande.'),{status:413});
 let value;try{value=JSON.parse(raw);}catch{throw Object.assign(new Error('JSON inválido.'),{status:400});}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Object.assign(new Error('Dados inválidos.'),{status:400});
 return value;
}
export async function advancedFinanceRoute(request,db,session,member,tenant,path){
 if(!path.startsWith('finance-advanced/'))return null;
 const feature=path.slice('finance-advanced/'.length).split('/').filter(Boolean),url=new URL(request.url),method=request.method;
 const user=session.userId,write=!['GET','HEAD'].includes(method);
 try{
  const input=write?await bodyOf(request):{};
  const branch=write?input.branchId:url.searchParams.get('branchId');
  if(typeof branch!=='string'||!branch||branch.length>128)throw Object.assign(new Error('Selecione a filial.'),{status:400});
  const required=feature[0]==='dre'?'management.view':'finance.view';
  if(!allowed(member,user,write?'finance.manage':required))throw Object.assign(new Error('Permissão insuficiente.'),{status:403});
  const svc=createAdvancedFinanceService(db);
  const query=name=>url.searchParams.get(name)||'';
  const filters=()=>({from:query('from'),to:query('to'),basis:query('basis')||'accrual'});
  const f=feature.join('/');
  if(method==='GET'){
   if(f==='accounts')return json({accounts:await svc.accounts(tenant,branch)});
   if(feature[0]==='wallets'&&feature.length===3&&feature[2]==='movements')
    return json({movements:await svc.walletMovements(tenant,branch,feature[1],
      {limit:query('limit')||100,offset:query('offset')||0})});
   if(f==='entries/search')return json({history:await svc.entriesSearch(tenant,branch,{
    query:query('query'),kind:query('kind'),status:query('status'),
    categoryId:query('categoryId'),costCenterId:query('costCenterId'),
    groupId:query('groupId'),accountId:query('accountId'),
    from:query('from'),to:query('to'),asOf:query('asOf')||undefined,
    limit:query('limit')||100,offset:query('offset')||0
   })});
   if(f==='statements')return json({batches:await svc.batches(tenant,branch)});
   if(f==='transactions'){
    const limit=Math.min(100,Math.max(1,Number(query('limit')||50))),offset=Math.max(0,Number(query('offset')||0));
    const rows=await svc.transactions(tenant,branch,{accountId:query('accountId'),status:query('status'),from:query('from'),to:query('to'),query:query('query'),direction:query('direction'),limit:limit+1,offset});
    return json({transactions:rows.slice(0,limit),pagination:{limit,offset,hasMore:rows.length>limit}});
   }
   if(f==='transfers/suggestions')return json({transfers:await svc.transferSuggestions(tenant,branch)});
   if(f==='due')return json({due:await svc.dueOverview(tenant,branch,{asOf:query('asOf')||undefined,horizonDays:query('horizonDays')||30})});
   if(f==='recurrences/alerts')return json({alerts:await svc.recurrenceAlerts(tenant,branch,{asOf:query('asOf')||undefined,horizonDays:query('horizonDays')||7})});
   if(feature[0]==='suggestions'&&feature.length===2)return json({suggestions:await svc.suggestions(tenant,branch,feature[1])});
   if(feature[0]==='settlement-suggestions'&&feature.length===2)return json({settlements:await svc.settlementSuggestions(tenant,branch,feature[1])});
   if(f==='recurrences')return json({recurrences:await svc.recurrences(tenant,branch)});
   if(f==='dre')return json({dre:await svc.dre(tenant,branch,filters())});
   if(f==='dre/cashflow')return json({cashflow:await svc.cashflow(tenant,branch,filters())});
   if(f==='dre/details')return json({details:await svc.dreDetails(tenant,branch,{...filters(),groupId:query('groupId')})});
   if(f==='dre/groups')return json({groups:await svc.groups(tenant,branch)});
   if(f==='dre/categories')return json({categories:await svc.categories(tenant,branch)});
   if(f==='dre/cost-centers')return json({costCenters:await svc.costCenters(tenant,branch)});
  }
  if(method==='POST'){
   if(f==='accounts')return json({account:await svc.createAccount(tenant,branch,user,input)},201);
   if(f==='wallets/movement')return json({movement:await svc.walletAdjust(tenant,branch,user,input)},201);
   if(f==='wallets/transfer')return json({transfer:await svc.walletTransfer(tenant,branch,user,input)},201);
   if(f==='statements/import')return json({result:await svc.importStatement(tenant,branch,user,input)},201);
   if(f==='reconcile/match')return json({reconciliation:await svc.match(tenant,branch,user,input)});
   if(f==='reconcile/link')return json({reconciliation:await svc.linkSettlement(tenant,branch,user,input)});
   if(f==='reconcile/ignore')return json({reconciliation:await svc.ignore(tenant,branch,user,input.transactionId)});
   if(f==='transfers/confirm')return json({transfer:await svc.confirmTransfer(tenant,branch,user,input)});
   if(f==='recurrences')return json({recurrence:await svc.createRecurrence(tenant,branch,user,input)},201);
   if(f==='recurrences/generate')return json({result:await svc.generate(tenant,branch,user,input)});
   if(f==='dre/groups')return json({group:await svc.createGroup(tenant,branch,input)},201);
   if(f==='dre/categories')return json({category:await svc.createCategory(tenant,branch,input)},201);
   if(f==='dre/cost-centers')return json({costCenter:await svc.createCostCenter(tenant,branch,input)},201);
   if(feature[0]==='dre'&&feature[1]==='classify'&&feature.length===3)return json({classification:await svc.classify(tenant,branch,feature[2],input)});
  }
  if(method==='PATCH'&&feature[0]==='recurrences'&&feature.length===3&&feature[2]==='status')
   return json({recurrence:await svc.setRecurrenceStatus(tenant,branch,feature[1],input.status)});
  return json({error:'Rota financeira não encontrada.'},404);
 }catch(error){
  const status=Number.isInteger(error?.status)&&error.status>=400&&error.status<500?error.status:500;
  if(status===500)console.error('Advanced finance request failed',{method,path,error:String(error?.message||error)});
  const local=['127.0.0.1','localhost'].includes(new URL(request.url).hostname);
  return json({error:status===500&&!local?'Falha ao processar operação financeira.':error.message},status);
 }
}
