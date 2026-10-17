'use strict';

((root,factory)=>{
  const model=factory();
  if(typeof module==='object'&&module.exports)module.exports=model;
  if(root)root.PdvAccessPolicy=model;
})(typeof window!=='undefined'?window:null,()=>{
  const ACCESS_CENTER_TABS=Object.freeze([
    Object.freeze({id:'people',capability:'users.view'}),
    Object.freeze({id:'profiles',capability:'profiles.view'}),
    Object.freeze({id:'devices',capability:'devices.view'}),
    Object.freeze({id:'security',capability:'security.view'})
  ]);

  const ROUTE_CAPABILITIES=Object.freeze({
    home:Object.freeze([]),
    checkout:Object.freeze(['sales.create']),
    cash:Object.freeze(['cash.view']),
    sales:Object.freeze(['sales.view']),
    returns:Object.freeze(['returns.view']),
    customers:Object.freeze(['customers.view']),
    products:Object.freeze(['products.view']),
    inventory:Object.freeze(['inventory.view']),
    finance:Object.freeze(['finance.view']),
    'finance-banks':Object.freeze(['finance.view']),
    'finance-recurrences':Object.freeze(['finance.view']),
    'finance-alerts':Object.freeze(['finance.view']),
    reports:Object.freeze(['reports.view']),
    management:Object.freeze(['management.view']),
    sellers:Object.freeze(['sellers.view']),
    settings:Object.freeze(['settings.view']),
    access:Object.freeze(ACCESS_CENTER_TABS.map(tab=>tab.capability)),
    catalog:Object.freeze(['customers.view','products.view','inventory.view','sellers.view']),
    'post-sale':Object.freeze(['sales.view','returns.view']),
    'financial-management':Object.freeze(['finance.view','reports.view','management.view']),
    FOOD:Object.freeze(['restaurant.access']),
    WHOLESALE:Object.freeze(['wholesale.access'])
  });

  const MODULE_ROUTES=Object.freeze(['FOOD','WHOLESALE']);

  const TOP_LEVEL_ROUTES=Object.freeze([
    'home','checkout','FOOD','WHOLESALE','cash','post-sale','catalog','financial-management','access','settings'
  ]);

  function permissionsOf(user){
    const source=Array.isArray(user?.permissions)?user.permissions:
      Array.isArray(user?.profile?.permissions)?user.profile.permissions:[];
    return new Set(source.map(value=>String(value||'').trim().toLowerCase()).filter(Boolean));
  }

  function hasCapability(user,capability){
    return permissionsOf(user).has(String(capability||'').trim().toLowerCase());
  }

  function accessCenterModel(user){
    const tabs=ACCESS_CENTER_TABS.filter(tab=>hasCapability(user,tab.capability)).map(tab=>tab.id);
    const profileCatalogVisible=hasCapability(user,'profiles.view');
    return Object.freeze({
      tabs:Object.freeze(tabs),
      load:Object.freeze({
        users:hasCapability(user,'users.view'),
        profiles:profileCatalogVisible,
        permissions:profileCatalogVisible,
        devices:hasCapability(user,'devices.view'),
        security:hasCapability(user,'security.view')
      }),
      actions:Object.freeze({
        createPerson:hasCapability(user,'users.create'),
        editPerson:hasCapability(user,'users.edit'),
        disablePerson:hasCapability(user,'users.disable'),
        resetPassword:hasCapability(user,'users.reset_password'),
        assignProfile:profileCatalogVisible&&hasCapability(user,'profiles.assign'),
        createProfile:profileCatalogVisible&&hasCapability(user,'profiles.create'),
        editProfile:profileCatalogVisible&&hasCapability(user,'profiles.edit'),
        deleteProfile:profileCatalogVisible&&hasCapability(user,'profiles.delete'),
        pairDevice:hasCapability(user,'devices.view')&&hasCapability(user,'devices.pair'),
        blockDevice:hasCapability(user,'devices.view')&&hasCapability(user,'devices.block'),
        rotateDeviceCredential:hasCapability(user,'devices.view')&&hasCapability(user,'devices.rotate_credential'),
        revokeSession:hasCapability(user,'security.view')&&hasCapability(user,'sessions.revoke')
      })
    });
  }

  function commonDataLoadPlan(user){
    const products=hasCapability(user,'products.view');
    return Object.freeze({
      categories:products,
      products,
      productPhotos:products,
      customers:hasCapability(user,'customers.view'),
      sellers:hasCapability(user,'sellers.view'),
      users:hasCapability(user,'users.view'),
      cash:hasCapability(user,'cash.view')
    });
  }

  function moduleEnabled(route,moduleState){
    const id=String(route||'').trim();
    if(!MODULE_ROUTES.includes(id))return true;
    if(typeof moduleState?.isEnabled==='function')return moduleState.isEnabled(id)===true;
    if(moduleState instanceof Map)return moduleState.get(id)===true;
    return Boolean(moduleState&&moduleState[id]===true);
  }

  function canAccessRoute(user,route,{moduleState=null}={}){
    if(!user)return false;
    const id=String(route||'').trim();
    const required=ROUTE_CAPABILITIES[id];
    if(!required||!moduleEnabled(id,moduleState))return false;
    if(required.length===0)return true;
    const permissions=permissionsOf(user);
    return required.some(capability=>permissions.has(capability));
  }

  function routesForUser(user,options={}){return TOP_LEVEL_ROUTES.filter(route=>canAccessRoute(user,route,options));}

  return Object.freeze({ACCESS_CENTER_TABS,ROUTE_CAPABILITIES,MODULE_ROUTES,TOP_LEVEL_ROUTES,permissionsOf,hasCapability,accessCenterModel,commonDataLoadPlan,moduleEnabled,canAccessRoute,routesForUser});
});
