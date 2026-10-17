// Private, tenant-authorized product media. Not a second product catalogue.
// Cloudflare uses the optional FILES R2 binding; self-hosted SQLite uses BLOB.
import canonicalAuthorization from '../../../packages/core/js/core/auth/authorization-service.js';
import canonicalProfiles from '../../../packages/core/js/core/auth/default-profiles.js';
const {createAuthorizationService}=canonicalAuthorization;
const {DEFAULT_PROFILE_PERMISSIONS}=canonicalProfiles;
const json=(data,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store',
  'x-content-type-options':'nosniff'}
});
const fail=(status,message)=>json({error:message},status);
const supported=new Set(['image/png','image/jpeg','image/webp']);
const MAX_BYTES=2097152;
function validatedImage(bytes,mime){
 if(bytes.length<32||bytes.length>MAX_BYTES)return false;
 if(mime==='image/png')return [137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b);
 if(mime==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 return mime==='image/webp'&&
   [82,73,70,70].every((b,i)=>bytes[i]===b)&&
   [87,69,66,80].every((b,i)=>bytes[i+8]===b);
}
function allowed(member,userId,capability){
 const role=member.profileKey==='OWNER'?'ADMINISTRATOR':member.profileKey;
 return createAuthorizationService({
  resolvePermissions:()=>DEFAULT_PROFILE_PERMISSIONS[role]||[]
 }).can({principal:{kind:'human',id:userId},capability});
}
const err=(status,message)=>Object.assign(new Error(message),{status});
const randomId=()=>crypto.randomUUID();
const bytesToHash=bytes=>crypto.subtle.digest('SHA-256',bytes).then(buffer=>
 Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,'0')).join(''));
export async function productMediaRoute(request,db,files,localEnabled,session,member,tenant,path){
 const match=path.match(/^products\/([^/]{1,128})\/photo$/);
 if(!match)return null;
 const id=decodeURIComponent(match[1]),method=request.method;
 if(!['GET','PUT','DELETE'].includes(method))return fail(405,'Método não permitido.');
 if(!allowed(member,session.userId,method==='GET'?'products.view':'products.manage'))
  return fail(403,'Permissão insuficiente.');
 const url=new URL(request.url),branch=url.searchParams.get('branchId')||'';
 try{
  const q=(sql,...args)=>db.prepare(sql).bind(...args);
  if(!branch||!(await q('SELECT id FROM branches WHERE tenant_id=? AND id=? AND active=1',tenant,branch).first()))
   throw err(404,'Filial não encontrada nesta empresa.');
  if(!(await q('SELECT id FROM products WHERE tenant_id=? AND id=?',tenant,id).first()))
   throw err(404,'Produto não encontrado nesta empresa.');
  const current=await q('SELECT * FROM product_media WHERE tenant_id=? AND product_id=?',tenant,id).first();
  if(method==='GET'){
    if(!current)return fail(404,'Produto sem foto.');
    let bytes;
    if(current.storage==='R2'){
      if(!files?.get)return fail(503,'Armazenamento privado R2 indisponível.');
      const object=await files.get(current.object_key);
      if(!object)return fail(503,'Foto indisponível no armazenamento privado.');
      bytes=new Uint8Array(await object.arrayBuffer());
    }else{
      if(!localEnabled)return fail(503,'Fotos locais desabilitadas neste ambiente.');
      bytes=new Uint8Array(current.data_blob);
    }
    return new Response(bytes,{
      status:200,headers:{
        'content-type':current.content_type,
        'cache-control':'private, no-store','x-content-type-options':'nosniff',
        'content-length':String(bytes.length)
      }
    });
  }
  const mutationId=request.headers.get('x-mutation-id')||'';
  if(!/^[a-zA-Z0-9_-]{8,100}$/.test(mutationId))return fail(400,'Identificador da alteração obrigatório.');
  const scope='product.photo:'+branch+':'+id+':'+method.toLowerCase();
  const previous=await q('SELECT result_json FROM commerce_mutations WHERE tenant_id=? AND scope=? AND mutation_id=?',tenant,scope,mutationId).first();
  if(previous)return json(JSON.parse(previous.result_json));
  if(method==='DELETE'){
    if(!current)return fail(404,'Produto sem foto.');
    const result={productId:id,deleted:true};
    await db.batch([
      q('DELETE FROM product_media WHERE tenant_id=? AND product_id=?',tenant,id),
      q('INSERT INTO commerce_mutations(tenant_id,scope,mutation_id,result_json,occurred_at) VALUES(?,?,?,?,?)',
        tenant,scope,mutationId,JSON.stringify(result),new Date().toISOString())
    ]);
    if(current.storage==='R2'&&files?.delete){
      try{await files.delete(current.object_key);}catch{/* private orphan needs periodic cleanup */}
    }
    return json(result);
  }
  if(!files?.put&&localEnabled!==true)return fail(503,'Armazenamento R2 ainda não configurado.');
  const mime=(request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(!supported.has(mime))return fail(415,'Aceitas apenas imagens JPEG, PNG ou WebP.');
  const declared=Number(request.headers.get('content-length')||0);
  if(declared>MAX_BYTES)return fail(413,'A imagem deve ter no máximo 2 MB.');
  const ab=await request.arrayBuffer();
  const bytes=new Uint8Array(ab);
  if(bytes.length>MAX_BYTES)return fail(413,'A imagem deve ter no máximo 2 MB.');
  if(!validatedImage(bytes,mime))return fail(415,'Formato ou assinatura da imagem inválidos.');
  const hash=await bytesToHash(bytes);
  const at=new Date().toISOString(),storage=files?.put?'R2':'LOCAL';
  const key=storage==='R2'
    ?'tenants/'+encodeURIComponent(tenant)+'/products/'+encodeURIComponent(id)+'/'+randomId()+
      ({'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'}[mime])
    :null;
  const result={productId:id,mime,byteSize:bytes.length,sha256:hash,stored:true,storage};
  if(key)await files.put(key,bytes,{httpMetadata:{contentType:mime}});
  try{
    await db.batch([
      q(`INSERT INTO product_media
        (tenant_id,product_id,storage,object_key,data_blob,content_type,byte_size,sha256,updated_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(tenant_id,product_id) DO UPDATE SET
        storage=excluded.storage,object_key=excluded.object_key,data_blob=excluded.data_blob,
        content_type=excluded.content_type,byte_size=excluded.byte_size,sha256=excluded.sha256,
        updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
        tenant,id,storage,key,storage==='LOCAL'?bytes:null,mime,bytes.length,hash,
        session.userId,current?.created_at||at,at),
      q('INSERT INTO commerce_mutations(tenant_id,scope,mutation_id,result_json,occurred_at) VALUES(?,?,?,?,?)',
        tenant,scope,mutationId,JSON.stringify(result),at)
    ]);
  }catch(e){
    if(key&&files?.delete)try{await files.delete(key);}catch{/* private orphan */}
    throw e;
  }
  if(current?.storage==='R2'&&current.object_key&&files?.delete){
    try{await files.delete(current.object_key);}catch{/* private orphan needs cleanup */}
  }
  return json(result,201);
 }catch(e){
  if(e?.status)return fail(e.status,e.message);
  if(/UNIQUE constraint|constraint failed/i.test(String(e?.message||e)))return fail(409,'Foto alterada por outro terminal.');
  return fail(500,'Não foi possível confirmar a foto. Verifique a conexão.');
 }
}
