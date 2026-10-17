'use strict';

const {randomUUID}=require('node:crypto');
const {writeAudit}=require('../audit-log');
const {getPermissionDefinition}=require('./permission-registry');
const {DEFAULT_PROFILE_IDS}=require('./default-profiles');
const {principalFromActor}=require('./principal-resolver');

function slugify(value){
  return String(value||'').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}

function createProfilePermissionResolver({db}={}){
  if(!db)throw new TypeError('Database is required.');
  return function resolvePermissions(principal){
    if(principal?.kind!=='human')return[];
    const rows=db.prepare(`SELECT pp.permission_id
      FROM users u
      JOIN profiles p ON p.id=u.profile_id AND p.active=1
      JOIN profile_permissions pp ON pp.profile_id=p.id
      WHERE u.id=? AND u.active=1
      ORDER BY pp.permission_id`).all(String(principal.id));
    return rows.map(row=>row.permission_id);
  };
}

function createProfileService({
  db,
  authorization,
  account=null,
  now=()=>new Date().toISOString(),
  idFactory=prefix=>`${prefix}-${randomUUID()}`
}={}){
  if(!db)throw new TypeError('Database is required.');
  if(!authorization)throw new TypeError('authorization is required.');

  function permissionsForProfile(profileId){
    return db.prepare('SELECT permission_id FROM profile_permissions WHERE profile_id=? ORDER BY permission_id')
      .all(String(profileId)).map(row=>row.permission_id);
  }

  function mapProfile(row){
    if(!row)return null;
    return {
      id:row.id,
      name:row.name,
      slug:row.slug,
      systemKey:row.system_key||null,
      protected:Boolean(row.protected),
      active:Boolean(row.active),
      permissions:permissionsForProfile(row.id),
      createdAt:row.created_at,
      updatedAt:row.updated_at
    };
  }

  function getProfile(id){
    return mapProfile(db.prepare('SELECT * FROM profiles WHERE id=?').get(String(id||'')));
  }

  function getUserAccess(userId){
    const row=db.prepare('SELECT profile_id FROM users WHERE id=? AND active=1').get(String(userId||''));
    if(!row)return{profile:null,permissions:[]};
    const profile=getProfile(row.profile_id);
    return{profile,permissions:profile?.permissions||[]};
  }

  function getProfileBySystemKey(systemKey){
    const key=String(systemKey||'').trim().toLowerCase();
    return mapProfile(db.prepare('SELECT * FROM profiles WHERE lower(system_key)=?').get(key));
  }

  function listProfiles({includeInactive=false}={}){
    const rows=includeInactive
      ? db.prepare('SELECT * FROM profiles ORDER BY protected DESC,name,id').all()
      : db.prepare('SELECT * FROM profiles WHERE active=1 ORDER BY protected DESC,name,id').all();
    return rows.map(mapProfile);
  }

  function principal(actor){return principalFromActor(actor);}

  function requireCapability(actor,capability){
    const p=principal(actor);
    authorization.require({principal:p,capability});
    return p;
  }

  function normalizePermissions(values){
    if(!Array.isArray(values))throw new Error('Permissoes do perfil devem ser uma lista.');
    const result=[];
    for(const value of values){
      const permission=getPermissionDefinition(value);
      if(!permission)throw new Error(`Permissao desconhecida: ${value}.`);
      if(permission.group==='public')throw new Error('Permissoes publicas nao podem ser atribuidas a perfis humanos.');
      if(!result.includes(permission.id))result.push(permission.id);
    }
    return result.sort();
  }

  function assertCanGrant(actorPrincipal,permissions){
    if(actorPrincipal?.kind==='system')return;
    for(const permission of permissions){
      if(!authorization.can({principal:actorPrincipal,capability:permission})){
        const error=new Error(`Nao e permitido conceder a permissao ${permission}.`);
        error.statusCode=403;
        error.code='AUTHORIZATION_ESCALATION_DENIED';
        throw error;
      }
    }
  }

  function replacePermissions(profileId,permissions,timestamp){
    db.prepare('DELETE FROM profile_permissions WHERE profile_id=?').run(profileId);
    const insert=db.prepare('INSERT INTO profile_permissions(profile_id,permission_id,created_at) VALUES(?,?,?)');
    for(const permission of permissions)insert.run(profileId,permission,timestamp);
  }

  function createProfile(input={},actor={}){
    const actorPrincipal=requireCapability(actor,'profiles.create');
    const name=String(input.name||'').trim();
    if(!name)throw new Error('Nome do perfil obrigatorio.');
    const permissions=normalizePermissions(input.permissions||[]);
    assertCanGrant(actorPrincipal,permissions);
    const id=String(input.id||idFactory('profile')).trim();
    const slug=slugify(input.slug||name);
    if(!slug)throw new Error('Identificador do perfil invalido.');
    const timestamp=now();
    db.prepare(`INSERT INTO profiles(id,name,slug,system_key,protected,active,created_at,updated_at)
      VALUES(?,?,?,NULL,0,1,?,?)`).run(id,name,slug,timestamp,timestamp);
    replacePermissions(id,permissions,timestamp);
    writeAudit(db,{action:'profile.create',entity:'profile',entityId:id,actor,context:{name,permissions}},now);
    return getProfile(id);
  }

  function updateProfile(id,input={},actor={}){
    const actorPrincipal=requireCapability(actor,'profiles.edit');
    const existing=getProfile(id);
    if(!existing)throw new Error('Perfil nao encontrado.');
    if(existing.protected)throw new Error('Perfil protegido nao pode ser alterado.');
    const name=input.name===undefined?existing.name:String(input.name||'').trim();
    if(!name)throw new Error('Nome do perfil obrigatorio.');
    const active=input.active===undefined?existing.active:Boolean(input.active);
    const permissions=input.permissions===undefined?existing.permissions:normalizePermissions(input.permissions);
    assertCanGrant(actorPrincipal,permissions);
    const timestamp=now();
    db.prepare('UPDATE profiles SET name=?,active=?,updated_at=? WHERE id=?').run(name,active?1:0,timestamp,existing.id);
    if(input.permissions!==undefined)replacePermissions(existing.id,permissions,timestamp);
    writeAudit(db,{action:'profile.update',entity:'profile',entityId:existing.id,actor,context:{name,active,permissions}},now);
    return getProfile(existing.id);
  }

  function deleteProfile(id,actor={}){
    requireCapability(actor,'profiles.delete');
    const existing=getProfile(id);
    if(!existing)throw new Error('Perfil nao encontrado.');
    if(existing.protected)throw new Error('Perfil protegido nao pode ser excluido.');
    const users=Number(db.prepare('SELECT COUNT(*) AS count FROM users WHERE profile_id=?').get(existing.id)?.count||0);
    if(users>0)throw new Error('Perfil em uso nao pode ser excluido.');
    db.prepare('DELETE FROM profile_permissions WHERE profile_id=?').run(existing.id);
    db.prepare('DELETE FROM profiles WHERE id=?').run(existing.id);
    writeAudit(db,{action:'profile.delete',entity:'profile',entityId:existing.id,actor,context:{name:existing.name}},now);
    return existing;
  }

  function assignProfile(userId,profileId,actor={}){
    const actorPrincipal=requireCapability(actor,'profiles.assign');
    const user=db.prepare('SELECT * FROM users WHERE id=?').get(String(userId||''));
    if(!user)throw new Error('Usuario nao encontrado.');
    const profile=getProfile(profileId);
    if(!profile||!profile.active)throw new Error('Perfil nao encontrado ou inativo.');
    assertCanGrant(actorPrincipal,profile.permissions);

    const ownerId=String(account?.activation?.()?.ownerUserId||'').trim();
    if(ownerId&&user.id===ownerId&&profile.id!==DEFAULT_PROFILE_IDS.ADMINISTRATOR){
      throw new Error('O administrador proprietario deve permanecer no perfil Administrador.');
    }

    if(user.profile_id===DEFAULT_PROFILE_IDS.ADMINISTRATOR&&profile.id!==DEFAULT_PROFILE_IDS.ADMINISTRATOR){
      const activeAdmins=Number(db.prepare('SELECT COUNT(*) AS count FROM users WHERE active=1 AND profile_id=?').get(DEFAULT_PROFILE_IDS.ADMINISTRATOR)?.count||0);
      if(activeAdmins<=1)throw new Error('Nao e permitido remover o ultimo administrador ativo.');
    }

    const timestamp=now();
    db.prepare('UPDATE users SET profile_id=?,updated_at=? WHERE id=?')
      .run(profile.id,timestamp,user.id);
    writeAudit(db,{action:'profile.assign',entity:'user',entityId:user.id,actor,context:{profileId:profile.id,profileName:profile.name}},now);
    const row=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    const result={
      id:row.id,username:row.username,name:row.name,profileId:row.profile_id,
      active:Boolean(row.active),createdAt:row.created_at,updatedAt:row.updated_at
    };
    if(row.email)result.email=row.email;
    return result;
  }

  return {
    getProfile,
    getProfileBySystemKey,
    listProfiles,
    createProfile,
    updateProfile,
    deleteProfile,
    assignProfile,
    permissionsForProfile,
    getUserAccess
  };
}

module.exports={createProfileService,createProfilePermissionResolver,slugify};
