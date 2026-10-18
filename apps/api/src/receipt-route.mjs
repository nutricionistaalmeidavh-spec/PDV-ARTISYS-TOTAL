// R3 hosted-web receipt identity: authoritative branch state; transaction-time sale snapshot.
import {createCommerceService} from './commerce.mjs';
import canonicalAuthorization from '../../../packages/core/js/core/auth/authorization-service.js';
import canonicalProfiles from '../../../packages/core/js/core/auth/default-profiles.js';
const {createAuthorizationService}=canonicalAuthorization;
const {DEFAULT_PROFILE_PERMISSIONS}=canonicalProfiles;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const fail=(n,m)=>json({error:m},n);
const DEFAULT=Object.freeze({name:'PDV TOTAL',address:'',phone:'',logoDataUrl:null});
const clean=(s,max)=>String(s??'').replace(/[\r\n\t]+/g,' ').replace(/\s{2,}/g,' ').trim().slice(0,max);
const MAX_PNG_BYTES=512*1024;
function logo(value){
 if(value===null||value===undefined||value==='')return null;
 if(typeof value!=='string'||value.length>4*Math.ceil(MAX_PNG_BYTES/3)+50)throw Object.assign(Error('Logotipo PNG muito grande.'),{status:413});
 const match=/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
 if(!match)throw Object.assign(Error('Somente PNG em base64.'),{status:400});
 let bytes;try{bytes=atob(match[1]);}catch{throw Object.assign(Error('PNG inválido.'),{status:400});}
 const signature=[137,80,78,71,13,10,26,10];
 if(bytes.length<24||bytes.length>MAX_PNG_BYTES||signature.some((b,i)=>bytes.charCodeAt(i)!==b))
  throw Object.assign(Error('Assinatura de PNG inválida.'),{status:400});
 return 'data:image/png;base64,'+match[1];
}
export function normalizeReceiptBranding(input){
 if(!input||Array.isArray(input)||typeof input!=='object')throw Object.assign(Error('Configuração inválida.'),{status:400});
 return {name:clean(input.name,80)||DEFAULT.name,address:clean(input.address,160),
   phone:clean(input.phone,60),logoDataUrl:logo(input.logoDataUrl)};
}
function authorized(member,userId,cap){
 const profile=member.profileKey==='OWNER'?'ADMINISTRATOR':member.profileKey;
 const auth=createAuthorizationService({resolvePermissions:()=>DEFAULT_PROFILE_PERMISSIONS[profile]||[]});
 if(!auth.can({principal:{kind:'human',id:userId},capability:cap}))
  throw Object.assign(Error('Permissão insuficiente.'),{status:403});
}
async function branchExists(db,t,b){
 const row=b&&await db.prepare('SELECT id FROM branches WHERE id=? AND tenant_id=? AND active=1').bind(b,t).first();
 if(!row)throw Object.assign(Error('Filial não encontrada.'),{status:404});
}
async function configured(db,t,b){
 const row=await db.prepare('SELECT name,address,phone,logo_data_url AS logoDataUrl,version FROM r3_receipt_branding WHERE tenant_id=? AND branch_id=?').bind(t,b).first();
 return row?{name:row.name,address:row.address,phone:row.phone,logoDataUrl:row.logoDataUrl,version:row.version}:{...DEFAULT,version:0};
}
export async function receiptRoute(request,db,session,member,t,path){
 const parts=path.split('/').filter(Boolean),method=request.method;
 const branding=parts[0]==='printing'&&parts[1]==='branding'&&parts.length===2;
 const receipt=parts[0]==='sales'&&parts.length===3&&parts[2]==='receipt';
 const prebill=parts[0]==='sales'&&parts.length===3&&parts[2]==='prebill';
 if(!branding&&!receipt&&!prebill)return null;
 const url=new URL(request.url);
 try{
  const b=(method==='GET'?url.searchParams.get('branchId'):null)||null;
  if(branding&&method==='GET'){
   authorized(member,session.userId,'settings.view');await branchExists(db,t,b);
   return json({branding:await configured(db,t,b)});
  }
  if(branding&&method==='PUT'){
   authorized(member,session.userId,'settings.manage');
   if(!request.headers.get('content-type')?.includes('application/json'))return fail(415,'JSON obrigatório.');
   if(Number(request.headers.get('content-length')||0)>730000)return fail(413,'Arquivo muito grande.');
   const raw=await request.text();
   if(raw.length>730000)return fail(413,'Arquivo muito grande.');
   let body;try{body=JSON.parse(raw);}catch{return fail(400,'JSON inválido.');}
   const branch=body?.branchId;await branchExists(db,t,branch);
   const value=normalizeReceiptBranding(body);
   // Atomic upsert with a monotonic version; update cannot mutate a past receipt.
   await db.prepare(`INSERT INTO r3_receipt_branding(tenant_id,branch_id,name,address,phone,logo_data_url,version,updated_by,updated_at)
     VALUES(?,?,?,?,?,?,1,?,?)
     ON CONFLICT(tenant_id,branch_id) DO UPDATE SET
     name=excluded.name,address=excluded.address,phone=excluded.phone,
     logo_data_url=excluded.logo_data_url,version=r3_receipt_branding.version+1,
     updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
    .bind(t,branch,value.name,value.address,value.phone,value.logoDataUrl,session.userId,new Date().toISOString()).run();
   return json({branding:await configured(db,t,branch)});
  }
  if((receipt||prebill)&&method==='GET'){
   authorized(member,session.userId,'sales.view');await branchExists(db,t,b);
   const sale=await createCommerceService(db).sale(t,b,parts[1]);
   if(receipt&&sale.status!=='COMPLETED')return fail(409,'Somente vendas concluídas possuem comprovante definitivo.');
   if(prebill&&!['OPEN','SUSPENDED'].includes(sale.status))return fail(409,'Pré-conta disponível somente em vendas ainda abertas.');
   let identity;
   if(receipt){
    const freeze=await db.prepare('SELECT branding_json FROM r3_sale_branding_snapshots WHERE tenant_id=? AND branch_id=? AND sale_id=?').bind(t,b,parts[1]).first();
    if(!freeze)return fail(409,'Comprovante sem snapshot na conclusão. Não imprimir com marca alterada.');
    identity=JSON.parse(freeze.branding_json);
   }else identity=await configured(db,t,b);
   return json({sale,branding:identity,documentType:receipt?'SALE_RECEIPT':'PREBILL',fiscal:false});
  }
  return fail(405,'Método não permitido.');
 }catch(e){return fail(e?.status||500,e?.status?e.message:'Falha ao processar comprovante.');}
}
