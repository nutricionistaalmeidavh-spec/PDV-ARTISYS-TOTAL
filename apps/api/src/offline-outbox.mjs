import {sha256} from './password.mjs';
import {offlineLinkedCheckoutAllowed} from './offline-linked-checkout.mjs';

// Only canonical inventory mutations with a durable commerce_mutations audit are
// permitted in this first transactional replay protocol. Never queue an
// unrecognized business operation: it would create an unrecoverable orphan.
const SUPPORTED=new Set(['inventory/receipts','inventory/adjustments','restaurant/tables','restaurant/orders']);
const CASH_PATH=/^(?:cash\/open|cash\/sessions\/[a-zA-Z0-9-]{1,128}\/close|sales|sales\/[a-zA-Z0-9-]{1,128}\/(?:items|complete))$/;
const MUTATION=/^[A-Za-z0-9_-]{8,100}$/;
const VALID_ID=/^[a-zA-Z0-9-]{1,128}$/;
function allowed(path,tenant,allowCash){
 const match=path.match(/^\/api\/v1\/tenants\/([^/]+)\/(.+)$/);
 if(!match||match[1]!==tenant)return false;
 const part=match[2];
 return (allowCash&&CASH_PATH.test(part))||SUPPORTED.has(part)||
  /^restaurant\/tables\/[a-zA-Z0-9-]{1,128}\/open$/.test(part)||
  /^restaurant\/kitchen\/[a-zA-Z0-9-]{1,128}$/.test(part)||
  /^restaurant\/orders\/[a-zA-Z0-9-]{1,128}\/(?:deliver|cancel)$/.test(part)||
  /^restaurant\/sessions\/[a-zA-Z0-9-]{1,128}\/close$/.test(part);

}
export async function stageOfflineMutation(db,request,{tenantId,branchId,userId,now=Date.now(),allowCash=false}){
 const path=new URL(request.url).pathname,mutationId=request.headers.get('x-mutation-id')||'';
 if(!allowed(path,tenantId,allowCash)||!['POST','PATCH'].includes(request.method)||!MUTATION.test(mutationId))
  throw Object.assign(Error('Operação offline não suportada ou sem chave de idempotência.'),{status:403});
 const state=await db.prepare('SELECT a.gateway_id AS gatewayId,a.epoch,a.mode,a.refreshed_at AS refreshedAt FROM offline_local_authority a WHERE a.tenant_id=? AND a.branch_id=?').bind(tenantId,branchId).first();
 if(!state||state.mode!=='LOCAL'||now-state.refreshedAt>86400000)
  throw Object.assign(Error('Autoridade offline não confirmada para esta filial.'),{status:503});
 const raw=await request.clone().text();
 if(raw.length>8192)throw Object.assign(Error('Pedido offline excede tamanho máximo.'),{status:413});
 let body;try{body=JSON.parse(raw);}catch{}
 if(!body||Array.isArray(body)||typeof body!=='object'||body.branchId!==branchId||
    (request.method==='PATCH'&&!/\/restaurant\/kitchen\/[a-zA-Z0-9-]+$/.test(path))||
    (request.method==='POST'&&/\/restaurant\/kitchen\//.test(path)))
  throw Object.assign(Error('Filial da operação offline inválida.'),{status:400});
 // Physical CASH-only pilot: no card/PIX charge can be labelled paid without
 // an independent acquirer confirmation. Never settle a restaurant prepayment
 // or a sale that predates the current offline authority epoch.
 if(CASH_PATH.test(path.split('/').slice(5).join('/'))){
   if(!allowCash)throw Object.assign(Error('Caixa offline não habilitado.'),{status:403});
   if(/\/sales$/.test(path))
     await offlineLinkedCheckoutAllowed(db,tenantId,branchId,body);
   if(/\/complete$/.test(path)){
     if(!Array.isArray(body.payments)||body.payments.length<1||
        body.payments.some(p=>p?.method!=='CASH'||!Number.isSafeInteger(p.amountCents)||p.amountCents<=0)||
        body.shares||body.customerId||body.storeCredit)
       throw Object.assign(Error('Somente dinheiro físico é aceito no caixa offline.'),{status:403});
   }
   const dependentSale=path.match(/\/sales\/([a-zA-Z0-9-]+)\/(?:items|complete)$/);
   if(dependentSale){
     const opened=await db.prepare("SELECT 1 AS ok FROM offline_outbox o JOIN commerce_mutations m ON m.tenant_id=o.tenant_id AND m.mutation_id=o.mutation_id WHERE o.tenant_id=? AND o.branch_id=? AND o.epoch=? AND m.scope LIKE 'sale.open:%' AND json_extract(m.result_json,'$.id')=? LIMIT 1")
      .bind(tenantId,branchId,state.epoch,dependentSale[1]).first();
     if(!opened)throw Object.assign(Error('Somente vendas abertas neste período offline podem ser alteradas ou recebidas.'),{status:403});
   }
   const close=path.match(/\/cash\/sessions\/([a-zA-Z0-9-]+)\/close$/);
   if(close){
     const opened=await db.prepare("SELECT 1 AS ok FROM offline_outbox o JOIN commerce_mutations m ON m.tenant_id=o.tenant_id AND m.mutation_id=o.mutation_id WHERE o.tenant_id=? AND o.branch_id=? AND o.epoch=(SELECT epoch FROM offline_local_authority WHERE tenant_id=? AND branch_id=?) AND m.scope LIKE 'cash.open:%' AND json_extract(m.result_json,'$.id')=? LIMIT 1")
      .bind(tenantId,branchId,tenantId,branchId,close[1]).first();
     if(!opened)throw Object.assign(Error('Somente caixas abertos neste período offline podem ser fechados offline.'),{status:403});
   }
 }
 const bodyJson=JSON.stringify(body);
 const hash=await sha256(JSON.stringify({method:request.method,path,body:bodyJson,userId}));
 const prior=await db.prepare('SELECT payload_hash AS hash FROM offline_pending_requests WHERE tenant_id=? AND mutation_id=?').bind(tenantId,mutationId).first();
 if(prior&&prior.hash!==hash)
  throw Object.assign(Error('Chave de operação reutilizada com valores diferentes.'),{status:409});
 if(!prior)await db.prepare('INSERT INTO offline_pending_requests(tenant_id,branch_id,mutation_id,operator_id,method,path,body_json,payload_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
  .bind(tenantId,branchId,mutationId,userId,request.method,path,bodyJson,hash,now).run();
 return {mutationId,hash,createdAt:now};
}
export async function pushOfflineOutbox(db,env,{fetcher=fetch,maxBatch=25}={}){
 const {OFFLINE_CLOUD_ORIGIN:cloud,OFFLINE_GATEWAY_ID:gatewayId,OFFLINE_GATEWAY_TOKEN:token}=env;
 let origin;try{origin=new URL(cloud);}catch{throw Error('Origem Cloudflare inválida.');}
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||
   !VALID_ID.test(gatewayId||'')||!/^[a-f0-9]{64}$/.test(token||''))
   throw Error('Credenciais do gateway ou origem HTTPS inválidas.');
 let acknowledged=0;
 for(let i=0;i<maxBatch;i++){
  const row=await db.prepare("SELECT * FROM offline_outbox WHERE status='PENDING' ORDER BY sequence LIMIT 1").bind().first();
  if(!row)break;
  if(row.gateway_id!==gatewayId)throw Error('Gateway da fila não corresponde ao servidor configurado.');
  const message={sequence:row.sequence,epoch:row.epoch,mutationId:row.mutation_id,
    path:row.path,method:row.method,body:JSON.parse(row.body_json),
    operatorId:row.operator_id,payloadHash:row.payload_hash,createdAt:row.created_at};
  const response=await fetcher(origin.origin+'/api/v1/offline/gateway/replay',{
    method:'POST',headers:{authorization:'Bearer '+token,'x-pdv-offline-gateway-id':gatewayId,
      'content-type':'application/json'},body:JSON.stringify(message),redirect:'error',
    signal:AbortSignal.timeout(15000),cache:'no-store'});
  if(response.status===409||response.status===423){
   await db.prepare("UPDATE offline_outbox SET status='CONFLICT' WHERE sequence=? AND status='PENDING'").bind(row.sequence).run();
   return {acknowledged,conflicts:1,blocked:true};
  }
  if(!response.ok)throw Object.assign(Error('Nuvem recusou operação pendente ('+response.status+').'),{status:response.status});
  const ack=await response.json();
  if(ack.acknowledged!==true||ack.sequence!==row.sequence||ack.payloadHash!==row.payload_hash)
   throw Error('Confirmação de sincronização inválida: evento permanece pendente.');
  await db.prepare("UPDATE offline_outbox SET status='ACKED',acked_at=? WHERE sequence=? AND status='PENDING'")
   .bind(Date.now(),row.sequence).run();
  acknowledged++;
 }
 return {acknowledged,conflicts:0,blocked:false};
}

/** Explicit owner-requested handoff back to Cloudflare.
 * Stops new local mutations before sending outstanding events to D1. */
export async function finishOfflineAuthority(db,env,{fetcher=fetch}={}){
 const scope=await db.prepare('SELECT tenant_id AS tenantId,branch_id AS branchId,gateway_id AS gatewayId,epoch,mode FROM offline_local_authority LIMIT 1').bind().first();
 if(!scope||!['LOCAL','RECONCILING'].includes(scope.mode))
   throw Object.assign(Error('O PC não está na autoridade local.'),{status:409});
 if(scope.gatewayId!==env.OFFLINE_GATEWAY_ID)throw Error('O gateway local não corresponde à autorização.');
 await db.prepare("UPDATE offline_local_authority SET mode='RECONCILING' WHERE tenant_id=? AND branch_id=?")
  .bind(scope.tenantId,scope.branchId).run();
 let acknowledged=0;
 // The transport batch is intentionally small; a restaurant may accumulate
 // hundreds of movements through a WAN outage. Drain in bounded pages while
 // keeping the local write fence active until the full queue is ACKed.
 for(let batch=0;batch<80;batch++){
   const result=await pushOfflineOutbox(db,env,{fetcher,maxBatch:25});
   acknowledged+=result.acknowledged;
   if(result.conflicts)throw Object.assign(Error('Conflitos precisam de revisão; não é seguro liberar a nuvem.'),{status:409});
   if(result.acknowledged<25)break;
 }
 const progress=await db.prepare("SELECT COUNT(*) AS pending FROM offline_outbox WHERE tenant_id=? AND branch_id=? AND status IN('PENDING','CONFLICT')")
  .bind(scope.tenantId,scope.branchId).first();
 if(progress.pending)throw Object.assign(Error('Há operações sem ACK do D1.'),{status:409});
 const seq=await db.prepare('SELECT COALESCE(MAX(sequence),0) AS seq FROM offline_outbox WHERE tenant_id=? AND branch_id=? AND epoch=?')
  .bind(scope.tenantId,scope.branchId,scope.epoch).first();
 const origin=new URL(env.OFFLINE_CLOUD_ORIGIN);
 const response=await fetcher(origin.origin+'/api/v1/offline/gateway/release',{
  method:'POST',headers:{authorization:'Bearer '+env.OFFLINE_GATEWAY_TOKEN,
    'x-pdv-offline-gateway-id':scope.gatewayId,'content-type':'application/json'},
  body:JSON.stringify({epoch:scope.epoch,lastSequence:seq.seq}),
  redirect:'error',signal:AbortSignal.timeout(15000),cache:'no-store'});
 if(!response.ok)throw Object.assign(Error('D1 recusou encerrar o modo offline.'),{status:response.status});
 const ack=await response.json();
 if(ack.released!==true||ack.epoch!==scope.epoch)throw Error('Confirmação de liberação inválida.');
 await db.prepare("UPDATE offline_local_authority SET mode='CLOUD',refreshed_at=? WHERE tenant_id=? AND branch_id=?")
  .bind(Date.now(),scope.tenantId,scope.branchId).run();
 return {released:true,epoch:scope.epoch,acknowledged};
}
