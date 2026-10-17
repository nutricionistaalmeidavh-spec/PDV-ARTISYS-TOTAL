(function(){
  'use strict';
  if(!('serviceWorker' in navigator)||!window.isSecureContext)return;
  const status=()=>document.body?.toggleAttribute('data-offline',navigator.onLine===false);
  window.addEventListener('online',status);
  window.addEventListener('offline',status);
  status();
  window.addEventListener('load',()=>{
    // Registration never owns state, transactions or navigation.
    navigator.serviceWorker.register('/sw.js',{scope:'/'})
      .catch(()=>{/* PWA is an enhancement, not a prerequisite to operate */});
  },{once:true});
})();
