'use strict';

((root,factory)=>{
  const model=factory();
  if(typeof module==='object'&&module.exports)module.exports=model;
  if(root)root.PdvWebNavigation=model;
})(typeof window==='undefined'?null:window,()=>{
  const routes=new Set(['home','checkout','catalog','post-sale','financial-management','access',
    'products','inventory','sales','returns','cash','finance','finance-banks','finance-recurrences',
    'management','reports','settings','customers','suppliers','sellers','FOOD','WHOLESALE',
    'credit','commissions','saas-admin']);
  const top=['home','checkout','FOOD','WHOLESALE','cash','post-sale','catalog','financial-management','access'];
  const parents={products:'catalog',inventory:'catalog',customers:'catalog',suppliers:'catalog',sellers:'catalog',
    sales:'post-sale',returns:'post-sale',finance:'financial-management','finance-banks':'financial-management',
    'finance-recurrences':'financial-management',management:'financial-management',reports:'financial-management',
    credit:'financial-management',commissions:'financial-management','saas-admin':'settings'};
  function canAccess(user,route,policy,{moduleState={}}={}){
    if(!user||!routes.has(route))return false;
    if(route==='settings'||route==='access')return true;
    if(route==='saas-admin')return user.profileKey==='OWNER';
    if(['FOOD','WHOLESALE'].includes(route)&&moduleState[route]===false)return false;
    const permission={suppliers:'suppliers.view',credit:'customers.view',commissions:'finance.view',
      FOOD:'restaurant.access',WHOLESALE:'wholesale.access'}[route];
    if(permission)return Boolean(policy?.hasCapability(user,permission));
    return Boolean(policy?.canAccessRoute(user,route));
  }
  return Object.freeze({canAccess,sidebar:(user,policy,options)=>top.filter(route=>canAccess(user,route,policy,options)),
    parent:route=>parents[route]||route});
});
