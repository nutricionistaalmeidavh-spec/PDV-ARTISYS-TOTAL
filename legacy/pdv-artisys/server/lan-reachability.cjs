'use strict';

const {randomBytes}=require('node:crypto');

function createLanReachability({now=Date.now,ttlMs=120000}={}){
  const checks=new Map();
  function prune(){
    for(const [token,item] of checks){
      if(item.expiresAt<=now())checks.delete(token);
    }
  }
  function start(){
    prune();
    if(checks.size>=32)throw new Error('Há muitos testes de acesso em andamento. Tente novamente em instantes.');
    const token=randomBytes(16).toString('hex');
    const expiresAt=now()+ttlMs;
    checks.set(token,{expiresAt,confirmedAt:null});
    return{token,expiresAt};
  }
  function status(token){
    const item=checks.get(String(token||''));
    if(!item)return{confirmed:false,expired:true};
    if(item.expiresAt<=now()){checks.delete(token);return{confirmed:false,expired:true};}
    return{confirmed:Boolean(item.confirmedAt),expired:false,expiresAt:item.expiresAt};
  }
  function handle(request,response){
    const pathname=new URL(request.url||'/', 'http://localhost').pathname;
    const match=pathname.match(/^\/lan-check\/([a-f0-9]{32})$/);
    if(!match)return false;
    const token=match[1],item=checks.get(token);
    const headers={
      'content-type':'text/html; charset=utf-8',
      'cache-control':'no-store, max-age=0',
      'x-content-type-options':'nosniff',
      'referrer-policy':'no-referrer',
      'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
    };
    if(!item||item.expiresAt<=now()){
      checks.delete(token);
      response.writeHead(404,headers);
      response.end('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Teste expirado</title><p>Este teste expirou. Gere outro QR no ArtiSys.</p></html>');
      return true;
    }
    if(request.method==='POST')item.confirmedAt=now();
    else if(request.method!=='GET'){
      response.writeHead(405,{...headers,allow:'GET, POST'});
      response.end('Método não permitido');
      return true;
    }
    const confirmed=Boolean(item.confirmedAt);
    response.writeHead(200,headers);
    response.end('<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width, initial-scale=1"><meta charset="utf-8"><title>Teste de rede ArtiSys</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:12vh auto;padding:1.5rem;color:#14233b}button{background:#102c50;color:white;border:0;border-radius:12px;padding:1rem 1.25rem;font:inherit;min-height:48px}</style><main><h1>ArtiSys: conexão local</h1><p>'+ (confirmed?'Acesso pelo celular confirmado. Volte ao PDV.':'Você conseguiu acessar o computador principal pela rede. Toque abaixo para confirmar o teste no PDV.') +'</p>'+(confirmed?'':'<form method="post"><button type="submit">Confirmar acesso pelo celular</button></form>')+'</main></html>');
    return true;
  }
  return {start,status,handle};
}
module.exports={createLanReachability};
