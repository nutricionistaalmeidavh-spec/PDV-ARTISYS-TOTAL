'use strict';

const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');

const MIME_BY_EXTENSION=Object.freeze({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'});
const QA_PRODUCT_PHOTO_BASE64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
function dayKey(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}

function createProductPhotoClient({cacheDir,fetchImpl=fetch,getApiBase,getTerminalHeaders=()=>({}),now=()=>new Date(),fsImpl=fs,pathImpl=path}={}){
  if(!cacheDir||typeof getApiBase!=='function')throw new TypeError('cacheDir and getApiBase are required.');
  const root=pathImpl.resolve(cacheDir);const statePath=pathImpl.join(root,'manifest.json');fsImpl.mkdirSync(root,{recursive:true});
  let running=false;let runtimeStatus={running:false,pending:0,failed:0,lastCompletedAt:null,lastError:null};
  function readState(){try{const value=JSON.parse(fsImpl.readFileSync(statePath,'utf8'));return value&&typeof value==='object'?value:{photos:{}};}catch{return{photos:{}};}}
  function writeState(value){const temporary=`${statePath}.tmp`;fsImpl.writeFileSync(temporary,`${JSON.stringify(value,null,2)}\n`);fsImpl.renameSync(temporary,statePath);}
  function headers(sessionToken,extra={}){return{authorization:`Bearer ${String(sessionToken||'')}`,...getTerminalHeaders(),...extra};}
  async function requestJson(resource,sessionToken,options={}){const response=await fetchImpl(`${getApiBase()}${resource}`,{...options,headers:headers(sessionToken,{'content-type':'application/json',...(options.headers||{})})});const text=await response.text();const payload=text?JSON.parse(text):null;if(!response.ok)throw new Error(payload?.error||`Erro HTTP ${response.status}`);return payload;}
  function cachePath(hash,variant){if(!/^[a-f0-9]{64}$/.test(String(hash||'')))throw new Error('Hash de foto invalido.');return pathImpl.join(root,`${hash}.${variant}`);}
  async function download(photo,variant,sessionToken){const hash=variant==='original'?photo.originalSha256:photo.thumbnailSha256;const target=cachePath(hash,variant);if(fsImpl.existsSync(target))return target;const response=await fetchImpl(`${getApiBase()}/api/v1/product-photos/${encodeURIComponent(photo.productId)}/${variant}`,{headers:headers(sessionToken)});if(!response.ok)throw new Error(`Falha ao baixar foto (${response.status}).`);const bytes=Buffer.from(await response.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error('Foto recebida com hash divergente.');const temporary=`${target}.${process.pid}.part`;fsImpl.writeFileSync(temporary,bytes);fsImpl.renameSync(temporary,target);return target;}
  async function performSync(sessionToken){const manifest=await requestJson('/api/v1/product-photos/manifest',sessionToken);const state=readState();state.photos=state.photos||{};const active=manifest.filter(photo=>!photo.deletedAt);const missing=new Set(active.filter(photo=>!fsImpl.existsSync(cachePath(photo.thumbnailSha256,'thumbnail'))).map(photo=>photo.productId));runtimeStatus.pending=missing.size;runtimeStatus.failed=0;
    for(const photo of manifest){state.photos[photo.productId]=photo;if(photo.deletedAt||!missing.has(photo.productId))continue;try{await download(photo,'thumbnail',sessionToken);}catch(error){runtimeStatus.failed+=1;runtimeStatus.lastError=error.message;}finally{runtimeStatus.pending=Math.max(runtimeStatus.pending-1,0);}}
    state.lastAttemptAt=now().toISOString();if(runtimeStatus.failed===0){runtimeStatus.lastCompletedAt=state.lastAttemptAt;state.lastCompletedAt=runtimeStatus.lastCompletedAt;}writeState(state);
  }
  function startSync(sessionToken,{force=false}={}){const state=readState();if(running)return{...runtimeStatus};if(!force&&state.lastCompletedAt&&dayKey(new Date(state.lastCompletedAt))===dayKey(now()))return{...runtimeStatus,lastCompletedAt:state.lastCompletedAt};running=true;runtimeStatus={...runtimeStatus,running:true,lastError:null};Promise.resolve().then(()=>performSync(sessionToken)).catch(error=>{runtimeStatus.lastError=error.message;runtimeStatus.failed+=1;}).finally(()=>{running=false;runtimeStatus.running=false;});return{...runtimeStatus};}
  function status(){const state=readState();return{...runtimeStatus,running,lastCompletedAt:runtimeStatus.lastCompletedAt||state.lastCompletedAt||null};}
  async function dataUrl(productId,sessionToken,{variant='thumbnail'}={}){let state=readState();let photo=state.photos?.[productId];if(!photo){const manifest=await requestJson('/api/v1/product-photos/manifest',sessionToken);state.photos=Object.fromEntries(manifest.map(item=>[item.productId,item]));writeState(state);photo=state.photos[productId];}if(!photo||photo.deletedAt)return null;const target=await download(photo,variant,sessionToken);const mime=variant==='original'?photo.mimeType:'image/png';return`data:${mime};base64,${fsImpl.readFileSync(target).toString('base64')}`;}
  async function upload({productId,filePath,sessionToken,thumbnailBytes}){const mimeType=MIME_BY_EXTENSION[pathImpl.extname(filePath).toLowerCase()];if(!mimeType)throw new Error('Use uma foto PNG, JPEG ou WebP.');const original=fsImpl.readFileSync(filePath);if(original.length>8*1024*1024)throw new Error('A foto deve possuir no maximo 8 MB.');const photo=await requestJson(`/api/v1/product-photos/${encodeURIComponent(productId)}`,sessionToken,{method:'POST',body:JSON.stringify({mimeType,originalBase64:original.toString('base64'),thumbnailBase64:Buffer.from(thumbnailBytes).toString('base64')})});const state=readState();state.photos=state.photos||{};state.photos[productId]=photo;writeState(state);fsImpl.writeFileSync(cachePath(photo.originalSha256,'original'),original);fsImpl.writeFileSync(cachePath(photo.thumbnailSha256,'thumbnail'),Buffer.from(thumbnailBytes));return photo;}
  async function remove(productId,sessionToken){const photo=await requestJson(`/api/v1/product-photos/${encodeURIComponent(productId)}`,sessionToken,{method:'DELETE',body:'{}'});const state=readState();state.photos=state.photos||{};state.photos[productId]=photo;writeState(state);return photo;}
  return{startSync,status,dataUrl,upload,remove};
}

function resolveQaProductPhotoFixture(qaFixturePath){
  if(qaFixturePath)return String(qaFixturePath);
  if(process.env.ARTISYS_QA!=='1')return '';
  const qaProductPhotoFixture=path.join(os.tmpdir(),`artisys-pdv-qa-product-photo-${process.pid}.png`);
  if(!fs.existsSync(qaProductPhotoFixture))fs.writeFileSync(qaProductPhotoFixture,Buffer.from(QA_PRODUCT_PHOTO_BASE64,'base64'));
  return qaProductPhotoFixture;
}

function registerProductPhotoIpc({ipcMain,dialog,nativeImage,client,isTrustedSender=()=>true,getParentWindow=()=>null,qaFixturePath=null}={}){
  const handle=(channel,fn)=>ipcMain.handle(channel,async(event,input={})=>{if(!isTrustedSender(event))throw new Error('Origem IPC nao autorizada.');return fn(input);});
  handle('artisys:photos:sync',input=>client.startSync(input.sessionToken,{force:Boolean(input.force)}));
  handle('artisys:photos:status',()=>client.status());
  handle('artisys:photos:data-url',input=>client.dataUrl(String(input.productId),input.sessionToken,{variant:input.variant||'thumbnail'}));
  handle('artisys:photos:remove',input=>client.remove(String(input.productId),input.sessionToken));
  handle('artisys:photos:pick-upload',async input=>{
    let filePath=resolveQaProductPhotoFixture(qaFixturePath);
    if(!filePath){
      const result=await dialog.showOpenDialog(getParentWindow(),{title:'Selecionar foto do produto',properties:['openFile'],filters:[{name:'Imagens',extensions:['png','jpg','jpeg','webp']}]});
      if(result.canceled||!result.filePaths[0])return null;
      filePath=result.filePaths[0];
    }
    const image=nativeImage.createFromPath(filePath);
    if(image.isEmpty())throw new Error('Nao foi possivel ler a foto selecionada.');
    const size=image.getSize();const width=Math.min(320,size.width);const thumbnail=image.resize({width,quality:'good'}).toPNG();
    return client.upload({productId:String(input.productId),filePath,sessionToken:input.sessionToken,thumbnailBytes:thumbnail});
  });
}

module.exports={createProductPhotoClient,registerProductPhotoIpc,resolveQaProductPhotoFixture,dayKey,MIME_BY_EXTENSION};
