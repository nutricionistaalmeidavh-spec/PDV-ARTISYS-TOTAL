'use strict';

const {MODULES,getModuleDefinition}=require('./module-registry');
const {principalFromActor}=require('../auth/principal-resolver');

class ModuleDisabledError extends Error{constructor(id){super(`Modulo ${id} desativado.`);this.code='MODULE_DISABLED';this.moduleId=id;}}

function createModuleService({db,settings,authorization,now=()=>new Date().toISOString()}={}){
  if(!db||!settings||!authorization)throw new TypeError('db, settings and authorization are required.');
  const key=id=>`modules.${id}.enabled`;
  const legacyFoodIds=['RESTAURANT','PIZZERIA','DELIVERY','FAST_FOOD','MARKET_BAKERY'];

  function foodDefault(definition){
    const explicit=settings.get(key('FOOD'),{defaultValue:null});
    if(typeof explicit==='boolean')return explicit;
    const legacy=Object.fromEntries(legacyFoodIds.map(id=>[id,settings.get(key(id),{defaultValue:null})]));
    if(Object.values(legacy).some(value=>value===true))return true;
    if(legacy.RESTAURANT===false)return false;
    return Boolean(definition.defaultEnabled);
  }

  function normalize(id){const value=String(id||'').trim().toUpperCase();if(!getModuleDefinition(value))throw new Error(`Modulo desconhecido: ${value||id}.`);return value;}
  function isEnabled(id){const moduleId=normalize(id);const definition=getModuleDefinition(moduleId);if(moduleId==='FOOD')return foodDefault(definition);return Boolean(settings.get(key(moduleId),{defaultValue:Boolean(definition.defaultEnabled)}));}
  function list(){return MODULES.map(def=>({...def,enabled:isEnabled(def.id)}));}

  function requireCapability(actor,capability){
    authorization.require({principal:principalFromActor(actor),capability});
    return true;
  }

  function setEnabled(id,enabled,actor={}){
    const moduleId=normalize(id);const definition=getModuleDefinition(moduleId);
    requireCapability(actor,definition.manageCapability);
    const target=Boolean(enabled);
    if(target){
      const missing=(definition.dependsOn||[]).filter(dependency=>!isEnabled(dependency));
      if(missing.length)throw new Error(`Modulo ${moduleId} depende de ${missing.join(', ')}.`);
    }else{
      const dependents=MODULES.filter(candidate=>candidate.id!==moduleId&&(candidate.dependsOn||[]).includes(moduleId)&&isEnabled(candidate.id));
      if(dependents.length)throw new Error(`Nao e possivel desativar ${moduleId}; modulo(s) dependente(s): ${dependents.map(item=>item.id).join(', ')}.`);
    }
    settings.set(key(moduleId),target,{scope:'global',actor});
    return{...definition,enabled:target};
  }

  function requireEnabled(id){const moduleId=normalize(id);if(!isEnabled(moduleId))throw new ModuleDisabledError(moduleId);return true;}
  function requireAccess(id,actor={}){
    const moduleId=normalize(id);const definition=getModuleDefinition(moduleId);requireEnabled(moduleId);
    return requireCapability(actor,definition.accessCapability);
  }
  function requireManage(id,actor={}){
    const moduleId=normalize(id);const definition=getModuleDefinition(moduleId);requireEnabled(moduleId);
    return requireCapability(actor,definition.manageCapability);
  }
  function enabledIds(){return list().filter(m=>m.enabled).map(m=>m.id);}
  return{list,isEnabled,setEnabled,requireEnabled,requireAccess,requireManage,enabledIds};
}

module.exports={createModuleService,ModuleDisabledError};
