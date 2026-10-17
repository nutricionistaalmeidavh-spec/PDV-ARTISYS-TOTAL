'use strict';

const {writeAudit}=require('../js/core/audit-log');
const {principalFromActor}=require('../js/core/auth/principal-resolver');

function domainError(statusCode,message){const error=new Error(message);error.statusCode=statusCode;return error;}

function asBoolean(value,fallback=true){
  if(value===undefined||value===null)return fallback;
  if(typeof value==='string'){
    const normalized=value.trim().toLowerCase();
    if(['false','0','no','off'].includes(normalized))return false;
    if(['true','1','yes','on'].includes(normalized))return true;
  }
  return Boolean(value);
}

function publicCategory(row){return row?{id:row.id,name:row.name,active:Boolean(row.active),createdAt:row.created_at,updatedAt:row.updated_at}:null;}
function publicSupplier(row){return row?{id:row.id,name:row.name,document:row.document,phone:row.phone,email:row.email,active:Boolean(row.active),createdAt:row.created_at,updatedAt:row.updated_at}:null;}

function createCatalogManagementService({db,catalog,account=null,authorization=null,profiles=null,now=()=>new Date().toISOString()}={}){
  if(!db)throw new TypeError('Database is required.');
  if(!catalog)throw new TypeError('Catalog service is required.');

  function requireCapability(actor,capability){
    if(!authorization)return true;
    try{return authorization.require({principal:principalFromActor(actor),capability});}
    catch(error){throw domainError(error.statusCode||403,error.message||'Permissao insuficiente.');}
  }

  function removeCategory(id,actor=null){
    requireCapability(actor,'products.manage');
    const categoryId=String(id||'').trim();const row=db.prepare('SELECT * FROM categories WHERE id=?').get(categoryId);
    if(!row)throw domainError(404,'Categoria nao encontrada.');if(!Boolean(row.active))return publicCategory(row);
    const timestamp=now();db.prepare('UPDATE categories SET active=0,updated_at=? WHERE id=?').run(timestamp,categoryId);
    writeAudit(db,{action:'category.remove',entity:'category',entityId:categoryId,actor,context:{name:row.name,mode:'soft-delete'}},now);
    return publicCategory(db.prepare('SELECT * FROM categories WHERE id=?').get(categoryId));
  }

  function removeCustomer(id,actor=null){
    requireCapability(actor,'customers.manage');
    const customerId=String(id||'').trim();const customer=catalog.getCustomer(customerId);
    if(!customer)throw domainError(404,'Cliente nao encontrado.');if(!customer.active)return customer;
    const timestamp=now();db.prepare('UPDATE customers SET active=0,updated_at=? WHERE id=?').run(timestamp,customerId);
    writeAudit(db,{action:'customer.remove',entity:'customer',entityId:customerId,actor,context:{name:customer.name,mode:'soft-delete'}},now);
    return catalog.getCustomer(customerId);
  }

  function removeSupplier(id,actor=null){
    requireCapability(actor,'suppliers.manage');
    const supplierId=String(id||'').trim();const row=db.prepare('SELECT * FROM suppliers WHERE id=?').get(supplierId);
    if(!row)throw domainError(404,'Fornecedor nao encontrado.');if(!Boolean(row.active))return publicSupplier(row);
    const timestamp=now();db.prepare('UPDATE suppliers SET active=0,updated_at=? WHERE id=?').run(timestamp,supplierId);
    writeAudit(db,{action:'supplier.remove',entity:'supplier',entityId:supplierId,actor,context:{name:row.name,mode:'soft-delete'}},now);
    return publicSupplier(db.prepare('SELECT * FROM suppliers WHERE id=?').get(supplierId));
  }

  function ownerUserId(){return String(account?.activation?.()?.ownerUserId||'').trim()||null;}
  function administratorProfile(){return profiles?.getProfileBySystemKey?.('admin')||null;}
  function activeAdminCount(){const admin=administratorProfile();if(!admin)return 0;return Number(db.prepare('SELECT COUNT(*) AS count FROM users WHERE active=1 AND profile_id=?').get(admin.id)?.count||0);}

  function ensureAdminMutationSafe(existing,targetProfile,nextActive,actor){
    if(!existing)return;
    const adminProfile=administratorProfile();
    const currentProfileId=existing.profileId||db.prepare('SELECT profile_id FROM users WHERE id=?').get(existing.id)?.profile_id||null;
    const nextProfileId=targetProfile?.id||currentProfileId;
    const ownerId=ownerUserId();
    if(ownerId&&existing.id===ownerId&&(nextProfileId!==adminProfile?.id||!nextActive))throw domainError(409,'O administrador proprietario da instalacao nao pode ser rebaixado ou desativado.');
    if(existing.id===String(actor?.userId||actor?.id||'')&&!nextActive)throw domainError(409,'Nao e permitido desativar o proprio usuario.');
    const removesLastAdmin=Boolean(existing.active)&&currentProfileId===adminProfile?.id&&(nextProfileId!==adminProfile.id||!nextActive)&&activeAdminCount()<=1;
    if(removesLastAdmin)throw domainError(409,'Nao e permitido remover ou desativar o ultimo administrador ativo.');
  }

  function profileForInput(input,existing){
    if(!profiles)throw domainError(500,'Servico canonico de perfis indisponivel.');
    if(Object.prototype.hasOwnProperty.call(input,'role'))throw domainError(400,'Campo role legado nao e suportado; informe profileId.');
    if(input.profileId)return profiles.getProfile(input.profileId);
    if(existing?.profileId)return profiles.getProfile(existing.profileId);
    return profiles.getProfileBySystemKey('operator');
  }

  function assertCanGrantProfile(actor,profile,explicit=false){
    if(!authorization||!profile)return;
    const principal=principalFromActor(actor);
    if(principal?.kind==='system')return;
    if(explicit)requireCapability(actor,'profiles.assign');
    for(const permission of profile.permissions||[]){
      if(!authorization.can({principal,capability:permission}))throw domainError(403,'Nao e permitido atribuir um perfil com permissoes superiores as do usuario atual.');
    }
  }

  function saveManagedUser(input={},actor=null){
    const id=String(input.id||'').trim();const existing=id?catalog.getUser(id):null;
    requireCapability(actor,existing?'users.edit':'users.create');
    if(existing&&String(input.password||'').trim())requireCapability(actor,'users.reset_password');
    const requestedActive=asBoolean(input.active,existing?.active??true);
    if((existing&&requestedActive!==existing.active)||(!existing&&!requestedActive))requireCapability(actor,'users.disable');

    const targetProfile=profileForInput(input,existing);
    if(profiles&&(!targetProfile||!targetProfile.active))throw domainError(409,'Perfil de acesso invalido ou inativo.');
    const changesProfile=!existing||String(targetProfile?.id||'')!==String(existing.profileId||'');
    if(changesProfile)assertCanGrantProfile(actor,targetProfile,Boolean(input.profileId));

    ensureAdminMutationSafe(existing,targetProfile,requestedActive,actor);
    return catalog.upsertUser({...input,profileId:targetProfile.id,active:requestedActive},actor);
  }

  function removeUser(id,actor=null){
    requireCapability(actor,'users.disable');
    const userId=String(id||'').trim();const user=catalog.getUser(userId);
    if(!user)throw domainError(404,'Usuario nao encontrado.');if(!user.active)return user;
    ensureAdminMutationSafe(user,profiles?.getProfile?.(user.profileId),false,actor);
    const timestamp=now();db.prepare('UPDATE users SET active=0,updated_at=? WHERE id=?').run(timestamp,userId);
    writeAudit(db,{action:'user.remove',entity:'user',entityId:userId,actor,context:{username:user.username,name:user.name,profileId:user.profileId||null,mode:'soft-delete'}},now);
    return catalog.getUser(userId);
  }

  return{removeCategory,removeCustomer,removeSupplier,removeUser,saveManagedUser};
}

module.exports={createCatalogManagementService,asBoolean};
