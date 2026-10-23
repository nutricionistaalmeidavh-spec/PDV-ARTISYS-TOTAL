// Opt-in Cloudflare -> local PC read-only baseline; never a sale-sync endpoint.
// Machine credentials and password hashes must never enter browser JS or logs.
import {newSessionToken,sha256} from './password.mjs';
import {activateOfflineBranch} from './offline-sync.mjs';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{
 'content-type':'application/json; charset=utf-8','cache-control':'no-store',
 'x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
const bad=(status,error)=>json({error},status);
const LIMIT=2500;
async function rows(db,sql,...params){
 const {results}=await db.prepare(sql).bind(...params).all();
 if(results.length>LIMIT)throw Object.assign(Error('Volume excede o lote seguro.'),{status:413});
 return results;
}
const ID=/^[0-9a-zA-Z-]{1,128}$/;
export async function offlineGatewayAdminRoute(request,db,member,session,tenantId,path,now){
 if(member.profileKey!=='OWNER')return bad(403,'Somente o proprietário pode autorizar servidores offline.');
 if(!ID.test(tenantId))return bad(400,'Empresa inválida.');
 if(path==='offline/gateways'&&request.method==='GET'){
  return json({gateways:await rows(db,'SELECT id,branch_id AS branchId,label,active,created_at AS createdAt,revoked_at AS revokedAt FROM offline_gateways WHERE tenant_id=? ORDER BY created_at DESC,id DESC',tenantId)});
 }
 if(path==='offline/gateways'&&request.method==='POST'){
  let body;try{body=await request.json();}catch{return bad(400,'JSON inválido.');}
  const branchId=String(body?.branchId||''),label=String(body?.label||'').trim();
  if(!ID.test(branchId)||label.length<1||label.length>80)return bad(400,'Filial ou identificação inválida.');
  const found=await db.prepare('SELECT id FROM branches WHERE id=? AND tenant_id=? AND active=1').bind(branchId,tenantId).first();
  if(!found)return bad(404,'Filial não encontrada.');
  const id=crypto.randomUUID(),credential=newSessionToken(),hash=await sha256(credential);
  await db.prepare('INSERT INTO offline_gateways(id,tenant_id,branch_id,label,credential_hash,created_by,created_at) VALUES(?,?,?,?,?,?,?)')
   .bind(id,tenantId,branchId,label,hash,session.userId,now).run();
  return json({gateway:{id,tenantId,branchId,label},credential,
   note:'Guarde o segredo somente no servidor local. A cópia atual é somente leitura; operações comerciais não são sincronizadas.'},201);
 }
 const activate=/^offline\\/gateways\\/([0-9a-zA-Z-]{1,128})\\/activate$/.exec(path);
 if(activate&&request.method==='POST')return activateOfflineBranch(db,tenantId,activate[1],now);
 const revoke=/^offline\/gateways\/([0-9a-zA-Z-]{1,128})$/.exec(path);
 if(revoke&&request.method==='DELETE'){
  const result=await db.prepare('UPDATE offline_gateways SET active=0,revoked_at=? WHERE id=? AND tenant_id=? AND active=1')
   .bind(now,revoke[1],tenantId).run();
  return result.meta.changes?json({revoked:true}):bad(404,'Servidor não encontrado ou já revogado.');
 }
 return bad(405,'Método não permitido.');
}
export async function offlineGatewayMachineRoute(request,db,env={}){
 if(request.method!=='GET'||new URL(request.url).pathname!=='/api/v1/offline/gateway/snapshot')
  return bad(405,'Operação não disponível.');
 const gatewayId=request.headers.get('x-pdv-offline-gateway-id')||'';
 const authorization=request.headers.get('authorization')||'';
 const match=/^Bearer ([a-f0-9]{64})$/.exec(authorization);
 if(!ID.test(gatewayId)||!match)return bad(401,'Servidor não autorizado.');
 const hash=await sha256(match[1]);
 const gateway=await db.prepare('SELECT g.id,g.tenant_id AS tenantId,g.branch_id AS branchId FROM offline_gateways g JOIN tenants t ON t.id=g.tenant_id AND t.active=1 JOIN branches b ON b.id=g.branch_id AND b.tenant_id=g.tenant_id AND b.active=1 WHERE g.id=? AND g.credential_hash=? AND g.active=1')
  .bind(gatewayId,hash).first();
 if(!gateway)return bad(401,'Servidor não autorizado ou revogado.');
 const tenantId=gateway.tenantId,branchId=gateway.branchId;
 try{
  const tenant=await db.prepare('SELECT id,slug,name,active,created_at FROM tenants WHERE id=?').bind(tenantId).first();
  const branches=await rows(db,'SELECT id,tenant_id,code,name,active,created_at FROM branches WHERE tenant_id=? AND id=?',tenantId,branchId);
  const memberships=await rows(db,'SELECT tenant_id,user_id,profile_key,active,created_at FROM tenant_memberships WHERE tenant_id=?',tenantId);
  // Only associated users. Password hashes are machine-only and never logged.
  // Enrolled MFA is not safely portable without TOTP key material. Fail closed:
  // never convert an MFA-protected SaaS account into password-only local login.
  const protectedUsers=await db.prepare('SELECT COUNT(*) AS n FROM saas_mfa_totp t JOIN tenant_memberships m ON m.user_id=t.user_id WHERE m.tenant_id=? AND t.enrolled_at IS NOT NULL')
    .bind(tenantId).first();
  if(protectedUsers?.n>0)return bad(412,'Há conta com MFA ativo. Autenticação MFA local ainda não homologada.');
  if(env.EMAIL_VERIFICATION_REQUIRED==='true'){
    const unverified=await db.prepare('SELECT COUNT(*) AS n FROM users u JOIN tenant_memberships m ON m.user_id=u.id WHERE m.tenant_id=? AND u.active=1 AND u.email_verified_at IS NULL')
      .bind(tenantId).first();
    if(unverified?.n>0)return bad(412,'Há conta não verificada. Habilitação offline requer verificação de e-mail antes da cópia.');
  }
  const users=await rows(db,'SELECT u.id,u.email_norm,u.display_name,u.password_hash,u.active,u.created_at,u.email_verified_at FROM users u JOIN tenant_memberships m ON m.user_id=u.id WHERE m.tenant_id=?',tenantId);
  const productCategories=await rows(db,'SELECT * FROM product_categories WHERE tenant_id=?',tenantId);
  const products=await rows(db,'SELECT * FROM products WHERE tenant_id=? ORDER BY CASE WHEN parent_product_id IS NULL THEN 0 ELSE 1 END,id',tenantId);
  const stockPositions=await rows(db,'SELECT * FROM stock_positions WHERE tenant_id=? AND branch_id=?',tenantId,branchId);
  const authority=await db.prepare('SELECT epoch,mode,gateway_id AS gatewayId FROM offline_branch_authority WHERE tenant_id=? AND branch_id=?').bind(tenantId,branchId).first();
  // No auth sessions, SaaS license secrets, payments, cash or sales copied.
  return json({version:1,scope:{tenantId,branchId,gatewayId},baselineOnly:true,
    authority:authority&&authority.gatewayId===gatewayId?{mode:authority.mode,epoch:authority.epoch}:{mode:'CLOUD',epoch:0},
    createdAt:new Date().toISOString(),tables:{tenants:[tenant],branches,users,
      tenant_memberships:memberships,product_categories:productCategories,products,stock_positions:stockPositions}});
 }catch(error){
  return bad(error.status===413?413:503,'Não foi possível criar a cópia. Operações offline bloqueadas.');
 }
}
