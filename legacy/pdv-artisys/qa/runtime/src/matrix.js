function stringList(values,fallback,label){
  const source=values==null?fallback:values;
  if(!Array.isArray(source)||source.length===0)throw new TypeError(`${label} must be a non-empty array`);
  const out=[];
  for(const value of source){
    const item=String(value||'').trim();
    if(!item)throw new TypeError(`${label} entries must be non-empty strings`);
    if(!out.includes(item))out.push(item);
  }
  return out;
}

export function buildQaMatrix({
  profiles=['quick'],
  viewports=['desktop','mobile'],
  environments=['local'],
}={}){
  const ps=stringList(profiles,['quick'],'profiles');
  const vs=stringList(viewports,['desktop','mobile'],'viewports');
  const es=stringList(environments,['local'],'environments');
  const cases=[];
  for(const profile of ps){
    for(const environment of es){
      for(const viewport of vs){
        cases.push({
          id:`${profile}-${environment}-${viewport}`,
          profile,
          environment,
          viewport,
        });
      }
    }
  }
  return cases;
}

export async function runQaMatrix({cases,runner,failFast=false,onCase=null}={}){
  if(!Array.isArray(cases)||cases.length===0)throw new TypeError('cases must be a non-empty array');
  if(typeof runner!=='function')throw new TypeError('runner must be a function');
  const results=[];
  for(let index=0;index<cases.length;index++){
    const item=cases[index];
    await onCase?.({type:'start',index,total:cases.length,case:item});
    const started=Date.now();
    try{
      const value=await runner(item);
      const result={...item,status:'passed',durationMs:Date.now()-started,value:value??null};
      results.push(result);
      await onCase?.({type:'end',index,total:cases.length,case:item,result});
    }catch(error){
      const result={...item,status:'failed',durationMs:Date.now()-started,error:error?.message||String(error)};
      results.push(result);
      await onCase?.({type:'end',index,total:cases.length,case:item,result});
      if(failFast)break;
    }
  }
  const failed=results.filter(item=>item.status==='failed');
  return {
    status:failed.length?'failed':'passed',
    total:results.length,
    passed:results.length-failed.length,
    failed:failed.length,
    results,
  };
}
