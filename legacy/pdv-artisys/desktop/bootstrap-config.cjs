'use strict';

const fs=require('node:fs');
const path=require('node:path');

const PROFILE_SERVER_TERMINAL='server-terminal';
const PROFILE_TERMINAL='terminal';
const PROFILES=new Set([PROFILE_SERVER_TERMINAL,PROFILE_TERMINAL]);
const DEFAULT_ACCOUNT_ENDPOINT='https://pdv-artisys.sistema-artisys.workers.dev';

function clean(value){const text=String(value??'').trim();return text||null;}
function envBoolean(value,defaultValue=false){const text=String(value??'').trim();return text?/^(1|true|yes|on)$/i.test(text):Boolean(defaultValue);}
function readPersisted(configPath){
  if(!configPath||!fs.existsSync(configPath))return{};
  try{const raw=JSON.parse(fs.readFileSync(configPath,'utf8'));if(!raw||typeof raw!=='object'||Array.isArray(raw))return{};return raw;}catch{return{};}
}
function safePersisted(raw){
  return{
    profile:clean(raw.profile),apiBase:clean(raw.apiBase||raw.serverUrl),terminalId:clean(raw.terminalId),terminalName:clean(raw.terminalName),storeName:clean(raw.storeName)
  };
}
function resolveBootstrapConfig({env=process.env,configPath=null}={}){
  const stored=safePersisted(readPersisted(configPath));
  const profile=clean(env.PDV_DEPLOYMENT_PROFILE)||stored.profile||PROFILE_SERVER_TERMINAL;
  return{
    profile,
    apiBase:clean(env.PDV_SERVER_URL)||stored.apiBase||null,
    terminalId:clean(env.PDV_TERMINAL_ID)||stored.terminalId||'PDV-01',
    terminalName:clean(env.PDV_TERMINAL_NAME)||stored.terminalName||'Terminal PDV-01',
    terminalKey:clean(env.PDV_TERMINAL_KEY)||null,
    storeName:clean(env.PDV_STORE_NAME)||stored.storeName||'Loja Matriz',
    accountEndpoint:clean(env.PDV_ACCOUNT_ENDPOINT)||DEFAULT_ACCOUNT_ENDPOINT,
    requireCommercialActivation:envBoolean(env.PDV_REQUIRE_COMMERCIAL_ACTIVATION,true),
    configPath:configPath?path.resolve(configPath):null
  };
}
function validateBootstrapConfig(config={},options={}){
  const requireCredential=options.requireCredential!==false;
  if(!PROFILES.has(config.profile))throw new Error('Perfil de implantacao invalido.');
  if(config.profile===PROFILE_TERMINAL){
    if(!config.apiBase)throw new Error('URL do servidor e obrigatoria no perfil terminal.');
    let parsed;try{parsed=new URL(config.apiBase);}catch{throw new Error('URL HTTP do servidor invalida.');}
    if(!['http:','https:'].includes(parsed.protocol))throw new Error('Servidor do terminal deve usar HTTP ou HTTPS.');
    if(!clean(config.terminalId))throw new Error('Identificador do terminal obrigatorio.');
    if(requireCredential&&!clean(config.terminalKey))throw new Error('Credencial segura do terminal obrigatoria.');
  }
  if(config.accountEndpoint){let parsed;try{parsed=new URL(config.accountEndpoint);}catch{throw new Error('Endpoint da conta comercial invalido.');}if(parsed.protocol!=='https:'&&parsed.hostname!=='127.0.0.1'&&parsed.hostname!=='localhost')throw new Error('Endpoint da conta comercial deve usar HTTPS.');}
  return config;
}
function shouldStartEmbeddedServer(config={}){return config.profile===PROFILE_SERVER_TERMINAL;}
function writeBootstrapConfig(configPath,input={}){
  if(!configPath)throw new Error('Caminho de configuracao obrigatorio.');
  const config=safePersisted(input);validateBootstrapConfig({...config,apiBase:config.apiBase||null},{requireCredential:false});fs.mkdirSync(path.dirname(configPath),{recursive:true});
  const tmp=`${configPath}.tmp`;fs.writeFileSync(tmp,`${JSON.stringify(config,null,2)}\n`,{encoding:'utf8',mode:0o600});fs.renameSync(tmp,configPath);return config;
}

module.exports={PROFILE_SERVER_TERMINAL,PROFILE_TERMINAL,DEFAULT_ACCOUNT_ENDPOINT,resolveBootstrapConfig,validateBootstrapConfig,shouldStartEmbeddedServer,writeBootstrapConfig};
