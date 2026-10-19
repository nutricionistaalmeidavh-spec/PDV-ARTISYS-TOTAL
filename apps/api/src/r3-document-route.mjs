// R3 document views use the shared canonical printing renderers, never a second
// business data store or a Cloudflare-side hardware driver.
import {renderKitchenPrintJob,renderCashCloseDocument,renderTablePrebillDocument} from './r3-print-documents.mjs';
import authorization from '../../../packages/core/js/core/auth/authorization-service.js';
import profiles from '../../../packages/core/js/core/auth/default-profiles.js';
const {createAuthorizationService}=authorization,{DEFAULT_PROFILE_PERMISSIONS}=profiles;
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const deny=(s,message)=>response({error:message},s);
function permit(member,userId,capability){
 const key=member.profileKey==='OWNER'?'ADMINISTRATOR':member.profileKey;
 const authz=createAuthorizationService({resolvePermissions:()=>DEFAULT_PROFILE_PERMISSIONS[key]||[]});
 if(!authz.can({principal:{kind:'human',id:userId},capability}))
  throw Object.assign(Error('Permissão insuficiente.'),{status:403});
}
export async function r3DocumentRoute(request,db,session,member,tenant,path){
 const p=path.split('/').filter(Boolean),url=new URL(request.url);
 const table=p.length===4&&p[0]==='restaurant'&&p[1]==='sessions'&&p[3]==='prebill';
 const kitchen=p.length===5&&p[0]==='restaurant'&&p[1]==='kitchen'&&p[2]==='print-jobs'&&p[4]==='document';
 const cash=p.length===4&&p[0]==='cash'&&p[1]==='sessions'&&p[3]==='closing-document';
 if(!table&&!kitchen&&!cash)return null;
 if(request.method!=='GET')return deny(405,'Método não permitido.');
 try{
  const branch=url.searchParams.get('branchId')||'';
  const existing=branch&&await db.prepare('SELECT id FROM branches WHERE tenant_id=? AND id=? AND active=1').bind(tenant,branch).first();
  if(!existing)return deny(404,'Filial não encontrada.');
  const q=(sql,...values)=>db.prepare(sql).bind(...values);
  if(table)permit(member,session.userId,'restaurant.orders.view');
  if(kitchen)permit(member,session.userId,'kitchen.view');
  if(cash)permit(member,session.userId,'cash.view');
  const pref=await q('SELECT name FROM r3_receipt_branding WHERE tenant_id=? AND branch_id=?',tenant,branch).first();
  const storeName=pref?.name||'PDV TOTAL';
  if(kitchen){
   const raw=await q('SELECT id,station_ticket_id AS stationTicketId,printer_name AS printerName,payload_json AS payload,status FROM r4_kitchen_print_jobs WHERE tenant_id=? AND branch_id=? AND id=?',tenant,branch,p[3]).first();
   if(!raw)return deny(404,'Ticket de impressão não encontrado.');
   return response({documentType:'KITCHEN_TICKET',fiscal:false,id:raw.id,status:raw.status,
     printerName:raw.printerName,text:renderKitchenPrintJob({...raw,payload:JSON.parse(raw.payload)},{storeName,width:42})});
  }
  if(cash){
   const row=await q('SELECT id,operator_id AS operatorId,status,opened_at AS openedAt,closed_at AS closedAt,opening_cents AS initialCashCents,expected_cash_cents AS expectedCashCents,counted_cash_cents AS countedCashCents,divergence_cents AS divergenceCents FROM cash_sessions WHERE tenant_id=? AND branch_id=? AND id=?',tenant,branch,p[2]).first();
   if(!row)return deny(404,'Sessão de caixa não encontrada.');
   if(row.status!=='CLOSED')return deny(409,'Fechamento somente após encerrar o caixa.');
   return response({documentType:'CASH_CLOSE',fiscal:false,id:row.id,text:renderCashCloseDocument(row,{storeName,width:42})});
  }
  const row=await q(`SELECT s.id,s.status,s.opened_at AS openedAt,t.label AS tableLabel
    FROM restaurant_table_sessions s JOIN restaurant_tables t ON t.id=s.table_id AND t.tenant_id=s.tenant_id AND t.branch_id=s.branch_id
    WHERE s.tenant_id=? AND s.branch_id=? AND s.id=?`,tenant,branch,p[2]).first();
  if(!row)return deny(404,'Comanda não encontrada.');
  if(row.status!=='OPEN')return deny(409,'Pré-conta somente para comanda aberta.');
  const {results:orders}=await q('SELECT id,status,total_cents AS totalCents FROM restaurant_orders WHERE tenant_id=? AND branch_id=? AND table_session_id=? ORDER BY created_at,id',tenant,branch,p[2]).all();
  const enriched=[];
  for(const order of orders){
   const {results:items}=await q('SELECT product_name AS productName,quantity_milli / 1000.0 AS quantity,unit_price_cents AS unitPriceCents,configuration_json AS configurationJson FROM restaurant_order_items WHERE tenant_id=? AND branch_id=? AND order_id=? ORDER BY rowid',tenant,branch,order.id).all();
   enriched.push({...order,items:items.map(({configurationJson,...item})=>({...item,totalCents:Math.round(item.quantity*item.unitPriceCents),configuration:configurationJson?JSON.parse(configurationJson):null}))});
  }
  const totalCents=enriched.filter(o=>o.status!=='CANCELLED').reduce((n,o)=>n+Number(o.totalCents||0),0);
  const model={...row,orders:enriched,totalCents};
  return response({documentType:'TABLE_PREBILL',fiscal:false,id:row.id,text:renderTablePrebillDocument(model,{storeName,width:42})});
 }catch(e){
  return deny(Number(e?.status)||500,e?.status?e.message:'Não foi possível preparar o documento.');
 }
}
