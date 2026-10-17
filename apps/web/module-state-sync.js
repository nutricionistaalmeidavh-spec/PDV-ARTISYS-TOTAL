'use strict';

(() => {
  const root=window;
  if(root.PdvModuleStateSync)return;
  const lifecycle=root.PdvUiLifecycle;
  if(!lifecycle)return;

  function routeContent(){return document.getElementById('route-content');}
  function annotateWorkspace(){
    const content=routeContent();
    if(!content)return null;
    const workspace=content.querySelector('.vertical-page,.restaurant-page,.page')||content.firstElementChild;
    const moduleId=document.body.dataset.activeModuleWorkspace||null;
    if(moduleId)workspace?.setAttribute('data-module-workspace',moduleId);
    else workspace?.removeAttribute('data-module-workspace');
    return moduleId;
  }
  function handleStateChange(){
    annotateWorkspace();
  }

  root.addEventListener('artisys:modules-state-changed',handleStateChange);
  lifecycle.on('route:mounted',()=>annotateWorkspace());
  lifecycle.on('route:updated',()=>annotateWorkspace());
  lifecycle.on('surface:mounted',()=>annotateWorkspace());
  annotateWorkspace();
  root.PdvModuleStateSync=Object.freeze({annotateWorkspace});
})();
