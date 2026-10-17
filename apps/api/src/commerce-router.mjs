import {createCommerceService,commerceError} from './commerce.mjs';
import canonicalAuthorization from '../../../packages/core/js/core/auth/authorization-service.js';
import canonicalProfiles from '../../../packages/core/js/core/auth/default-profiles.js';

const {createAuthorizationService}=canonicalAuthorization;
const {DEFAULT_PROFILE_PERMISSIONS}=canonicalProfiles;
const writeMethods=new Set(['POST','PUT','PATCH','DELETE']);
const json=(data,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}
});
const fail=(status,message)=>json({error:message},status);

async function payload(request){
  const length=Number(request.headers.get('content-length')||0);
  if(length>16384)throw Object.assign(new Error('Pedido muito grande.'),{status:413});
  if(!String(request.headers.get('content-type')||'').includes('application/json'))
    throw Object.assign(new Error('Envie dados em JSON.'),{status:415});
  const raw=await request.text();
  if(raw.length>16384)throw Object.assign(new Error('Pedido muito grande.'),{status:413});
  let body;try{body=JSON.parse(raw);}catch{}
  if(!body||Array.isArray(body)||typeof body!=='object')
    throw Object.assign(new Error('Dados inválidos.'),{status:400});
  return body;
}
function can(profileKey,capability,userId){
  const key=profileKey==='OWNER'?'ADMINISTRATOR':profileKey;
  return createAuthorizationService({
    resolvePermissions:()=>DEFAULT_PROFILE_PERMISSIONS[key]||[]
  }).can({principal:{kind:'human',id:userId},capability});
}
const requireAccess=(membership,capability,userId)=>{
  if(!can(membership.profileKey,capability,userId))
    throw Object.assign(new Error('Permissão insuficiente.'),{status:403});
};
export async function commerceRoute(request,db,session,member,tenantId,path){
  const url=new URL(request.url),method=request.method;
  const parts=path.split('/').filter(Boolean);
  const feature=parts[0];
  const key=request.headers.get('x-mutation-id');
  try {
    if(!['products','inventory','cash','sales'].includes(feature))return null;
    const body=writeMethods.has(method)?await payload(request):{};
    const branch=body.branchId||url.searchParams.get('branchId');
    const service=createCommerceService(db);
    if(!branch)throw Object.assign(new Error('Selecione a filial antes de continuar.'),{status:400});
    const tenant=tenantId,user=session.userId;
    if(feature==='products'){
      if(parts.length!==1)return null;
      if(method==='GET'){
        requireAccess(member,'products.view',user);
        return json({products:await service.products(tenant,branch,{limit:100})});
      }
      if(method==='POST'){
        requireAccess(member,'products.manage',user);
        return json({product:await service.createProduct(tenant,user,body,key)},201);
      }
    }
    if(feature==='inventory'){
      if(parts.length===1&&method==='GET'){
        requireAccess(member,'inventory.view',user);
        return json({stock:await service.stock(tenant,branch)});
      }
      if(parts[1]==='receipts'&&parts.length===2&&method==='POST'){
        requireAccess(member,'inventory.adjust',user);
        return json({movement:await service.receipt(tenant,branch,body,key)},201);
      }
    }
    if(feature==='cash'){
      if(parts.length===1&&method==='GET'){
        requireAccess(member,'cash.view',user);
        return json({session:await service.cash(tenant,branch)});
      }
      if(parts[1]==='open'&&parts.length===2&&method==='POST'){
        requireAccess(member,'cash.open',user);
        return json({session:await service.openCash(tenant,branch,user,body,key)},201);
      }
    }
    if(feature==='sales'){
      if(parts.length===1&&method==='GET'){
        requireAccess(member,'sales.view',user);
        return json({sales:await service.listSales(tenant,branch,25)});
      }
      if(parts.length===1&&method==='POST'){
        requireAccess(member,'sales.create',user);
        return json({sale:await service.openSale(tenant,branch,user,body,key)},201);
      }
      const id=parts[1];
      if(!id||id.length>128)return null;
      if(parts.length===2&&method==='GET'){
        requireAccess(member,'sales.view',user);
        return json({sale:await service.sale(tenant,branch,id)});
      }
      requireAccess(member,'sales.create',user);
      if(parts[2]==='items'){
        if(parts.length===3&&method==='POST')
          return json({sale:await service.addItem(tenant,branch,id,body,key)});
        if(parts.length===4&&method==='PUT')
          return json({sale:await service.changeItem(tenant,branch,id,decodeURIComponent(parts[3]),body.quantity)});
        if(parts.length===4&&method==='DELETE')
          return json({sale:await service.removeItem(tenant,branch,id,decodeURIComponent(parts[3]))});
      }
      if(parts.length===3&&parts[2]==='discount'&&method==='POST'){
        requireAccess(member,'sales.discount',user);
        return json({sale:await service.discount(tenant,branch,id,body.discountCents)});
      }
      if(parts.length===3&&parts[2]==='suspend'&&method==='POST')
        return json({sale:await service.transition(tenant,branch,id,'SUSPENDED')});
      if(parts.length===3&&parts[2]==='resume'&&method==='POST')
        return json({sale:await service.transition(tenant,branch,id,'OPEN')});
      if(parts.length===3&&parts[2]==='cancel'&&method==='POST'){
        requireAccess(member,'sales.cancel',user);
        return json({sale:await service.transition(tenant,branch,id,'CANCELLED')});
      }
      if(parts.length===3&&parts[2]==='complete'&&method==='POST')
        return json({sale:await service.complete(tenant,branch,id,user,body,key)});
    }
    return null;
  }catch(e){
    const parsed=commerceError(e);
    return fail(parsed.status,parsed.message);
  }
}
