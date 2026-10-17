'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { withTransaction } = require('../../core/database/sqlite-database');
const { writeAudit } = require('../../core/audit-log');

const MIME_EXTENSIONS = Object.freeze({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'});
const MAX_ORIGINAL_BYTES = 8 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 1024 * 1024;

function decodeBase64(value, maxBytes, label) {
  const text=String(value||'').trim();
  if(!text||!/^[A-Za-z0-9+/]+={0,2}$/.test(text))throw new Error(`${label} invalida.`);
  const bytes=Buffer.from(text,'base64');
  if(!bytes.length||bytes.length>maxBytes)throw new Error(`${label} excede o tamanho permitido.`);
  return bytes;
}

function assertImage(bytes,mimeType,label){const png=bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));const jpeg=bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;const webp=bytes.length>=12&&bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP';if((mimeType==='image/png'&&!png)||(mimeType==='image/jpeg'&&!jpeg)||(mimeType==='image/webp'&&!webp))throw new Error(`${label} nao corresponde ao formato informado.`);}

function createProductPhotoService({ db, storageDir = null, now = () => new Date().toISOString() } = {}) {
  if(!db)throw new TypeError('Database is required.');
  const root=storageDir?path.resolve(storageDir):null;
  if(root){fs.mkdirSync(path.join(root,'originals'),{recursive:true});fs.mkdirSync(path.join(root,'thumbnails'),{recursive:true});}

  function map(row){return row?{productId:row.product_id,version:row.version,mimeType:row.mime_type,originalPath:row.original_path,originalSize:row.original_size,originalSha256:row.original_sha256,thumbnailPath:row.thumbnail_path,thumbnailSize:row.thumbnail_size,thumbnailSha256:row.thumbnail_sha256,updatedAt:row.updated_at,deletedAt:row.deleted_at||null}:null;}
  function get(productId,{includeDeleted=false}={}){const row=db.prepare(`SELECT * FROM product_photos WHERE product_id=?${includeDeleted?'':' AND deleted_at IS NULL'}`).get(String(productId));return map(row);}
  function manifest(){return db.prepare('SELECT * FROM product_photos ORDER BY product_id').all().map(map);}
  function requireStorage(){if(!root)throw new Error('Armazenamento de fotos nao configurado neste servidor.');}
  function sha256(bytes){return createHash('sha256').update(bytes).digest('hex');}
  function writeContent(relativePath,bytes){const target=path.resolve(root,relativePath);if(!target.startsWith(`${root}${path.sep}`))throw new Error('Caminho de foto invalido.');if(!fs.existsSync(target)){const temporary=`${target}.${process.pid}.tmp`;fs.writeFileSync(temporary,bytes,{flag:'wx'});try{fs.renameSync(temporary,target);}catch(error){if(fs.existsSync(target))fs.rmSync(temporary,{force:true});else throw error;}}}

  function save(input={},actor={}){
    requireStorage();const productId=String(input.productId||'').trim();if(!db.prepare('SELECT id FROM products WHERE id=?').get(productId))throw new Error('Produto nao encontrado.');
    const mimeType=String(input.mimeType||'').toLowerCase();const extension=MIME_EXTENSIONS[mimeType];if(!extension)throw new Error('Formato de foto nao suportado. Use PNG, JPEG ou WebP.');
    const original=decodeBase64(input.originalBase64,MAX_ORIGINAL_BYTES,'Foto original');const thumbnail=decodeBase64(input.thumbnailBase64,MAX_THUMBNAIL_BYTES,'Miniatura');
    assertImage(original,mimeType,'Foto original');assertImage(thumbnail,'image/png','Miniatura');
    const originalHash=sha256(original);const thumbnailHash=sha256(thumbnail);const originalPath=`originals/${originalHash}.${extension}`;const thumbnailPath=`thumbnails/${thumbnailHash}.png`;
    writeContent(originalPath,original);writeContent(thumbnailPath,thumbnail);
    return withTransaction(db,()=>{const previous=get(productId,{includeDeleted:true});const version=Number(previous?.version||0)+1;const timestamp=now();db.prepare(`INSERT INTO product_photos(product_id,version,mime_type,original_path,original_size,original_sha256,thumbnail_path,thumbnail_size,thumbnail_sha256,updated_at,deleted_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,NULL) ON CONFLICT(product_id) DO UPDATE SET version=excluded.version,mime_type=excluded.mime_type,original_path=excluded.original_path,original_size=excluded.original_size,original_sha256=excluded.original_sha256,thumbnail_path=excluded.thumbnail_path,thumbnail_size=excluded.thumbnail_size,thumbnail_sha256=excluded.thumbnail_sha256,updated_at=excluded.updated_at,deleted_at=NULL`)
      .run(productId,version,mimeType,originalPath,original.length,originalHash,thumbnailPath,thumbnail.length,thumbnailHash,timestamp);writeAudit(db,{action:'product.photo.upsert',entity:'product',entityId:productId,actor,context:{version,mimeType,originalSize:original.length,thumbnailSize:thumbnail.length,originalSha256:originalHash,thumbnailSha256:thumbnailHash}},now);return get(productId);});
  }

  function remove(productId,actor={}){const current=get(productId,{includeDeleted:true});if(!current||current.deletedAt)return current;const timestamp=now();db.prepare('UPDATE product_photos SET version=version+1,deleted_at=?,updated_at=? WHERE product_id=?').run(timestamp,timestamp,String(productId));writeAudit(db,{action:'product.photo.delete',entity:'product',entityId:String(productId),actor,context:{retainedUntil:new Date(Date.parse(timestamp)+30*86400000).toISOString()}},now);return get(productId,{includeDeleted:true});}

  function read(productId,variant='thumbnail'){
    requireStorage();const photo=get(productId);if(!photo)throw new Error('Foto do produto nao encontrada.');const original=variant==='original';if(!original&&variant!=='thumbnail')throw new Error('Variacao de foto invalida.');const relativePath=original?photo.originalPath:photo.thumbnailPath;const target=path.resolve(root,relativePath);if(!target.startsWith(`${root}${path.sep}`)||!fs.existsSync(target))throw new Error('Arquivo da foto nao encontrado.');return{bytes:fs.readFileSync(target),mimeType:original?photo.mimeType:'image/png',sha256:original?photo.originalSha256:photo.thumbnailSha256,size:original?photo.originalSize:photo.thumbnailSize,version:photo.version};
  }

  function cleanupExpired({retentionDays=30}={}){
    if(!root)return{removedRecords:0,removedFiles:0};const cutoff=new Date(Date.parse(now())-Number(retentionDays)*86400000).toISOString();const expired=db.prepare('SELECT * FROM product_photos WHERE deleted_at IS NOT NULL AND deleted_at<=?').all(cutoff);let removedFiles=0;
    return withTransaction(db,()=>{for(const row of expired){for(const relativePath of [row.original_path,row.thumbnail_path]){const referenced=db.prepare('SELECT 1 FROM product_photos WHERE product_id<>? AND (original_path=? OR thumbnail_path=?) LIMIT 1').get(row.product_id,relativePath,relativePath);const target=path.resolve(root,relativePath);if(!referenced&&target.startsWith(`${root}${path.sep}`)&&fs.existsSync(target)){fs.rmSync(target);removedFiles+=1;}}db.prepare('DELETE FROM product_photos WHERE product_id=?').run(row.product_id);}return{removedRecords:expired.length,removedFiles};});
  }

  return{get,manifest,save,remove,read,cleanupExpired};
}

module.exports={createProductPhotoService,decodeBase64,assertImage,MIME_EXTENSIONS,MAX_ORIGINAL_BYTES,MAX_THUMBNAIL_BYTES};
