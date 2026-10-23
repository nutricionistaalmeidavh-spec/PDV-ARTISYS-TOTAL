// Self-hosted static PWA delivery from the same build used by Cloudflare.
// Explicitly isolated from API routing. Never serve repository files or .local DB.
import {readFile,realpath} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const TYPES=Object.freeze({
  '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png',
  '.webp':'image/webp','.mp4':'video/mp4','.ico':'image/x-icon','.webmanifest':'application/manifest+json'
});
const headers=type=>({
  'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer','x-frame-options':'DENY'
});
export async function serveLocalPwa(pathname,{rootDir,method='GET'}={}){
  if(!['GET','HEAD'].includes(method))return new Response('',{status:405,headers:{allow:'GET, HEAD'}});
  if(typeof pathname!=='string'||!pathname.startsWith('/'))return new Response('',{status:400});
  let decoded;
  try{decoded=decodeURIComponent(pathname);}catch{return new Response('',{status:400});}
  if(/[\u0000-\u001F\\]/.test(decoded))return new Response('',{status:400});
  // Exact app entrypoint mapping; refuse arbitrary directory traversal or listings.
  const entries={'/':'/index.html','/app':'/app/index.html','/app/':'/app/index.html','/admin':'/admin/index.html','/admin/':'/admin/index.html','/conta':'/conta/index.html','/conta/':'/conta/index.html','/verificar-email':'/verificar-email/index.html','/verificar-email/':'/verificar-email/index.html','/recuperar-senha':'/recuperar-senha/index.html','/recuperar-senha/':'/recuperar-senha/index.html'};
  const assetPath=entries[decoded]||decoded;
  const parts=assetPath.split('/').slice(1);
  if(parts.some(part=>!part||part==='.'||part==='..'||part.startsWith('.')))
    return new Response('',{status:400});
  const root=resolve(rootDir||'.');
  const filename=resolve(root,...parts);
  if(!filename.startsWith(root+sep))return new Response('',{status:403});
  const type=TYPES[extname(filename).toLowerCase()];
  if(!type)return new Response('',{status:404});
  try{
    // Refuse symlink escapes even if malicious files reach dist/web.
    const realRoot=await realpath(root),realFile=await realpath(filename);
    if(!realFile.startsWith(realRoot+sep))return new Response('',{status:403});
    const data=method==='HEAD'?null:await readFile(realFile);
    return new Response(data,{status:200,headers:headers(type)});
  }catch(error){
    if(error.code==='ENOENT'||error.code==='ENOTDIR')return new Response('',{status:404});
    throw error;
  }
}
