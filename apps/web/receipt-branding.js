'use strict';
// Browser-side non-fiscal branding. Settings are scoped to one tenant/branch on
// this browser, never become an alternative authoritative commercial database.
// Desktop reference: js/domains/printing/receipt-branding.js @ 7efea9c.
(function(root){
  const PREFIX='pdv-total.receipt-branding.v1.';
  const MAX_LOGO_BYTES=512*1024;
  const DEFAULT=Object.freeze({name:'PDV TOTAL',address:'',phone:'',logoDataUrl:null});
  const cache=new Map();
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
    try{const key=scopeKey(scope);if(cache.has(key))return cache.get(key);raw=root.localStorage?.getItem(key);}
    catch{return DEFAULT;}
    try{return normalize(raw?JSON.parse(raw):{});}catch{return DEFAULT;}
  }
  function write(input,scope){
    const key=scopeKey(scope),branding=normalize(input);
    if(!root.localStorage?.setItem)throw Error('Este navegador não permite salvar preferências locais.');
    root.localStorage.setItem(key,JSON.stringify(branding));
    cache.set(key,branding);
    return branding;
  }
  function client(){const Client=root.PdvApiClient?.ApiClient;if(!Client)throw Error('API de comprovantes indisponível.');return new Client();}
  async function load(scope){
    const api=client(),branch=String(scope?.branchId||api.branchId||'');
    if(!branch)throw Error('Selecione uma filial para carregar a identidade do comprovante.');
    const result=await api.request('/api/v1/printing/branding?branchId='+encodeURIComponent(branch));
    const value=normalize(result.branding);
    cache.set(scopeKey(scope||api),value);
    return value;
  }
  async function save(input,scope){
    const api=client(),branch=String(scope?.branchId||api.branchId||'');
    if(!branch)throw Error('Selecione uma filial para salvar a identidade do comprovante.');
    const value=normalize(input);
    const result=await api.request('/api/v1/printing/branding',{method:'PUT',body:{...value,branchId:branch}});
    const saved=normalize(result.branding);
    cache.set(scopeKey(scope||api),saved);
    // Mirror only after server acknowledgement, to support the legacy synchronous browser renderer.
    // Authoritative server snapshot always wins for finalized sales and reprints.
    try{root.localStorage?.setItem(scopeKey(scope||api),JSON.stringify(saved));}catch{}
    return saved;
  }
  root.PdvReceiptBranding=Object.freeze({normalize,read,write,load,save,MAX_LOGO_BYTES});
})(window);
