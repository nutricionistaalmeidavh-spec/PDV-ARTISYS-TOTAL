// Authenticated, bounded, resumable offline D1 -> SQLite dataset transport.
// The legacy /snapshot remains for pre-v2 gateways. No public data exposed.
import {sha256} from './password.mjs';
import {exportOfflineMfa} from './account-security.mjs';
export const DATASETS=Object.freeze({
 product_categories:'tenant',products:'tenant',customers:'tenant',
 stock_positions:'branch',cash_sessions:'branch',sales:'branch',
 sale_items:'branch',sale_payments:'branch',cash_movements:'branch',
 restaurant_tables:'branch',restaurant_table_sessions:'branch',
 restaurant_orders:'branch',restaurant_order_items:'branch',
 restaurant_kitchen_tickets:'branch',restaurant_service_requests:'branch',
 restaurant_sale_links:'branch',r4_item_transfers:'branch',r4_split_plans:'branch',
 cash_adjustments:'branch',customer_credit_receipts:'branch',
 r4_table_prepayments:'branch',r4_table_prepayment_refunds:'branch',
 sale_returns:'branch',sale_return_items:'branch',sale_refund_movements:'branch'
});
const json=(body,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
 'x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
const refused=(code,msg)=>json({error:msg},code);
const ID=/^[A-Za-z0-9-]{1,128}$/;
async function gatewayAuth(request,db){
 const id=request.headers.get('x-pdv-offline-gateway-id')||'';
 const token=/^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization')||'');
 if(!ID.test(id)||!token)return null;
 const hash=await sha256(token[1]);
 const gateway=await db.prepare('SELECT g.id,g.tenant_id AS tenantId,g.branch_id AS branchId FROM offline_gateways g JOIN tenants t ON t.id=g.tenant_id AND t.active=1 JOIN branches b ON b.id=g.branch_id AND b.tenant_id=g.tenant_id AND b.active=1 WHERE g.id=? AND g.credential_hash=? AND g.active=1')
  .bind(id,hash).first();
 return gateway?{...gateway,token:token[1]}:null;
}
function scopePredicate(table,g){
 return DATASETS[table]==='tenant'?{where:'tenant_id=?',params:[g.tenantId],revisionBranch:'*'}
  :{where:'tenant_id=? AND branch_id=?',params:[g.tenantId,g.branchId],revisionBranch:g.branchId};
}
async function manifest(db,g){
 const revisions=(await db.prepare("SELECT table_name AS name,branch_id AS branch,revision FROM offline_dataset_revisions WHERE tenant_id=? AND branch_id IN('*',?)").bind(g.tenantId,g.branchId).all()).results;
 const map=new Map(revisions.map(r=>[r.name+'|'+r.branch,Number(r.revision)]));
 const tables={};
 for(const name of Object.keys(DATASETS)){
  const where=scopePredicate(name,g);
  const count=await db.prepare('SELECT COUNT(*) AS n FROM '+name+' WHERE '+where.where).bind(...where.params).first();
  tables[name]={revision:map.get(name+'|'+where.revisionBranch)||0,count:Number(count.n)};
 }
 const authority=await db.prepare('SELECT gateway_id AS gatewayId,epoch,mode FROM offline_branch_authority WHERE tenant_id=? AND branch_id=?').bind(g.tenantId,g.branchId).first();
 return {version:2,scope:{tenantId:g.tenantId,branchId:g.branchId,gatewayId:g.id},
  authority:authority?.gatewayId===g.id?{mode:authority.mode,epoch:authority.epoch}:{mode:'CLOUD',epoch:0},
  tables};
}
export async function offlineFastSyncRoute(request,db,env={}){
 const url=new URL(request.url);
 if(request.method!=='GET')return refused(405,'Método não permitido.');
 const operation=url.pathname.split('/').at(-1);
 if(!['summary','page','identity'].includes(operation))return refused(404,'Recurso desconhecido.');
 const g=await gatewayAuth(request,db);
 if(!g)return refused(401,'Gateway não autorizado ou revogado.');
 if(operation==='summary')return json(await manifest(db,g));
 if(operation==='page'){
  const table=url.searchParams.get('table')||'',where=scopePredicate;
  if(!Object.hasOwn(DATASETS,table))return refused(400,'Tabela não autorizada.');
  const cursor=Number(url.searchParams.get('after')||0);
  const limit=Number(url.searchParams.get('limit')||75);
  if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isInteger(limit)||limit<1||limit>100)
   return refused(400,'Paginação inválida.');
  const pred=where(table,g);
  // Rowid is a keyset cursor, not OFFSET: unchanged pages are not rescanned
  // from the beginning as the collection grows.
  const {results}=await db.prepare('SELECT rowid AS __cursor,* FROM '+table+' WHERE '+pred.where+' AND rowid>? ORDER BY rowid LIMIT ?')
   .bind(...pred.params,cursor,limit).all();
  const next=results.length?Number(results.at(-1).__cursor):cursor;
  const rows=results.map(({__cursor,...record})=>record);
  const raw=JSON.stringify(rows);
  if(raw.length>480_000)return refused(413,'Página excede o tamanho permitido: reduza o lote.');
  return json({version:2,table,after:cursor,next,complete:results.length<limit,
   count:rows.length,checksum:await sha256(raw),rows});
 }
 // Identity data always refreshes; password revocation and MFA may have no
 // updated_at in the canonical schema. A tenant can have <=2500 members.
 const [tenant,branch,memberships]=await Promise.all([
  db.prepare('SELECT id,slug,name,active,created_at FROM tenants WHERE id=?').bind(g.tenantId).first(),
  db.prepare('SELECT id,tenant_id,code,name,active,created_at FROM branches WHERE tenant_id=? AND id=?').bind(g.tenantId,g.branchId).first(),
  db.prepare('SELECT tenant_id,user_id,profile_key,active,created_at FROM tenant_memberships WHERE tenant_id=?').bind(g.tenantId).all()
 ]);
 if(!tenant||!branch||memberships.results.length>2500)return refused(413,'Identidades fora do limite seguro.');
 if(env.EMAIL_VERIFICATION_REQUIRED==='true'){
  const unverified=await db.prepare('SELECT COUNT(*) AS n FROM users u JOIN tenant_memberships m ON m.user_id=u.id WHERE m.tenant_id=? AND u.active=1 AND u.email_verified_at IS NULL').bind(g.tenantId).first();
  if(unverified.n>0)return refused(412,'Há contas pendentes de verificação.');
 }
 const users=(await db.prepare('SELECT u.id,u.email_norm,u.display_name,u.password_hash,u.active,u.created_at,u.email_verified_at FROM users u JOIN tenant_memberships m ON m.user_id=u.id WHERE m.tenant_id=?').bind(g.tenantId).all()).results;
 let mfa;
 try{mfa=await exportOfflineMfa(db,env,g.tenantId,g.token);}
 catch{return refused(412,'Fatores MFA não podem ser replicados com segurança.');}
 return json({version:2,scope:{tenantId:g.tenantId,branchId:g.branchId,gatewayId:g.id},
  tables:{tenants:[tenant],branches:[branch],users,
   tenant_memberships:memberships.results,saas_mfa_totp:mfa}});
}
