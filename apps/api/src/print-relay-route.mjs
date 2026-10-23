// Authenticated outbound-only printing. Browser sends sale identity, never arbitrary printer text.
import {sha256} from './password.mjs';
import {receiptRoute} from './receipt-route.mjs';
import canonicalAuthorization from '../../../packages/core/js/core/auth/authorization-service.js';
import canonicalProfiles from '../../../packages/core/js/core/auth/default-profiles.js';
const {createAuthorizationService}=canonicalAuthorization,{DEFAULT_PROFILE_PERMISSIONS}=canonicalProfiles;
const json=(d,status=200)=>new Response(JSON.stringify(d),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const error=(status,message)=>Object.assign(Error(message),{status});
const q=(db,sql,...args)=>db.prepare(sql).bind(...args);
const id=()=>crypto.randomUUID();
const secret=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
const uuid=/^[a-f0-9-]{36}$/i,salePattern=/^[a-zA-Z0-9_-]{4,120}$/;
const projection='id,agent_id AS agentId,sale_id AS saleId,status,attempts,last_error AS lastError,created_at AS createdAt,updated_at AS updatedAt';
const agentPublic=(a,now)=>({id:a.id,label:a.label,active:a.active===1,lastSeenAt:a.lastSeenAt||null,online:!!(a.active&&a.lastSeenAt&&now-a.lastSeenAt<60000)});
const jobPublic=j=>({id:j.id,agentId:j.agentId,saleId:j.saleId,status:j.status,attempts:j.attempts,lastError:j.lastError||null,createdAt:j.createdAt,updatedAt:j.updatedAt,physicallyPrinted:false});
function allow(member,user,capability){
 const profile=member.profileKey==='OWNER'?'ADMINISTRATOR':member.profileKey;
 const auth=createAuthorizationService({resolvePermissions:()=>DEFAULT_PROFILE_PERMISSIONS[profile]||[]});
 if(!auth.can({principal:{kind:'human',id:user},capability}))throw error(403,'Permissão insuficiente.');
}
async function body(req){
 if(Number(req.headers.get('content-length')||0)>8192)throw error(413,'Pedido muito grande.');
 if(!req.headers.get('content-type')?.includes('application/json'))throw error(415,'JSON obrigatório.');
 const raw=await req.text();if(raw.length>8192)throw error(413,'Pedido muito grande.');
 let value;try{value=JSON.parse(raw);}catch{throw error(400,'JSON inválido.');}
 if(!value||Array.isArray(value)||typeof value!=='object')throw error(400,'Dados inválidos.');
 return value;
}
async function branch(db,t,b){
 if(typeof b!=='string'||!b||b.length>128)throw error(400,'Filial inválida.');
 if(!await q(db,'SELECT id FROM branches WHERE tenant_id=? AND id=? AND active=1',t,b).first())throw error(404,'Filial indisponível.');
}
async function agent(db,t,b,agentId){
 if(!uuid.test(String(agentId||'')))throw error(400,'Computador inválido.');
 const a=await q(db,'SELECT id,label,active,last_seen_at AS lastSeenAt FROM print_relay_agents WHERE tenant_id=? AND branch_id=? AND id=?',t,b,agentId).first();
 if(!a?.active)throw error(404,'Computador não autorizado para esta filial.');
 return a;
}
async function receipt(req,db,session,member,t,b,saleId){
 if(!salePattern.test(String(saleId||'')))throw error(400,'Venda inválida.');
 const sale=await q(db,'SELECT status FROM sales WHERE tenant_id=? AND branch_id=? AND id=?',t,b,saleId).first();
 if(!sale)throw error(404,'Venda não encontrada nesta filial.');
 if(sale.status!=='COMPLETED')throw error(409,'Só vendas concluídas podem ser impressas.');
 const u=new URL(req.url);u.pathname='/api/v1/tenants/'+encodeURIComponent(t)+'/sales/'+encodeURIComponent(saleId)+'/receipt';u.search='?branchId='+encodeURIComponent(b);
 const res=await receiptRoute(new Request(u),db,session,member,t,'sales/'+saleId+'/receipt');
 if(!res.ok){const failure=await res.json().catch(()=>({}));throw error(res.status,failure.error||'Comprovante indisponível.');}
 const d=await res.json();
 if(d.documentType!=='SALE_RECEIPT'||d.fiscal!==false||d.sale?.status!=='COMPLETED')throw error(409,'Comprovante inválido.');
 if(typeof d.text!=='string'||!d.text.trim()||d.text.length>14000||
   /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(d.text))throw error(422,'Comprovante incompatível.');
 return d.text;
}
export async function browserPrintRelayRoute(req,db,session,member,t,path,now=Date.now()){
 if(!path.startsWith('printing/remote/'))return null;
 const parts=path.split('/'),method=req.method;
 try{
  const input=method==='POST'||method==='DELETE'?await body(req):{};
  const b=method==='GET'?new URL(req.url).searchParams.get('branchId'):input.branchId;
  await branch(db,t,b);
  if(parts[2]==='agents'&&parts.length===3&&method==='GET'){
   allow(member,session.userId,'sales.view');
   const r=await q(db,'SELECT id,label,active,last_seen_at AS lastSeenAt FROM print_relay_agents WHERE tenant_id=? AND branch_id=? AND active=1 ORDER BY created_at DESC LIMIT 30',t,b).all();
   return json({agents:r.results.map(a=>agentPublic(a,now))});
  }
  if(parts[2]==='agents'&&parts.length===3&&method==='POST'){
   allow(member,session.userId,'settings.manage');
   const label=String(input.label||'').trim();
   if(!label||label.length>80||/[\x00-\x1f\x7f]/.test(label))throw error(400,'Nome do PC inválido.');
   const cnt=await q(db,'SELECT count(*) AS n FROM print_relay_agents WHERE tenant_id=? AND branch_id=? AND active=1',t,b).first();
   if(cnt.n>=20)throw error(429,'Limite de computadores atingido.');
   const aid=id(),credential=secret();
   await q(db,'INSERT INTO print_relay_agents(id,tenant_id,branch_id,label,credential_hash,created_at) VALUES(?,?,?,?,?,?)',
     aid,t,b,label,await sha256(credential),now).run();
   return json({agent:{id:aid,label,online:false,active:true},token:credential},201);
  }
  if(parts[2]==='agents'&&parts.length===4&&method==='DELETE'){
   allow(member,session.userId,'settings.manage');
   const a=await agent(db,t,b,parts[3]);
   await q(db,'UPDATE print_relay_agents SET active=0 WHERE id=? AND tenant_id=? AND branch_id=?',a.id,t,b).run();
   await q(db,"UPDATE print_relay_jobs SET status='FAILED',last_error='Computador revogado.',updated_at=? WHERE agent_id=? AND status='PENDING'",now,a.id).run();
   await q(db,"UPDATE print_relay_jobs SET status='UNCERTAIN',last_error='Computador revogado durante envio.',updated_at=? WHERE agent_id=? AND status='LEASED'",now,a.id).run();
   return json({revoked:true});
  }
  if(parts[2]==='jobs'&&parts.length===3&&method==='GET'){
   allow(member,session.userId,'sales.view');
   const r=await q(db,'SELECT '+projection+' FROM print_relay_jobs WHERE tenant_id=? AND branch_id=? ORDER BY created_at DESC,id DESC LIMIT 30',t,b).all();
   return json({jobs:r.results.map(jobPublic)});
  }
  if(parts[2]==='jobs'&&parts.length===3&&method==='POST'){
   allow(member,session.userId,'sales.view');
   const a=await agent(db,t,b,input.agentId),saleId=input.saleId;
   if(!salePattern.test(String(saleId||'')))throw error(400,'Venda inválida.');
   if(input.reprint===true&&!uuid.test(String(input.requestId||'')))throw error(400,'Reimpressão sem identificação.');
   const key=input.reprint===true?'reprint:'+a.id+':'+input.requestId:'first:'+a.id+':'+saleId;
   const previous=await q(db,'SELECT '+projection+' FROM print_relay_jobs WHERE tenant_id=? AND branch_id=? AND idempotency_key=?',t,b,key).first();
   if(previous){if(previous.saleId!==saleId)throw error(409,'ID usado em outra venda.');return json({job:jobPublic(previous)});}
   const outstanding=await q(db,"SELECT count(*) AS n FROM print_relay_jobs WHERE agent_id=? AND status IN('PENDING','LEASED')",a.id).first();
   if(outstanding.n>=100)throw error(429,'Fila cheia, confira o computador.');
   const text=await receipt(req,db,session,member,t,b,saleId),jid=id();
   await q(db,"INSERT OR IGNORE INTO print_relay_jobs(id,tenant_id,branch_id,agent_id,sale_id,idempotency_key,receipt_text,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'PENDING',?,?,?)",
      jid,t,b,a.id,saleId,key,text,session.userId,now,now).run();
   const result=await q(db,'SELECT '+projection+' FROM print_relay_jobs WHERE tenant_id=? AND branch_id=? AND idempotency_key=?',t,b,key).first();
   if(result.saleId!==saleId)throw error(409,'ID usado em outra venda.');
   return json({job:jobPublic(result)},result.id===jid?201:200);
  }
  return json({error:'Ação não disponível.'},405);
 }catch(e){return json({error:e.status?e.message:'Falha ao solicitar impressão.'},e.status||500);}
}
export async function machinePrintRelayRoute(req,db,now=Date.now()){
 const u=new URL(req.url);
 if(!/^\/api\/v1\/print-relay\/agent\/(next|ack)$/.test(u.pathname))return null;
 if(req.method!=='POST')return json({error:'Método inválido.'},405);
 if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))return json({error:'HTTPS obrigatório.'},403);
 const raw=req.headers.get('authorization')||'';
 if(!/^Bearer [a-f0-9]{64}$/.test(raw))return json({error:'Credencial inválida.'},401);
 try{
  const a=await q(db,'SELECT id FROM print_relay_agents WHERE credential_hash=? AND active=1',await sha256(raw.slice(7))).first();
  if(!a)return json({error:'Credencial revogada.'},401);
  const input=await body(req);
  if(u.pathname.endsWith('/next')){
   await q(db,'UPDATE print_relay_agents SET last_seen_at=? WHERE id=? AND active=1',now,a.id).run();
   await q(db,"UPDATE print_relay_jobs SET status='UNCERTAIN',last_error='Reserva expirou; confira a impressora.',updated_at=? WHERE agent_id=? AND status='LEASED' AND lease_until<?",now,a.id,now).run();
   const job=await q(db,"SELECT id,sale_id AS saleId,receipt_text AS text FROM print_relay_jobs WHERE agent_id=? AND status='PENDING' ORDER BY created_at,id LIMIT 1",a.id).first();
   if(!job)return json({job:null});
   const leaseToken=secret(),leaseHash=await sha256(leaseToken);
   const change=await q(db,"UPDATE print_relay_jobs SET status='LEASED',lease_hash=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=? AND agent_id=? AND status='PENDING'",
     leaseHash,now+120000,now,job.id,a.id).run();
   if(!change.meta?.changes)return json({job:null});
   return json({job:{...job,leaseToken}});
  }
  if(!uuid.test(String(input.jobId||''))||!/^[a-f0-9]{64}$/.test(String(input.leaseToken||''))||
     !['SUBMITTED','FAILED','UNCERTAIN'].includes(input.status))throw error(400,'Confirmação inválida.');
  const leaseHash=await sha256(input.leaseToken);
  const current=await q(db,'SELECT '+projection+' FROM print_relay_jobs WHERE id=? AND agent_id=? AND lease_hash=?',input.jobId,a.id,leaseHash).first();
  if(!current)throw error(409,'Reserva inválida.');
  if(current.status===input.status)return json({job:jobPublic(current)});
  if(current.status!=='LEASED')throw error(409,'Reserva não está ativa.');
  const err=input.status==='SUBMITTED'?null:String(input.error||'Impressora indisponível.').slice(0,200);
  const result=await q(db,"UPDATE print_relay_jobs SET status=?,last_error=?,updated_at=? WHERE id=? AND agent_id=? AND lease_hash=? AND status='LEASED'",
    input.status,err,now,current.id,a.id,leaseHash).run();
  if(!result.meta?.changes)throw error(409,'Confirmação concorrente.');
  return json({job:jobPublic({...current,status:input.status,lastError:err,updatedAt:now})});
 }catch(e){return json({error:e.status?e.message:'Falha ao confirmar impressão.'},e.status||500);}
}
