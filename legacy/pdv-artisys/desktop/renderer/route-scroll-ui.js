'use strict';

(() => {
  const content=document.getElementById('route-content');
  const lifecycle=window.PdvUiLifecycle;
  if(!content||!lifecycle)return;
  const positions=new Map();
  let surface='';let restoreNext=false;
  const surfaceKey=route=>{const id=String(route||document.body.dataset.activeRoute||'unknown');const title=content.querySelector('h1')?.textContent?.trim()||'';return title?`${id}:${title}`:id;};
  const currentTop=()=>Math.max(content.scrollTop||0,document.documentElement.scrollTop||0,document.body.scrollTop||0);
  const moveTo=top=>{content.scrollTo?.({top,behavior:'auto'});content.scrollTop=top;window.scrollTo?.({top,behavior:'auto'});};
  document.addEventListener('click',event=>{restoreNext=Boolean(event.target.closest?.('[data-scroll-restore],.sidebar-back,[id$="-back"],[data-back]'));},true);
  lifecycle.on('route:before',({route,previousRoute})=>{
    if(!surface)surface=surfaceKey(previousRoute);
    if(previousRoute&&route!==previousRoute&&surface)positions.set(surface,currentTop());
  });
  lifecycle.on('route:mounted',({route})=>{
    const next=surfaceKey(route);
    if(next===surface){restoreNext=false;return;}
    const top=restoreNext?(positions.get(next)||0):0;
    surface=next;restoreNext=false;
    requestAnimationFrame(()=>moveTo(top));
  });
  if(document.body.dataset.activeRoute)surface=surfaceKey(document.body.dataset.activeRoute);
})();
