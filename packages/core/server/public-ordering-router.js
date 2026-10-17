'use strict';

const fs=require('node:fs');
const path=require('node:path');

class PublicOrderingHttpError extends Error{constructor(statusCode,message){super(message);this.statusCode=statusCode;}}
function json(response,statusCode,payload){response.writeHead(statusCode,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(payload));}
function text(response,statusCode,payload,type='text/plain; charset=utf-8',extra={}){response.writeHead(statusCode,{'content-type':type,'cache-control':'no-store',...extra});response.end(payload);}
async function body(request,limit=1024*1024){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>limit)throw new PublicOrderingHttpError(413,'Corpo da requisicao excede o limite permitido.');chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new PublicOrderingHttpError(400,'JSON invalido.');}}
function statusFor(error){if(error?.statusCode)return error.statusCode;if(error?.code==='MODULE_DISABLED')return 409;const message=String(error?.message||'');if(/QR|nao esta ativo/i.test(message))return 404;if(/indisponivel|sem comanda|fechamento/i.test(message))return 409;return 400;}

function createPublicOrderingRouter({runtime,publicDir=path.join(__dirname,'customer-menu')}={}){
  if(!runtime?.publicOrdering)throw new TypeError('public ordering runtime is required.');

  const files=new Map([
    ['/menu/app.js',['app.js','application/javascript; charset=utf-8']],
    ['/menu/styles.css',['styles.css','text/css; charset=utf-8']],
    ['/menu/icon.svg',['icon.svg','image/svg+xml; charset=utf-8']],
    ['/menu/order-composer.js',[path.join(__dirname,'..','shared','order-composer.js'),'application/javascript; charset=utf-8',true]]
  ]);
  function serveStatic(pathname,response){
    const entry=files.get(pathname);if(!entry)return false;const full=entry[2]?entry[0]:path.join(publicDir,entry[0]);if(!fs.existsSync(full)){text(response,404,'Interface de cardapio nao instalada.');return true;}text(response,200,fs.readFileSync(full,'utf8'),entry[1]);return true;
  }
  function serveMenuShell(pathname,response){
    if(!/^\/m\/[A-Za-z0-9_-]{20,64}\/?$/.test(pathname))return false;const full=path.join(publicDir,'index.html');if(!fs.existsSync(full)){text(response,404,'Interface de cardapio nao instalada.');return true;}text(response,200,fs.readFileSync(full,'utf8'),'text/html; charset=utf-8',{'x-robots-tag':'noindex, nofollow'});return true;
  }
  async function mutate(request,pathname,statusCode,handler){const mutationId=String(request.headers['x-mutation-id']||'').trim();if(!mutationId||!runtime.mutations)return{statusCode,payload:await handler(mutationId||null)};return runtime.mutations.execute({mutationId,method:request.method,path:pathname},async()=>({statusCode,payload:await handler(mutationId)}));}

  return async function publicOrderingRouter(request,response){
    const url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`);const pathname=url.pathname;
    if(request.method==='GET'&&serveStatic(pathname,response))return true;
    if(request.method==='GET'&&serveMenuShell(pathname,response))return true;
    if(!pathname.startsWith('/api/v1/public/menu/'))return false;
    try{
      const photoMatch=pathname.match(/^\/api\/v1\/public\/menu\/([^/]+)\/products\/([^/]+)\/photo$/);
      if(request.method==='GET'&&photoMatch){const token=decodeURIComponent(photoMatch[1]);const productId=decodeURIComponent(photoMatch[2]);if(!runtime.publicOrdering.canReadPhoto(token,productId))throw new PublicOrderingHttpError(404,'Foto nao encontrada.');const photo=runtime.productPhotos.read(productId,'thumbnail');const etag=`"${photo.sha256}"`;if(request.headers['if-none-match']===etag){response.writeHead(304,{etag,'cache-control':'private, max-age=86400'});response.end();return true;}response.writeHead(200,{'content-type':photo.mimeType,'content-length':photo.bytes.length,'cache-control':'private, max-age=86400',etag});response.end(photo.bytes);return true;}
      const match=pathname.match(/^\/api\/v1\/public\/menu\/([^/]+)(?:\/(orders|service))?$/);if(!match)throw new PublicOrderingHttpError(404,'Rota de cardapio nao encontrada.');const token=decodeURIComponent(match[1]);const action=match[2]||'';
      if(request.method==='GET'&&!action){json(response,200,runtime.publicOrdering.publicContext(token));return true;}
      if(request.method==='POST'&&action==='orders'){const data=await body(request);const result=await mutate(request,pathname,201,async mutationId=>{const order=runtime.publicOrdering.submitOrder(token,data,mutationId);const dispatch=await runtime.dispatchPending();return{order,dispatch};});json(response,result.statusCode,result.payload);return true;}
      if(request.method==='POST'&&action==='service'){const data=await body(request);const result=await mutate(request,pathname,201,mutationId=>runtime.publicOrdering.requestService(token,data.requestType,mutationId));json(response,result.statusCode,result.payload);return true;}
      throw new PublicOrderingHttpError(405,'Operacao nao permitida.');
    }catch(error){json(response,statusFor(error),{error:error.message||'Nao foi possivel concluir a operacao.'});return true;}
  };
}

module.exports={createPublicOrderingRouter,PublicOrderingHttpError};
