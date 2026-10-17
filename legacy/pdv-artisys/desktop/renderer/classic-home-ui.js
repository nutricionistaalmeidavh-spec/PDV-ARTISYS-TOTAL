'use strict';

(()=>{
  const lifecycle=window.PdvUiLifecycle;
  const navigation=window.PdvAppNavigation;
  const brandButton=document.querySelector('.brand-mark');
  if(!lifecycle||!brandButton)return;
  function sync({route=document.body.dataset.activeRoute}={}){
    const active=route==='home';
    document.body.classList.toggle('home-view-classic',active);
    brandButton.classList.toggle('active',active);
  }
  brandButton.title='Início';
  brandButton.setAttribute('aria-label','Ir para início');
  brandButton.addEventListener('click',event=>{
    if(!navigation?.navigate)return;
    event.preventDefault();
    void navigation.navigate('home');
  });
  lifecycle.on('route:mounted',sync);
  lifecycle.on('route:updated',sync);
  lifecycle.on('user:changed',()=>sync({route:document.body.dataset.activeRoute}));
  sync();
})();
