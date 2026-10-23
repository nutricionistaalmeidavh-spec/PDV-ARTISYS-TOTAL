import {sha256} from './password.mjs';

// Only canonical inventory mutations with a durable commerce_mutations audit are
// permitted in this first transactional replay protocol. Never queue an
// unrecognized business operation: it would create an unrecoverable orphan.
const SUPPORTED=new Set(['inventory/receipts','inventory/adjustments']);
const MUTATION=/^[A-Za-z0-9_-]{8,100}$/;
const VALID_ID=/^[a-zA-Z0-9-]{1,128}$/;
function allowed(path,tenant){
 const match=path.match(/^\/api\/v1\/tenants\/([^/]+)\/(inventory\/(?:receipts|adjustments))$/);
 return match&&match[1]===tenant&&SUPPORTED.has(match[2]);
}
export async function stageOfflineMutation(db,request,{tenantId,branchId,userId,now=Date.now()}){
 const path=new URL(request.url).pathname,mutationId=request.headers.get('x-mutation-id')||'';
 if(!allowed(path,tenantId)||request.method!=='POST'||!MUTATION.test(mutationId))
  throw Object.assign(Error('Operação offline não suportada ou sem chave de idempotência.'),{status:403});
 const state=await db.prepare('SELECT a.gateway_id AS gatewayId,a.mode,a.refreshed_at AS refreshedAt FROM offline_local_authority a WHERE a.tenant_id=? AND a.branch_id=?').bind(tenantId,branchId).first();
 if(!state||state.mode!=='LOCAL'||now-state.refreshedAt>86400000)
  throw Object.assign(Error('Autoridade offline não confirmada para esta filial.'),{status:503});
 const raw=await request.clone().text();
 if(raw.length>8192)throw Object.assign(Error('Pedido offline excede tamanho máximo.'),{status:413});
 let body;try{body=JSON.parse(raw);}catch{}
 if(!body||Array.isArray(body)||typeof body!=='object'||body.branchId!==branchId)
  throw Object.assign(Error('Filial da operação offline inválida.'),{status:400});
 const bodyJson=JSON.stringify(body);
 const hash=await sha256(JSON.stringify({method:request.method,path,body:bodyJson,userId}));
 const prior=await db.prepare('SELECT payload_hash AS hash FROM offline_pending_requests WHERE tenant_id=? AND mutation_id=?').bind(tenantId,mutationId).first();
 if(prior&&prior.hash!==hash)
  throw Object.assign(Error('Chave de operação reutilizada com valores diferentes.'),{status:409});
 if(!prior)await db.prepare('INSERT INTO offline_pending_requests(tenant_id,branch_id,mutation_id,operator_id,method,path,body_json,payload_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
  .bind(tenantId,branchId,mutationId,userId,'POST',path,bodyJson,hash,now).run();
 return {mutationId,hash};
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
    operatorId:row.operator_id,payloadHash:row.payload_hash};
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
