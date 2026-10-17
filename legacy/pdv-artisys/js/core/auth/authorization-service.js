'use strict';

const { getPermissionDefinition, normalizePermissionId }=require('./permission-registry');

const PRINCIPAL_KINDS=Object.freeze(['human','device','system','public-resource']);

class AuthorizationError extends Error{
  constructor({capability,principal=null,message='Permissao insuficiente.'}={}){
    super(message);
    this.name='AuthorizationError';
    this.statusCode=403;
    this.code='AUTHORIZATION_DENIED';
    this.capability=normalizePermissionId(capability)||null;
    this.principalKind=principal?.kind||null;
    this.principalId=principal?.id||null;
  }
}

function cleanId(value){
  const text=String(value||'').trim();
  return text||null;
}

function cleanSurface(value){
  const text=String(value||'').trim().toLowerCase().replace(/_/g,'-');
  return text||null;
}

function normalizeScope(value){
  if(!value||typeof value!=='object')return null;
  const type=String(value.type||'').trim().toLowerCase();
  if(!type)return null;
  const id=cleanId(value.id);
  if(type!=='establishment'&&!id)return null;
  return {type,id:id||null};
}

function normalizePrincipal(input){
  if(!input||typeof input!=='object')return null;
  const kind=String(input.kind||'').trim().toLowerCase();
  if(!PRINCIPAL_KINDS.includes(kind))return null;

  if(kind==='system')return {kind:'system',id:'system'};

  const id=cleanId(input.id);
  if(!id)return null;

  if(kind==='human')return {kind,id};

  if(kind==='device'){
    const surface=cleanSurface(input.surface);
    if(!surface)return null;
    const principal={kind,id,surface,userId:cleanId(input.userId)};
    if(principal.userId===null)principal.userId=null;
    const scope=normalizeScope(input.scope);if(scope)principal.scope=scope;
    return principal;
  }

  const resourceType=cleanId(input.resourceType);
  const resourceId=cleanId(input.resourceId);
  if(!resourceType||!resourceId)return null;
  return {kind,id,resourceType:String(resourceType).toLowerCase(),resourceId};
}

function permissionSet(value){
  const source=value instanceof Set?[...value]:Array.isArray(value)?value:[];
  return new Set(source.map(normalizePermissionId).filter(id=>getPermissionDefinition(id)));
}

function createAuthorizationService({
  resolvePermissions=()=>[],
  surfacePolicy=()=>true,
  resourcePolicy=()=>true
}={}){
  if(typeof resolvePermissions!=='function')throw new TypeError('resolvePermissions must be a function.');
  if(typeof surfacePolicy!=='function')throw new TypeError('surfacePolicy must be a function.');
  if(typeof resourcePolicy!=='function')throw new TypeError('resourcePolicy must be a function.');

  function can({principal,capability,surface=null,resource=null}={}){
    const normalizedPrincipal=normalizePrincipal(principal);
    const normalizedCapability=normalizePermissionId(capability);
    if(!normalizedPrincipal||!getPermissionDefinition(normalizedCapability))return false;

    let granted=false;
    try{
      granted=normalizedPrincipal.kind==='system'
        ? true
        : permissionSet(resolvePermissions(normalizedPrincipal,{capability:normalizedCapability,surface,resource})).has(normalizedCapability);
      if(!granted)return false;

      const context={principal:normalizedPrincipal,capability:normalizedCapability,surface:cleanSurface(surface),resource:resource||null};
      if(!surfacePolicy(context))return false;
      if(!resourcePolicy(context))return false;
      return true;
    }catch{
      return false;
    }
  }

  function require(input={}){
    if(can(input))return true;
    const principal=normalizePrincipal(input.principal);
    throw new AuthorizationError({capability:input.capability,principal});
  }

  return Object.freeze({can,require});
}

module.exports={
  PRINCIPAL_KINDS,
  AuthorizationError,
  createAuthorizationService,
  normalizePrincipal
};
