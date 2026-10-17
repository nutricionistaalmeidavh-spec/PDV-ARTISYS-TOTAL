'use strict';

const PUBLIC_RESOURCE_PERMISSIONS=Object.freeze({
  table:Object.freeze(['public.menu.view','public.order.create'])
});

function permissionsForPublicResource(principal){
  if(principal?.kind!=='public-resource')return[];
  return PUBLIC_RESOURCE_PERMISSIONS[String(principal.resourceType||'').toLowerCase()]||[];
}

module.exports={PUBLIC_RESOURCE_PERMISSIONS,permissionsForPublicResource};
