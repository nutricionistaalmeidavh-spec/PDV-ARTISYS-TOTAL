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
   if(f==='statements')return json({batches:await svc.batches(tenant,branch)});
   if(f==='transactions')return json({transactions:await svc.transactions(tenant,branch,{accountId:query('accountId'),status:query('status')})});
   if(f==='transfers/suggestions')return json({transfers:await svc.transferSuggestions(tenant,branch)});
   if(feature[0]==='suggestions'&&feature.length===2)return json({suggestions:await svc.suggestions(tenant,branch,feature[1])});
   if(f==='recurrences')return json({recurrences:await svc.recurrences(tenant,branch)});
   if(f==='dre')return json({dre:await svc.dre(tenant,branch,filters())});
   if(f==='dre/details')return json({details:await svc.dreDetails(tenant,branch,{...filters(),groupId:query('groupId')})});
   if(f==='dre/groups')return json({groups:await svc.groups(tenant,branch)});
   if(f==='dre/cost-centers')return json({costCenters:await svc.costCenters(tenant,branch)});
  }
  if(method==='POST'){
   if(f==='accounts')return json({account:await svc.createAccount(tenant,branch,user,input)},201);
   if(f==='statements/import')return json({result:await svc.importStatement(tenant,branch,user,input)},201);
   if(f==='reconcile/match')return json({reconciliation:await svc.match(tenant,branch,user,input)});
   if(f==='reconcile/link')return json({reconciliation:await svc.linkSettlement(tenant,branch,user,input)});
   if(f==='reconcile/ignore')return json({reconciliation:await svc.ignore(tenant,branch,user,input.transactionId)});
   if(f==='transfers/confirm')return json({transfer:await svc.confirmTransfer(tenant,branch,user,input)});
   if(f==='recurrences')return json({recurrence:await svc.createRecurrence(tenant,branch,user,input)},201);
   if(f==='recurrences/generate')return json({result:await svc.generate(tenant,branch,user,input)});
   if(f==='dre/groups')return json({group:await svc.createGroup(tenant,branch,input)},201);
   if(f==='dre/cost-centers')return json({costCenter:await svc.createCostCenter(tenant,branch,input)},201);
   if(feature[0]==='dre'&&feature[1]==='classify'&&feature.length===3)return json({classification:await svc.classify(tenant,branch,feature[2],input)});
  }
  if(method==='PATCH'&&feature[0]==='recurrences'&&feature.length===3&&feature[2]==='status')
   return json({recurrence:await svc.setRecurrenceStatus(tenant,branch,feature[1],input.status)});
  return json({error:'Rota financeira não encontrada.'},404);
 }catch(error){
  const status=Number.isInteger(error?.status)&&error.status>=400&&error.status<500?error.status:500;
  return json({error:status===500?'Falha ao processar operação financeira.':error.message},status);
 }
}
