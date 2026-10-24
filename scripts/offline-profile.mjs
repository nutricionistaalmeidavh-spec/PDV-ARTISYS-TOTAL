// Offline PC configuration, deliberately separate from Cloudflare Wrangler JSON.
// The gateway credential is stored on this PC only (0600 on POSIX).
import {existsSync,mkdirSync,openSync,writeFileSync,closeSync,chmodSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
const id=/^[A-Za-z0-9-]{1,128}$/;
function origin(value,label){
 let parsed;
 try{parsed=new URL(value);}catch{throw Error(label+' requer URL HTTPS válida.');}
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||
  parsed.hash||parsed.pathname!=='/'||parsed.origin==='null')
   throw Error(label+' requer origem HTTPS sem caminho, credenciais ou parâmetros.');
 return parsed.origin;
}
export function validateOfflineProfile(input){
 const data={
  cloudOrigin:input.cloudOrigin||input.OFFLINE_CLOUD_ORIGIN,
  localOrigin:input.localOrigin||input.PDV_PUBLIC_ORIGIN,
  gatewayId:input.gatewayId||input.OFFLINE_GATEWAY_ID,
  token:input.token||input.OFFLINE_GATEWAY_TOKEN,
  tenantId:input.tenantId||input.OFFLINE_TENANT_ID,
  branchId:input.branchId||input.OFFLINE_BRANCH_ID,
  certPath:input.certPath||input.PDV_TLS_CERT,
  keyPath:input.keyPath||input.PDV_TLS_KEY,
  dataPath:input.dataPath||input.LOCAL_DB_PATH
 };
 const cloud=origin(data.cloudOrigin,'Cloudflare'),local=origin(data.localOrigin,'Servidor local');
 if(![data.gatewayId,data.tenantId,data.branchId].every(v=>id.test(v||'')))
  throw Error('Empresa, filial ou gateway inválido.');
 if(!/^[a-f0-9]{64}$/.test(data.token||''))throw Error('Token de gateway inválido (64 caracteres hex).');
 if(!data.certPath||!data.keyPath||!existsSync(data.certPath)||!existsSync(data.keyPath))
  throw Error('Certificado e chave HTTPS devem existir neste PC.');
 const port=Number(new URL(local).port||443);
 if(port<1||port>65535)throw Error('Porta HTTPS local inválida.');
 return {
  AUTH_ENABLED:'true',PDV_OFFLINE_REPLICA_ENABLED:'true',
  PDV_OFFLINE_CASH_ENABLED:input.PDV_OFFLINE_CASH_ENABLED==='true'?'true':'false',
  PDV_PUBLIC_ORIGIN:local,PDV_LAN_PORT:String(port),PDV_BIND_HOST:'0.0.0.0',
  PDV_TLS_CERT:resolve(data.certPath),PDV_TLS_KEY:resolve(data.keyPath),
  LOCAL_DB_PATH:resolve(data.dataPath||'apps/api/.local/pdv-offline.sqlite'),
  OFFLINE_CLOUD_ORIGIN:cloud+'/',OFFLINE_TENANT_ID:data.tenantId,
  OFFLINE_BRANCH_ID:data.branchId,OFFLINE_GATEWAY_ID:data.gatewayId,
  OFFLINE_GATEWAY_TOKEN:data.token
 };
}
export function writeOfflineProfile(path,profile){
 const dest=resolve(path);mkdirSync(dirname(dest),{recursive:true,mode:0o700});
 let fd;try{
  fd=openSync(dest,'wx',0o600);
  writeFileSync(fd,JSON.stringify({version:1,env:profile},null,2)+'\n');
  try{chmodSync(dest,0o600);}catch{}
 }catch(error){
  if(error.code==='EEXIST')throw Error('O perfil já existe; faça backup seguro e reconfigure explicitamente.');
  throw error;
 }finally{if(fd!==undefined)closeSync(fd);}
 return dest;
}
