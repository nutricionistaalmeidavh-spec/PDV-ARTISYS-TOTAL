'use strict';
// QR pairing is device authorization, never an employee login.
// A one-time 64-hex code is delivered in a URL fragment (not sent to HTTPS
// server as a query or request path), removed from browser history on arrival,
// and retained only for the five-minute login handoff in sessionStorage.
(function(root){
  const KEY='pdv-offline-device-pairing-v1';
  const MAX_AGE=5*60*1000;
  const PATTERN=/^[a-f0-9]{64}$/;
  const now=()=>root.Date?.now?.()??Date.now();
  function link(base,code){
    if(!PATTERN.test(String(code||'')))throw Error('Código de pareamento inválido.');
    const url=new URL(base);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)
      throw Error('O QR Code precisa de uma origem HTTPS confiável.');
    url.pathname='/app/';
    url.hash='pdv-pair='+code;
    return url.toString();
  }
  function read(){
    let payload;
    try{payload=JSON.parse(root.sessionStorage?.getItem(KEY)||'null');}catch{}
    if(!payload||!PATTERN.test(payload.code)||
      !Number.isFinite(payload.expiresAt)||payload.expiresAt<=now()){
      try{root.sessionStorage?.removeItem(KEY);}catch{}
      return '';
    }
    return payload.code;
  }
  function capture(){
    const match=/^#pdv-pair=([a-f0-9]{64})$/.exec(root.location?.hash||'');
    if(!match)return;
    try{root.history?.replaceState(null,'',root.location.pathname+root.location.search);}catch{}
    try{root.sessionStorage?.setItem(KEY,JSON.stringify({code:match[1],expiresAt:now()+MAX_AGE}));}catch{}
  }
  function take(){
    const value=read();
    try{root.sessionStorage?.removeItem(KEY);}catch{}
    return value;
  }
  capture();
  root.PdvOfflinePairing=Object.freeze({link,peek:read,take});
})(typeof window==='undefined'?globalThis:window);
