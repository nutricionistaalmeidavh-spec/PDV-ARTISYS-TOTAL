'use strict';

(() => {
  const content=document.getElementById('route-content');
  const lifecycle=window.PdvUiLifecycle;
  if(!content||!lifecycle)return;
  const positions=new Map();
  const focusTargets=new Map();
  let surface='',scope='',restoreNext=false;
  // No financial/customer values enter the browser navigation memory.
  // A route's scroll/focus may only be restored inside the same authorized context.
  const surfaceKey=(route,context=scope)=>{
    const id=String(route||document.body.dataset.activeRoute||'unknown');
    return String(context||'unauthenticated')+':'+id;
  };
  const currentTop=()=>Math.max(content.scrollTop||0,document.documentElement.scrollTop||0,document.body.scrollTop||0);
  const moveTo=top=>{content.scrollTo?.({top,behavior:'auto'});content.scrollTop=top;window.scrollTo?.({top,behavior:'auto'});};
  document.addEventListener('click',event=>{
    restoreNext=Boolean(event.target.closest?.('[data-scroll-restore],.sidebar-back,[id$="-back"],[data-back]'));
  },true);
  lifecycle.on('route:before',({route,previousRoute,scope:nextScope=''})=>{
    // A different user, tenant or branch must never inherit scroll/focus.
    if(scope&&scope!==nextScope){surface='';restoreNext=false;}
    scope=nextScope;
    if(!surface&&previousRoute)surface=surfaceKey(previousRoute);
    if(previousRoute&&route!==previousRoute&&surface){
      positions.set(surface,currentTop());
      if(previousRoute==='reports'){
        const tab=content.querySelector('[data-report-web][aria-selected="true"]');
        if(tab?.dataset?.reportWeb)focusTargets.set(surface,tab.dataset.reportWeb);
      }
    }
  });
  lifecycle.on('route:mounted',({route,scope:nextScope=''})=>{
    if(scope!==nextScope){scope=nextScope;surface='';restoreNext=false;}
    const next=surfaceKey(route);
    if(next===surface){restoreNext=false;return;}
    const restoreReport=route==='reports'&&positions.has(next);
    const top=(restoreNext||restoreReport)?(positions.get(next)||0):0;
    surface=next;restoreNext=false;
    requestAnimationFrame(()=>{
      // Delayed renderers can mount after this callback; never jump if route changed.
      if(surface!==next||document.body.dataset.activeRoute!==route)return;
      moveTo(top);

    });
  });
  // Restore only after the app has completed its default route-container focus.
  lifecycle.on('route:focus-ready',({route,scope:readyScope=''})=>{
    if(route!=='reports'||scope!==readyScope)return;
    const key=surfaceKey(route);
    if(surface!==key||!positions.has(key)||document.body.dataset.activeRoute!==route)return;
    const selectedId=focusTargets.get(key);
    const tabs=[...content.querySelectorAll('[data-report-web]')];
    const tab=tabs.find(item=>item.dataset.reportWeb===selectedId)||
      tabs.find(item=>item.getAttribute?.('aria-selected')==='true');
    tab?.focus?.({preventScroll:true});
  });
  if(document.body.dataset.activeRoute)surface=surfaceKey(document.body.dataset.activeRoute);
})();
