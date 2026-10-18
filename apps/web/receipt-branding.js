'use strict';
// Browser-side non-fiscal branding. Settings are scoped to one tenant/branch on
// this browser, never become an alternative authoritative commercial database.
// Desktop reference: js/domains/printing/receipt-branding.js @ 7efea9c.
(function(root){
  const PREFIX='pdv-total.receipt-branding.v1.';
  const MAX_LOGO_BYTES=512*1024;
  const DEFAULT=Object.freeze({name:'PDV TOTAL',address:'',phone:'',logoDataUrl:null});
  function cleanLine(value,length){
    return String(value??'').replace(/[\r\n\t]+/g,' ').replace(/\s{2,}/g,' ').trim().slice(0,length);
  }
  function normalizeLogoDataUrl(value){
    if(typeof value!=='string'||value.length>4*Math.ceil(MAX_LOGO_BYTES/3)+50)return null;
    const match=/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value.trim());
    if(!match)return null;
    let binary;
    try{binary=root.atob(match[1]);}catch{return null;}
    if(!binary||binary.length>MAX_LOGO_BYTES||binary.length<8)return null;
    const bytes=[137,80,78,71,13,10,26,10];
    if(bytes.some((n,i)=>binary.charCodeAt(i)!==n))return null;
    return 'data:image/png;base64,'+match[1];
  }
  function normalize(input={}){
    return Object.freeze({
      name:cleanLine(input.name??DEFAULT.name,80)||DEFAULT.name,
      address:cleanLine(input.address,160),
      phone:cleanLine(input.phone,60),
      logoDataUrl:normalizeLogoDataUrl(input.logoDataUrl)
    });
  }
  function scopeKey(scope){
    let target=scope;
    if(!target){const Client=root.PdvApiClient?.ApiClient;target=Client?new Client():{};}
    const tenant=String(target?.tenantId||''),branch=String(target?.branchId||'');
    if(!/^[a-z0-9_-]{1,128}$/i.test(tenant)||!/^[a-z0-9_-]{1,128}$/i.test(branch))
      throw Error('Selecione o estabelecimento e a filial antes de configurar comprovantes.');
    // Explicit length-prefix prevents ambiguous concatenation of tenant/branch.
    return PREFIX+tenant.length+'-'+tenant+'.'+branch.length+'-'+branch;
  }
  function read(scope){
    let raw;
    try{raw=root.localStorage?.getItem(scopeKey(scope));}
    catch{return DEFAULT;}
    try{return normalize(raw?JSON.parse(raw):{});}catch{return DEFAULT;}
  }
  function write(input,scope){
    const key=scopeKey(scope),branding=normalize(input);
    if(!root.localStorage?.setItem)throw Error('Este navegador não permite salvar preferências locais.');
    root.localStorage.setItem(key,JSON.stringify(branding));
    return branding;
  }
  root.PdvReceiptBranding=Object.freeze({normalize,read,write,MAX_LOGO_BYTES});
})(window);
