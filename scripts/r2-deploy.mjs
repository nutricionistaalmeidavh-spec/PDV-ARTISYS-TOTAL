// R2: free, standalone Windows server/terminal deployment profiles.
// Configuration stores only file paths and the HTTPS origin, never passwords or device credentials.
import {spawn} from 'node:child_process';
import {access,mkdir,readFile,stat,writeFile,rm} from 'node:fs/promises';
import {resolve,dirname,join,relative,sep,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const FORMAT='pdv-total-r2-deployment-v1';
const privateRoot=resolve(ROOT,'dist/web');

export function canonicalLanOrigin(value){
  let url;
  try{url=new URL(value);}catch{throw Error('Informe a origem HTTPS da LAN.');}
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||
    url.search||url.hash||url.origin==='null')
    throw Error('Endereço da LAN deve ser uma origem HTTPS sem caminho ou credenciais.');
  return url.origin;
}
function safePath(value,name){
  if(typeof value!=='string'||!value.trim()||/[\r\n"]/u.test(value))
    throw Error('Caminho inválido: '+name);
  return resolve(value);
}
function outsidePublicWeb(file){
  const rel=relative(privateRoot,file);
  if(rel===''||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep))){
    throw Error('Arquivos privados do servidor não podem ficar na pasta web.');
  }
}
async function configFromDisk(path){
  const config=JSON.parse(await readFile(safePath(path,'config'),'utf8'));
  if(config?.format!==FORMAT||config?.role!=='SERVER')throw Error('Perfil de servidor inválido.');
  config.origin=canonicalLanOrigin(config.origin);
  config.key=safePath(config.key,'TLS key');config.cert=safePath(config.cert,'TLS cert');
  config.database=safePath(config.database,'SQLite');
  outsidePublicWeb(config.key);outsidePublicWeb(config.cert);outsidePublicWeb(config.database);
  await access(config.key);await access(config.cert);
  if(!['127.0.0.1','0.0.0.0','::1'].includes(config.bindHost))
    throw Error('Bind LAN deve ser explicitamente autorizado.');
  return config;
}
export async function prepareLocalServer({directory,origin,key,cert,database,bindHost='127.0.0.1'}){
  const target=safePath(directory,'diretório'),url=canonicalLanOrigin(origin);
  key=safePath(key,'TLS key');cert=safePath(cert,'TLS cert');
  database=safePath(database,'SQLite');
  for(const path of [key,cert,database])outsidePublicWeb(path);
  await access(key);await access(cert);
  if(!['127.0.0.1','0.0.0.0','::1'].includes(bindHost))throw Error('Bind de servidor inválido.');
  const config={format:FORMAT,role:'SERVER',origin:url,key,cert,database,bindHost,
    cloudRequired:false,deviceCredentialIncluded:false};
  const configPath=join(target,'pdv-total-server.json');
  const shortcutPath=join(target,'iniciar-pdv-total.cmd');
  const bat='@echo off\r\ncd /d "'+ROOT+'"\r\nnode --experimental-sqlite "scripts\\r2-deploy.mjs" launch-server --config "'+configPath+'"\r\n';
  await mkdir(target,{recursive:true,mode:0o700});
  let created=false;
  try{
    await writeFile(configPath,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
    created=true;
    await writeFile(shortcutPath,bat,{flag:'wx',mode:0o600});
  }catch(error){
    if(created)await rm(configPath,{force:true});
    throw error;
  }
  return {role:'SERVER',configPath,shortcutPath,origin:url,cloudRequired:false};
}
export async function prepareLocalTerminal({directory,origin}){
  const target=safePath(directory,'diretório'),url=canonicalLanOrigin(origin);
  const shortcutPath=join(target,'pdv-total-terminal.url');
  await mkdir(target,{recursive:true,mode:0o700});
  await writeFile(shortcutPath,'[InternetShortcut]\r\nURL='+url+'/\r\n',
    {flag:'wx',mode:0o600});
  return {role:'TERMINAL',shortcutPath,origin:url,cloudRequired:false};
}
export async function checkLocalServer(configPath){ 
  const config=await configFromDisk(configPath);
  return {role:config.role,origin:config.origin,cloudRequired:false,readyForLaunch:true};
}
export async function launchLocalServer(configPath){
  const config=await configFromDisk(configPath);
  const url=new URL(config.origin);
  const env={...process.env,AUTH_ENABLED:'true',COOKIE_SECURE:'true',
    PDV_PUBLIC_ORIGIN:config.origin,PDV_LAN_PORT:String(url.port||443),
    PDV_BIND_HOST:config.bindHost,PDV_TLS_KEY:config.key,PDV_TLS_CERT:config.cert,
    LOCAL_DB_PATH:config.database};
  const child=spawn(process.execPath,['--experimental-sqlite',join(ROOT,'apps/api/src/https-lan-server.mjs')],
    {cwd:ROOT,env,stdio:'inherit'});
  for(const signal of ['SIGINT','SIGTERM'])
    process.once(signal,()=>child.kill(signal));
  return await new Promise((ok,reject)=>{
    child.once('error',reject);
    child.once('exit',(code,signal)=>ok(code??(signal?1:0)));
  });
}
function argsOf(list){
  const out={};
  for(let i=0;i<list.length;i+=2){
    const key=list[i];
    if(!key?.startsWith('--')||!list[i+1]||list[i+1].startsWith('--')||out[key.slice(2)])
      throw Error('Argumentos inválidos.');
    out[key.slice(2)]=list[i+1];
  }
  return out;
}
async function main(){
  const [op,...rest]=process.argv.slice(2),a=argsOf(rest);
  let result;
  if(op==='server')result=await prepareLocalServer({directory:a.dir,origin:a.origin,
    key:a.key,cert:a.cert,database:a.db,bindHost:a.bind||'127.0.0.1'});
  else if(op==='terminal')result=await prepareLocalTerminal({directory:a.dir,origin:a.origin});
  else if(op==='check-server')result=await checkLocalServer(a.config);
  else if(op==='launch-server'){process.exitCode=await launchLocalServer(a.config);return;}
  else throw Error('Uso: server --dir ... --origin https://... --key cert.key --cert cert.pem --db data.sqlite | terminal --dir ... --origin https://... | check-server --config ... | launch-server --config ...');
  console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{console.error('[PDV LAN] '+error.message);process.exitCode=1;});
