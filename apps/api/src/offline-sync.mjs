import {sha256} from './password.mjs';
import {commerceRoute} from './commerce-router.mjs';
import {tenantWriteAllowed} from './saas-control.mjs';
const reply=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const fail=(status,s)=>reply({error:s},status);
const ID=/^[a-zA-Z0-9-]{1,128}$/;
const MUT=/^[A-Za-z0-9_-]{8,100}$/;
const WRITE_PATH=/^\/api\/v1\/tenants\/([^/]+)\/inventory\/(receipts|adjustments)$/;
export async function activateOfflineBranch(db,tenantId,gatewayId,now){
 const gateway=await db.prepare('SELECT id,branch_id AS branchId FROM offline_gateways WHERE id=? AND tenant_id=? AND active=1')
  .bind(gatewayId,tenantId).first();
 if(!gateway)return fail(404,'Servidor offline revogado ou não encontrado.');
 const exists=await db.prepare('SELECT mode,gateway_id AS gatewayId FROM offline_branch_authority WHERE tenant_id=? AND branch_id=?')
  .bind(tenantId,gateway.branchId).first();
 if(exists&&exists.mode!=='CLOUD')return fail(409,'Filial já reservada ou em reconciliação; não troque de PC antes de concluir todos os ACKs.');
 await db.prepare("INSERT INTO offline_branch_authority(tenant_id,branch_id,gateway_id,epoch,mode,activated_at) VALUES(?,?,?,1,'LOCAL',?) ON CONFLICT(tenant_id,branch_id) DO UPDATE SET gateway_id=excluded.gateway_id,epoch=offline_branch_authority.epoch+1,mode='LOCAL',activated_at=excluded.activated_at")
  .bind(tenantId,gateway.branchId,gatewayId,now).run();
 const active=await db.prepare('SELECT epoch,mode FROM offline_branch_authority WHERE tenant_id=? AND branch_id=?')
  .bind(tenantId,gateway.branchId).first();
 return reply({branchId:gateway.branchId,gatewayId,epoch:active.epoch,mode:active.mode,
  note:'Escritas SaaS desta filial estão bloqueadas. Antes de operar offline, sincronize novamente o PC.'});
}
export async function offlineBranchCloudWriteDenied(db,tenantId,branchId){
 if(!branchId||!ID.test(branchId))return false;
 const row=await db.prepare("SELECT 1 AS locked FROM offline_branch_authority WHERE tenant_id=? AND branch_id=? AND mode IN('LOCAL','RECONCILING')")
  .bind(tenantId,branchId).first();
 return !!row;
}
export async function offlineReplayRoute(request,db,env,now=Date.now()){
 if(request.method!=='POST')return fail(405,'Método não permitido.');
 const gatewayId=request.headers.get('x-pdv-offline-gateway-id')||'';
 const secret=/^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization')||'');
 if(!secret||!ID.test(gatewayId))return fail(401,'Credenciais do servidor offline inválidas.');
 const hash=await sha256(secret[1]);
 const gateway=await db.prepare('SELECT g.id,g.tenant_id AS tenantId,g.branch_id AS branchId FROM offline_gateways g JOIN tenants t ON t.id=g.tenant_id AND t.active=1 JOIN branches b ON b.id=g.branch_id AND b.tenant_id=g.tenant_id AND b.active=1 WHERE g.id=? AND g.credential_hash=? AND g.active=1')
  .bind(gatewayId,hash).first();
 if(!gateway)return fail(401,'Servidor offline revogado.');
 const auth=await db.prepare('SELECT epoch,gateway_id AS gatewayId,mode FROM offline_branch_authority WHERE tenant_id=? AND branch_id=?')
  .bind(gateway.tenantId,gateway.branchId).first();
 if(!auth||auth.gatewayId!==gatewayId||auth.mode!=='LOCAL')
  return fail(423,'Filial não está reservada para este servidor offline.');
 let raw;
 try{raw=await request.text();}catch{return fail(400,'JSON inválido.');}
 if(raw.length>16384)return fail(413,'Operação grande demais.');
 let value;try{value=JSON.parse(raw);}catch{return fail(400,'JSON inválido.');}
 if(!value||typeof value!=='object'||Array.isArray(value))return fail(400,'Dados inválidos.');
 const {sequence,epoch,mutationId,path,method,body,operatorId,payloadHash}=value;
 if(!Number.isInteger(sequence)||sequence<1||sequence>2147483647||
  epoch!==auth.epoch||!MUT.test(mutationId)||method!=='POST'||!ID.test(operatorId)|| 
  !WRITE_PATH.test(path||'')||!body||typeof body!=='object'||Array.isArray(body)||
  !/^[a-f0-9]{64}$/.test(payloadHash||''))
  return fail(409,'Lote offline incompatível com a autoridade atual.');
 const parsed=WRITE_PATH.exec(path);
 if(parsed[1]!==gateway.tenantId||body.branchId!==gateway.branchId)
  return fail(403,'Operação de outra empresa ou filial não autorizada.');
 const recomputed=await sha256(JSON.stringify({method,path,body:JSON.stringify(body),userId:operatorId}));
 if(recomputed!==payloadHash)return fail(409,'Conteúdo da operação foi modificado.');
 const old=await db.prepare('SELECT epoch,sequence,mutation_id AS mutationId,payload_hash AS payloadHash FROM offline_replay_receipts WHERE tenant_id=? AND branch_id=? AND ((epoch=? AND sequence=?) OR mutation_id=?)')
  .bind(gateway.tenantId,gateway.branchId,auth.epoch,sequence,mutationId).first();
 if(old)return old.epoch===auth.epoch&&old.sequence===sequence&&old.mutationId===mutationId&&old.payloadHash===payloadHash?
  reply({acknowledged:true,sequence,payloadHash,repeated:true}):fail(409,'Conflito de sequência ou chave de operação.');
 const operator=await db.prepare('SELECT m.profile_key AS profileKey FROM tenant_memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.user_id=? AND m.active=1 AND u.active=1')
  .bind(gateway.tenantId,operatorId).first();
 if(!operator)return fail(403,'Funcionário foi desativado ou perdeu vínculo.');
 if(!await tenantWriteAllowed(db,gateway.tenantId,env,now))
  return fail(402,'Assinatura inativa. Não é possível confirmar operações pendentes.');
 const priorGrant=await db.prepare('SELECT payload_hash AS payloadHash,epoch,gateway_id AS gatewayId FROM offline_replay_grants WHERE tenant_id=? AND branch_id=? AND mutation_id=?')
  .bind(gateway.tenantId,gateway.branchId,mutationId).first();
 if(priorGrant&&(priorGrant.payloadHash!==payloadHash||priorGrant.epoch!==auth.epoch||priorGrant.gatewayId!==gatewayId))
  return fail(409,'Chave de operação usada por outro evento.');
 if(!priorGrant)await db.prepare('INSERT INTO offline_replay_grants(tenant_id,branch_id,mutation_id,gateway_id,epoch,payload_hash,created_at) VALUES(?,?,?,?,?,?,?)')
  .bind(gateway.tenantId,gateway.branchId,mutationId,gatewayId,auth.epoch,payloadHash,now).run();
 const origin=new URL(request.url).origin;
 const canonical=new Request(origin+path,{method:'POST',headers:{'content-type':'application/json','origin':origin,'x-mutation-id':mutationId},
  body:JSON.stringify(body)});
 let actual;try{
  actual=await commerceRoute(canonical,db,{userId:operatorId},operator,gateway.tenantId,
    path.replace('/api/v1/tenants/'+gateway.tenantId+'/',''),{now:()=>new Date(now).toISOString()});
 }catch{return fail(503,'Não foi possível confirmar lançamento.');}
 if(!actual||!actual.ok){
  const status=actual?.status||500;
  return fail(status,'Reconciliador não confirmou operação ('+status+').');
 }
 const result=await actual.text();
 try{
  await db.prepare('INSERT INTO offline_replay_receipts(tenant_id,branch_id,epoch,sequence,mutation_id,payload_hash,result_json,acked_at) VALUES(?,?,?,?,?,?,?,?)')
   .bind(gateway.tenantId,gateway.branchId,auth.epoch,sequence,mutationId,payloadHash,result,now).run();
 }catch(error){
  const receipt=await db.prepare('SELECT payload_hash AS hash FROM offline_replay_receipts WHERE tenant_id=? AND branch_id=? AND epoch=? AND sequence=? AND mutation_id=?')
   .bind(gateway.tenantId,gateway.branchId,auth.epoch,sequence,mutationId).first();
  if(receipt?.hash!==payloadHash)return fail(409,'Conflito no registro de confirmação do D1.');
 }
 return reply({acknowledged:true,sequence,payloadHash});
}

/** Release a cloud writer lock only after the local gateway has received
 * acknowledgments for every monotonically numbered outbox event. */
export async function offlineReleaseRoute(request,db){
 if(request.method!=='POST')return fail(405,'Método não permitido.');
 const gatewayId=request.headers.get('x-pdv-offline-gateway-id')||'';
 const secret=/^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization')||'');
 if(!secret||!ID.test(gatewayId))return fail(401,'Servidor inválido.');
 const hash=await sha256(secret[1]);
 const gateway=await db.prepare('SELECT tenant_id AS tenantId,branch_id AS branchId FROM offline_gateways WHERE id=? AND active=1 AND credential_hash=?')
   .bind(gatewayId,hash).first();
 if(!gateway)return fail(401,'Servidor revogado.');
 let data;try{data=await request.json();}catch{return fail(400,'JSON inválido.');}
 if(!Number.isSafeInteger(data?.epoch)||!Number.isSafeInteger(data?.lastSequence)||data.lastSequence<0)
   return fail(400,'Sequência inválida.');
 const writer=await db.prepare('SELECT epoch,mode,gateway_id AS gatewayId FROM offline_branch_authority WHERE tenant_id=? AND branch_id=?')
  .bind(gateway.tenantId,gateway.branchId).first();
 if(!writer||writer.gatewayId!==gatewayId||writer.epoch!==data.epoch)return fail(409,'Autoridade alterada.');
 if(writer.mode==='CLOUD')return reply({released:true,epoch:writer.epoch,repeated:true});
 if(writer.mode!=='LOCAL')return fail(423,'Filial já em reconciliação.');
 const progress=await db.prepare('SELECT COUNT(*) AS n,COALESCE(MAX(sequence),0) AS latest FROM offline_replay_receipts WHERE tenant_id=? AND branch_id=? AND epoch=?')
  .bind(gateway.tenantId,gateway.branchId,writer.epoch).first();
 if(progress.n!==data.lastSequence||progress.latest!==data.lastSequence)
  return fail(409,'Há operações pendentes ou lacunas no histórico de confirmação.');
 const result=await db.prepare("UPDATE offline_branch_authority SET mode='CLOUD' WHERE tenant_id=? AND branch_id=? AND gateway_id=? AND epoch=? AND mode='LOCAL'")
  .bind(gateway.tenantId,gateway.branchId,gatewayId,writer.epoch).run();
 return result.meta.changes?reply({released:true,epoch:writer.epoch}):fail(409,'Autoridade mudou durante a reconciliação.');
}
