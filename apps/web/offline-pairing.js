'use strict';
// URL QR: 256-bit one-time code is represented as 43 base64url characters,
// never shortened in entropy. Pairing URL is in the fragment and never sent
// in HTTPS request path/query. The fragment is removed before employee login.
(function(root){
  const KEY='pdv-offline-device-pairing-v1';
  const MAX_AGE=5*60*1000;
  const HEX=/^[a-f0-9]{64}$/;
  const ABC='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const SHORT=/^[A-Za-z0-9_-]{43}$/;
  const now=()=>root.Date?.now?.()??Date.now();
  function compact(hex){
    if(!HEX.test(String(hex||'')))throw Error('Código de pareamento inválido.');
    let result='';
    for(let i=0;i<32;i+=3){
      const a=parseInt(hex.slice(i*2,i*2+2),16);
      const b=i+1<32?parseInt(hex.slice((i+1)*2,(i+1)*2+2),16):0;
      const c=i+2<32?parseInt(hex.slice((i+2)*2,(i+2)*2+2),16):0;
      result+=ABC[a>>>2]+ABC[((a&3)<<4)|(b>>>4)];
      if(i+1<32)result+=ABC[((b&15)<<2)|(c>>>6)];
      if(i+2<32)result+=ABC[c&63];
    }
    return result;
  }
  function expand(short){
    if(!SHORT.test(short||''))return '';
    const bytes=[];
    for(let i=0;i<short.length;i+=4){
      const a=ABC.indexOf(short[i]),b=ABC.indexOf(short[i+1]);
      const c=i+2<short.length?ABC.indexOf(short[i+2]):-1;
      const d=i+3<short.length?ABC.indexOf(short[i+3]):-1;
      if(a<0||b<0||c===-1&&i+2<short.length||d===-1&&i+3<short.length)return '';
      bytes.push((a<<2)|(b>>>4));
      if(c>=0)bytes.push(((b&15)<<4)|(c>>>2));
      if(d>=0)bytes.push(((c&3)<<6)|d);
    }
    if(bytes.length!==32)return '';
    const hex=bytes.map(n=>n.toString(16).padStart(2,'0')).join('');
    return compact(hex)===short?hex:'';
  }
  function link(base,code){
    const value=compact(code);
    const url=new URL(base);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)
      throw Error('O QR Code precisa de uma origem HTTPS confiável.');
    url.pathname='/app/';
    url.hash='p='+value;
    if(url.toString().length>78)
      throw Error('Endereço HTTPS longo demais para o QR interno. Use o endereço e código separados.');
    return url.toString();
  }
  function read(){
    let payload;
    try{payload=JSON.parse(root.sessionStorage?.getItem(KEY)||'null');}catch{}
    if(!payload||!HEX.test(payload.code)||
      !Number.isFinite(payload.expiresAt)||payload.expiresAt<=now()){
      try{root.sessionStorage?.removeItem(KEY);}catch{}
      return '';
    }
    return payload.code;
  }
  function capture(){
    const hash=root.location?.hash||'';
    let code='';
    const match=/^#p=([A-Za-z0-9_-]{43})$/.exec(hash);
    if(match)code=expand(match[1]);
    else code=/^#pdv-pair=([a-f0-9]{64})$/.exec(hash)?.[1]||'';
    if(!code)return;
    try{root.history?.replaceState(null,'',root.location.pathname+root.location.search);}catch{}
    try{root.sessionStorage?.setItem(KEY,JSON.stringify({code,expiresAt:now()+MAX_AGE}));}catch{}
  }
  function take(){
    const value=read();
    try{root.sessionStorage?.removeItem(KEY);}catch{}
    return value;
  }
  capture();
  root.PdvOfflinePairing=Object.freeze({link,peek:read,take});
})(typeof window==='undefined'?globalThis:window);
