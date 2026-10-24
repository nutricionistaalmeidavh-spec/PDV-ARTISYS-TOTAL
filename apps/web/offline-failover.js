'use strict';
// Navigation only. No CORS to LAN, no credential copying and no mutation retry.
// Browsers isolate Cloudflare and LAN cookies. The user pairs LAN once by QR.
(function(root){
 const KEY='artisys.pdv.local-origin.v1.';
 const VALID_ID=/^[a-zA-Z0-9-]{1,128}$/;
 function verified(origin){
  let url;try{url=new URL(origin);}catch{}
  if(!url||url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||
    url.username||url.password)throw Error('O servidor local exige uma origem HTTPS.');
  const host=url.hostname.toLowerCase();
  const privateIp=/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|127\.)\d{1,3}\.\d{1,3}(?:\.\d{1,3})?$/.test(host);
  if(!privateIp&&!host.endsWith('.lan')&&!host.endsWith('.local')&&
    !host.endsWith('.home.arpa')&&host!=='localhost')
   throw Error('Informe somente o endereço HTTPS local pareado, nunca um domínio externo.');
  return url.origin;
 }
 function configure(tenant,origin){
  if(!VALID_ID.test(tenant||''))throw Error('Empresa inválida.');
  const target=verified(origin);
  root.localStorage.setItem(KEY+tenant,target);
  return target;
 }
 function current(tenant){
  if(!VALID_ID.test(tenant||''))return '';
  try{return verified(root.localStorage.getItem(KEY+tenant)||'');}catch{return '';}
 }
 function onNetworkError(tenant,method){
  const target=current(tenant);
  // NEVER retry a POST/PUT/PATCH/DELETE: a 0-status response may have
  // committed remotely even if the ACK was lost on the mobile device.
  if(!target||!['GET','HEAD'].includes(String(method).toUpperCase()))return false;
  if(root.location.origin===target)return false;
  const now=Date.now(),key='artisys.pdv.failover.last';
  const last=Number(root.sessionStorage?.getItem(key)||0);
  if(now-last<60000)return false;
  root.sessionStorage?.setItem(key,String(now));
  root.location.assign(target+'/app/');
  return true;
 }
 root.PdvOfflineFailover={configure,current,onNetworkError};
})(window);
