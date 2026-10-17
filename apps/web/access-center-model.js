'use strict';

((root,factory)=>{
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.PdvAccessCenterModel=api;
})(typeof window!=='undefined'?window:null,()=>{

  function text(value){return String(value??'').trim();}
  function normalized(value){return text(value).toLocaleLowerCase('pt-BR');}

  function groupDefinition(groups,id){
    const entry=groups?.[id];
    return entry&&typeof entry==='object'
      ? {id:text(entry.id||id),label:text(entry.label||id)}
      : {id:text(id),label:text(id)};
  }

  function permissionGroups({permissions=[],groups={},selectedIds=[],query=''}={}){
    const selected=new Set((selectedIds||[]).map(value=>text(value)));
    const needle=normalized(query);
    const allBuckets=new Map();
    const visibleBuckets=new Map();

    for(const permission of permissions||[]){
      if(!permission||permission.group==='public')continue;
      const item={...permission,selected:selected.has(text(permission.id))};
      if(!allBuckets.has(permission.group))allBuckets.set(permission.group,[]);
      allBuckets.get(permission.group).push(item);

      const haystack=normalized([permission.id,permission.label,permission.description,groupDefinition(groups,permission.group).label].join(' '));
      if(needle&&!haystack.includes(needle))continue;
      if(!visibleBuckets.has(permission.group))visibleBuckets.set(permission.group,[]);
      visibleBuckets.get(permission.group).push(item);
    }

    const orderedGroupIds=Object.keys(groups||{}).filter(id=>id!=='public');
    for(const id of allBuckets.keys())if(!orderedGroupIds.includes(id))orderedGroupIds.push(id);

    return orderedGroupIds
      .filter(id=>visibleBuckets.has(id))
      .map(id=>{
        const definition=groupDefinition(groups,id);
        const allItems=allBuckets.get(id)||[];
        return {
          ...definition,
          permissions:visibleBuckets.get(id)||[],
          total:allItems.length,
          selected:allItems.filter(item=>item.selected).length
        };
      });
  }

  function permissionGroupBulkAction({selected=0,total=0,query=''}={}){
    if(normalized(query)||Number(total)<=0)return null;
    return Number(selected)===Number(total)
      ? {action:'clear',label:'Limpar grupo'}
      : {action:'select',label:'Selecionar grupo'};
  }

  function profileUsageCount(users=[],profileId){
    return (users||[]).filter(user=>String(user?.profileId||'')===String(profileId||'')).length;
  }

  function profileDeleteState(profile,users=[]){
    const protectedProfile=Boolean(profile?.protected);
    const usageCount=profileUsageCount(users,profile?.id);
    const reason=protectedProfile?'protected':usageCount>0?'in-use':null;
    return {
      protected:protectedProfile,
      usageCount,
      blocked:Boolean(reason),
      reason
    };
  }

  function filterProfiles(profiles=[],{query='',users=[]}={}){
    const needle=normalized(query);
    return (profiles||[])
      .filter(profile=>!needle||normalized([profile?.name,profile?.slug,profile?.systemKey].join(' ')).includes(needle))
      .map(profile=>({
        ...profile,
        usageCount:profileUsageCount(users,profile.id),
        systemProfile:Boolean(profile.protected||profile.systemKey)
      }));
  }

  function selectedPermissionSummary({permissions=[],groups={},selectedIds=[]}={}){
    const selected=new Set((selectedIds||[]).map(value=>text(value)));
    return permissionGroups({
      permissions:(permissions||[]).filter(permission=>selected.has(text(permission.id))),
      groups,
      selectedIds:[...selected]
    }).map(group=>({
      id:group.id,
      label:group.label,
      count:group.permissions.length,
      permissions:group.permissions
    }));
  }

  return Object.freeze({
    permissionGroups,
    permissionGroupBulkAction,
    profileUsageCount,
    profileDeleteState,
    filterProfiles,
    selectedPermissionSummary
  });
});
