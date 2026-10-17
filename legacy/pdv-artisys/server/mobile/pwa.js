'use strict';

(()=>{
  const localHost=['localhost','127.0.0.1','::1'].includes(location.hostname);
  if(!('serviceWorker'in navigator)||!(window.isSecureContext||localHost))return;
  navigator.serviceWorker.register('/mobile/sw.js',{scope:'/mobile/'}).catch(()=>{});
})();
