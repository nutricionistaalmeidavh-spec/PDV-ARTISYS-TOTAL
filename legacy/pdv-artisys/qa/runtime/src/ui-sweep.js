function normalizeInternal(baseURL,currentURL,href,preserveHashRoutes=false){
  try{
    if(!href)return null;
    const url=new URL(href,currentURL||baseURL);
    const base=new URL(baseURL);
    if(!['http:','https:'].includes(url.protocol)||url.origin!==base.origin)return null;
    if(!preserveHashRoutes)url.hash='';
    return url.toString();
  }catch{return null}
}

function finite(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function normalizeRect(input={}){
  const left=finite(input.left),top=finite(input.top);
  const width=Math.max(0,finite(input.width,finite(input.right)-left));
  const height=Math.max(0,finite(input.height,finite(input.bottom)-top));
  return{left,top,right:finite(input.right,left+width),bottom:finite(input.bottom,top+height),width,height};
}
function isAncestorPair(a,b){
  const aAncestors=Array.isArray(a?.ancestorSelectors)?a.ancestorSelectors:[];
  const bAncestors=Array.isArray(b?.ancestorSelectors)?b.ancestorSelectors:[];
  return aAncestors.includes(b?.selector)||bAncestors.includes(a?.selector);
}
function overlapDetails(a,b){
  const left=Math.max(a.left,b.left),top=Math.max(a.top,b.top);
  const right=Math.min(a.right,b.right),bottom=Math.min(a.bottom,b.bottom);
  const width=Math.max(0,right-left),height=Math.max(0,bottom-top);
  return{left,top,right,bottom,width,height,area:width*height};
}

export function analyzeStructuralGeometry(snapshot={}, {overflowTolerancePx=2,overlapTolerancePx=4,minOverlapAreaPx=64}={}){
  const viewport={width:Math.max(0,finite(snapshot?.viewport?.width)),height:Math.max(0,finite(snapshot?.viewport?.height))};
  const documentWidth=Math.max(0,finite(snapshot?.document?.scrollWidth));
  const clientWidth=Math.max(0,finite(snapshot?.document?.clientWidth,viewport.width));
  const findings=[];

  if(documentWidth>clientWidth+overflowTolerancePx){
    findings.push({code:'horizontal-overflow',severity:'high',details:{scrollWidth:documentWidth,clientWidth,overflowPx:documentWidth-clientWidth}});
  }

  const interactives=(Array.isArray(snapshot?.interactives)?snapshot.interactives:[]).map(item=>({...item,rect:normalizeRect(item?.rect)}));
  const visible=interactives.filter(item=>item.visible!==false&&item.rect.width>0&&item.rect.height>0);
  for(const item of visible){
    const selector=String(item.selector||'interactive');
    const outside=item.rect.right<=0||item.rect.bottom<=0||item.rect.left>=viewport.width||item.rect.top>=viewport.height;
    if(outside){
      findings.push({code:'interactive-offscreen',severity:'high',selector,selectors:[selector],details:{rect:item.rect,viewport}});
    }
    if(item.labelled===false){
      findings.push({code:'control-unlabelled',severity:'medium',selector,selectors:[selector]});
    }
  }

  for(let i=0;i<visible.length;i++){
    for(let j=i+1;j<visible.length;j++){
      const a=visible[i],b=visible[j];
      if(!a.selector||!b.selector||a.selector===b.selector)continue;
      if(isAncestorPair(a,b))continue;
      if(a.dialogId&&a.dialogId===b.dialogId)continue;
      const intersection=overlapDetails(a.rect,b.rect);
      if(intersection.width<=overlapTolerancePx||intersection.height<=overlapTolerancePx||intersection.area<minOverlapAreaPx)continue;
      findings.push({
        code:'interactive-overlap',severity:'high',selectors:[String(a.selector),String(b.selector)],
        details:{intersection,first:a.rect,second:b.rect}
      });
    }
  }
  return findings;
}

function groupStructuralFindings(findings){
  return{
    horizontalOverflow:findings.filter(item=>item.code==='horizontal-overflow'),
    offscreenInteractive:findings.filter(item=>item.code==='interactive-offscreen'),
    overlaps:findings.filter(item=>item.code==='interactive-overlap'),
    unlabeledControls:findings.filter(item=>item.code==='control-unlabelled'),
  };
}

export async function runUiSweep({
  page,
  baseURL,
  startPaths=['/'],
  maxPages=30,
  failOnHttp5xx=true,
  failOnPageError=true,
  failOnRequestFailure=true,
  preserveHashRoutes=false,
}={}){
  if(!page)throw new TypeError('page is required');
  const base=new URL(String(baseURL||''));
  const queue=[];
  const seen=new Set();
  for(const value of startPaths){
    const url=normalizeInternal(base.toString(),base.toString(),String(value),preserveHashRoutes);
    if(url&&!queue.includes(url))queue.push(url);
  }
  if(!queue.length)queue.push(base.toString());

  const consoleErrors=[];
  const pageErrors=[];
  const requestFailures=[];
  const httpErrors=[];
  page.on?.('console',message=>{
    const type=message.type?.()||'log';
    if(type==='error')consoleErrors.push({url:page.url?.()||null,text:message.text?.()||String(message)});
  });
  page.on?.('pageerror',error=>pageErrors.push({url:page.url?.()||null,message:error?.message||String(error)}));
  page.on?.('requestfailed',request=>requestFailures.push({
    url:request.url?.()||null,
    method:request.method?.()||null,
    error:request.failure?.()?.errorText||'request failed',
  }));
  page.on?.('response',response=>{
    const status=response.status?.();
    if(Number(status)>=400)httpErrors.push({
      url:response.url?.()||null,
      method:response.request?.().method?.()||null,
      status:Number(status),
    });
  });

  const pages=[];
  const findings=[];
  while(queue.length&&pages.length<Math.max(1,Number(maxPages)||1)){
    const target=queue.shift();
    if(!target||seen.has(target))continue;
    seen.add(target);
    let response=null;
    let navigationError=null;
    try{
      response=await page.goto(target,{waitUntil:'domcontentloaded'});
    }catch(error){
      navigationError=error?.message||String(error);
    }
    const current=page.url?.()||target;
    let inventory={title:'',links:[],buttons:[],forms:[],controls:[],structuralSnapshot:null};
    if(!navigationError){
      try{
        inventory=await page.evaluate(()=>{
          const selectorFor=node=>{
            if(node.id)return '#'+CSS.escape(node.id);
            const testId=node.getAttribute('data-testid');
            if(testId)return '[data-testid="'+String(testId).replaceAll('"','\\"')+'"]';
            const name=node.getAttribute('name');
            if(name)return node.tagName.toLowerCase()+'[name="'+String(name).replaceAll('"','\\"')+'"]';
            return node.tagName.toLowerCase();
          };
          const labelFor=node=>Boolean(
            node.getAttribute('aria-label')||node.getAttribute('aria-labelledby')||node.getAttribute('title')||
            node.getAttribute('placeholder')||(node.textContent||'').trim()||node.getAttribute('value')||
            (node.id&&document.querySelector('label[for="'+CSS.escape(node.id)+'"]')?.textContent?.trim())
          );
          const interactives=[...document.querySelectorAll('a[href],button,[role="button"],input:not([type="hidden"]),select,textarea,[tabindex]:not([tabindex="-1"])')].map(node=>{
            const rect=node.getBoundingClientRect();
            const style=getComputedStyle(node);
            const ancestors=[];
            for(let parent=node.parentElement;parent;parent=parent.parentElement){if(parent.id)ancestors.push('#'+CSS.escape(parent.id));}
            const dialog=node.closest('[role="dialog"]');
            return{
              selector:selectorFor(node),
              rect:{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height},
              visible:!node.hidden&&style.display!=='none'&&style.visibility!=='hidden'&&style.opacity!=='0'&&rect.width>0&&rect.height>0,
              labelled:labelFor(node),
              ancestorSelectors:ancestors,
              dialogId:dialog?selectorFor(dialog):null,
            };
          });
          return{
            title:document.title||'',
            links:[...document.querySelectorAll('a')].map(node=>({
              href:node.getAttribute('href')||'',
              resolved:node.href||'',
              text:(node.textContent||'').trim().slice(0,160),
            })),
            buttons:[...document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]')].map(node=>({
              text:(node.textContent||node.getAttribute('value')||node.getAttribute('aria-label')||'').trim().slice(0,160),
              disabled:Boolean(node.disabled||node.getAttribute('aria-disabled')==='true'),
            })),
            forms:[...document.querySelectorAll('form')].map(node=>({
              action:node.getAttribute('action')||'',
              method:(node.getAttribute('method')||'GET').toUpperCase(),
            })),
            controls:[...document.querySelectorAll('input:not([type="hidden"]),select,textarea')].map(node=>({
              name:node.getAttribute('name')||'',
              type:node.getAttribute('type')||node.tagName.toLowerCase(),
              labelled:labelFor(node),
            })),
            structuralSnapshot:{
              viewport:{width:window.innerWidth||document.documentElement.clientWidth,height:window.innerHeight||document.documentElement.clientHeight},
              document:{scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth},
              interactives,
            },
          };
        });
      }catch(error){
        navigationError='DOM inventory failed: '+(error?.message||String(error));
      }
    }

    const suspiciousLinks=(inventory.links||[]).filter(link=>{
      const href=String(link.href||'').trim().toLowerCase();
      return !href||href==='#'||href.startsWith('javascript:');
    });
    const unlabeledControls=(inventory.controls||[]).filter(control=>!control.labelled);
    const structuralFindings=analyzeStructuralGeometry(inventory.structuralSnapshot||{}).map(item=>({...item,url:current}));
    findings.push(...structuralFindings);
    const navigationStatus=Number(response?.status?.()||0)||null;
    pages.push({
      url:current,
      requestedUrl:target,
      title:inventory.title||'',
      navigationStatus,
      navigationError,
      counts:{
        links:(inventory.links||[]).length,
        buttons:(inventory.buttons||[]).length,
        forms:(inventory.forms||[]).length,
        controls:(inventory.controls||[]).length,
      },
      suspiciousLinks,
      unlabeledControls,
      structuralFindings,
      structure:groupStructuralFindings(structuralFindings),
    });

    for(const link of inventory.links||[]){
      const next=normalizeInternal(base.toString(),current,link.resolved||link.href,preserveHashRoutes);
      if(next&&!seen.has(next)&&!queue.includes(next))queue.push(next);
    }
  }

  const brokenNavigations=pages.filter(item=>item.navigationError||(item.navigationStatus!=null&&item.navigationStatus>=400));
  const fatalHttp=httpErrors.filter(item=>item.status>=500);
  const failures=[
    ...brokenNavigations.map(item=>({type:'navigation',url:item.url,detail:item.navigationError||('HTTP '+item.navigationStatus)})),
    ...(failOnPageError?pageErrors.map(item=>({type:'pageerror',url:item.url,detail:item.message})):[]),
    ...(failOnRequestFailure?requestFailures.map(item=>({type:'requestfailed',url:item.url,detail:item.error})):[]),
    ...(failOnHttp5xx?fatalHttp.map(item=>({type:'http5xx',url:item.url,detail:'HTTP '+item.status})):[]),
  ];

  return {
    schemaVersion:1,
    status:failures.length?'failed':'passed',
    baseURL:base.toString(),
    pages,
    consoleErrors,
    pageErrors,
    requestFailures,
    httpErrors,
    findings,
    failures,
    coverage:{visited:pages.length,queuedRemaining:queue.length,maxPages:Math.max(1,Number(maxPages)||1)},
  };
}
