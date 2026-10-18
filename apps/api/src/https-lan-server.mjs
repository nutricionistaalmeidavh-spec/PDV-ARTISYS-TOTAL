import {createServer} from 'node:https';
import {readFileSync,readdirSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {dirname,extname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {openLocalDatabase} from './local-db.mjs';
import {applyLocalMigrations} from './local-migrations.mjs';
import {createApi} from './worker.mjs';

// Independent HTTPS entrypoint. The existing loopback-only HTTP server stays dev-only.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const EXTENSIONS=new Map([
  ['.html','text/html; charset=utf-8'],['.js','text/javascript; charset=utf-8'],
  ['.css','text/css; charset=utf-8'],['.json','application/json; charset=utf-8'],
  ['.svg','image/svg+xml'],['.webmanifest','application/manifest+json'],
  ['.png','image/png'],['.webp','image/webp'],['.ico','image/x-icon']
]);
const SECURE_HEADERS={
  'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
  'x-frame-options':'DENY','content-security-policy':"frame-ancestors 'none'",
  'permissions-policy':'camera=(), microphone=(), geolocation=()',
  'cache-control':'no-store'
};
const MAX_REQUEST_BYTES=2*1024*1024;

export function lanConfig(env=process.env){
  let origin;
  try{origin=new URL(env.PDV_PUBLIC_ORIGIN);}catch{throw Error('PDV_PUBLIC_ORIGIN: informe a URL HTTPS exata usada nos terminais.');}
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||
    origin.search||origin.hash||origin.origin==='null')
    throw Error('PDV_PUBLIC_ORIGIN deve ser apenas a origem HTTPS, sem caminho ou credenciais.');
  const port=Number(env.PDV_LAN_PORT||8443);
  if(!Number.isInteger(port)||port<1||port>65535||Number(origin.port||443)!==port)
    throw Error('PDV_LAN_PORT deve corresponder à porta de PDV_PUBLIC_ORIGIN.');
  if(!env.PDV_TLS_KEY||!env.PDV_TLS_CERT)
    throw Error('TLS obrigatório: informe PDV_TLS_KEY e PDV_TLS_CERT.');
  if(env.AUTH_ENABLED!=='true')
    throw Error('Habilitação explícita de login obrigatória: AUTH_ENABLED=true.');
  const bindHost=env.PDV_BIND_HOST||'127.0.0.1';
  if(!/^[a-z0-9.:_-]+$/i.test(bindHost))throw Error('PDV_BIND_HOST inválido.');
  return {origin:origin.origin,port,bindHost,
    tlsKey:readFileSync(env.PDV_TLS_KEY),tlsCert:readFileSync(env.PDV_TLS_CERT),
    databasePath:resolve(env.LOCAL_DB_PATH||join(root,'apps/api/.local/pdv-total.sqlite')),
    webRoot:resolve(root,'dist/web')};
}

function publicAssets(webRoot){
  const entries=new Map();
  function walk(folder,prefix=''){
    for(const entry of readdirSync(folder,{withFileTypes:true})){
      if(entry.name.startsWith('.'))continue;
      const name=prefix+'/'+entry.name;
      if(entry.isDirectory())walk(join(folder,entry.name),name);
      else if(entry.isFile()&&EXTENSIONS.has(extname(entry.name)))
        entries.set(name,join(folder,entry.name));
    }
  }
  walk(webRoot);
  if(!entries.has('/index.html')||!entries.has('/sw.js'))
    throw Error('UI web não compilada: execute npm run build antes do servidor LAN.');
  return entries;
}

function reject(res,status,message){
  res.writeHead(status,{'content-type':'application/json; charset=utf-8',...SECURE_HEADERS});
  res.end(JSON.stringify({error:message}));
}
function safePath(raw){
  if(typeof raw!=='string'||!raw.startsWith('/')||raw.startsWith('//')||raw.includes('\\')||
    /%(?:00|2f|5c)/i.test(raw))return false;
  let decoded;
  try{decoded=decodeURIComponent(raw.split('?')[0]);}catch{return false;}
  return !decoded.split('/').some(part=>part==='.'||part==='..');
}
async function bodyFor(req){
  const chunks=[];let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>MAX_REQUEST_BYTES){
      // Drain the remaining request without forwarding any partial mutation.
      for await(const _ of req){}
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createLanServer({origin,tlsKey,tlsCert,db,webRoot}){
  const expected=new URL(origin);
  if(expected.protocol!=='https:'||expected.pathname!=='/'||expected.search||expected.hash)
    throw Error('Servidor LAN exige origem HTTPS exata.');
  if(!db||!tlsKey||!tlsCert)throw Error('Banco e TLS obrigatórios.');
  const assets=publicAssets(webRoot);
  const api=createApi({DB:db,COOKIE_SECURE:'true',AUTH_ENABLED:'true',LOCAL_MEDIA_ENABLED:'true'});
  return createServer({key:tlsKey,cert:tlsCert,minVersion:'TLSv1.2'},async(req,res)=>{
    try{
      if(req.headers.host!==expected.host){
        reject(res,421,'Host inválido para este terminal.');return;
      }
      if(!safePath(req.url)){
        reject(res,400,'Caminho inválido.');return;
      }
      const url=new URL(req.url,expected.origin);
      const method=req.method||'GET';
      if(url.pathname.startsWith('/api/')){
        if(!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(method)){
          reject(res,405,'Método não permitido.');return;
        }
        const length=Number(req.headers['content-length']||0);
        if(!Number.isFinite(length)||length>MAX_REQUEST_BYTES){
          reject(res,413,'Solicitação excede o limite.');return;
        }
        const body=['GET','HEAD'].includes(method)?undefined:await bodyFor(req);
        if(body===null){reject(res,413,'Solicitação excede o limite.');return;}
        const headers=new Headers();
        for(const [name,value] of Object.entries(req.headers))
          if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(', '):value);
        const request=new Request(url,{method,headers,...(body===undefined?{}:{body})});
        const response=await api.fetch(request);
        res.writeHead(response.status,{...Object.fromEntries(response.headers.entries()),...SECURE_HEADERS});
        res.end(Buffer.from(await response.arrayBuffer()));return;
      }
      if(!['GET','HEAD'].includes(method)){
        reject(res,405,'Arquivos da interface são somente leitura.');return;
      }
      const path=url.pathname==='/'?'/index.html':url.pathname;
      const filename=assets.get(path);
      if(!filename){reject(res,404,'Arquivo não encontrado.');return;}
      const file=await readFile(filename);
      res.writeHead(200,{'content-type':EXTENSIONS.get(extname(filename)),...SECURE_HEADERS,
        'content-length':String(file.length)});
      res.end(method==='HEAD'?undefined:file);
    }catch(error){
      console.error('[PDV LAN] request error',error?.name||'Error');
      if(!res.headersSent)reject(res,500,'Erro interno.');else res.end();
    }
  });
}

async function start(){
  const config=lanConfig();
  const db=openLocalDatabase(config.databasePath);
  try{
    const migrated=await applyLocalMigrations(db);
    const server=createLanServer({...config,db});
    server.listen(config.port,config.bindHost,()=>{
      console.log('PDV TOTAL HTTPS LAN pronto em '+config.origin+
        ' (bind '+config.bindHost+':'+config.port+', '+migrated.applied+' migrações novas)');
    });
    for(const signal of ['SIGINT','SIGTERM'])
      process.once(signal,()=>server.close(()=>{db.close();process.exit(0);}));
  }catch(error){db.close();throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  start().catch(e=>{console.error('[PDV LAN] '+e.message);process.exitCode=1;});
