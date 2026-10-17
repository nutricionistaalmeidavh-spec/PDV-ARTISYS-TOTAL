import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createApi} from '../src/worker.mjs';
import {createCommerceService} from '../src/commerce.mjs';
import {hashPassword} from '../src/password.mjs';

const origin='https://pdv-photos.test';
const password='StrongPhotoPassword2026!';
const stamp='2026-10-17T20:00:00.000Z';
const png=Uint8Array.from(Buffer.from(
 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9cxdUAAAAASUVORK5CYII=','base64'));
let n=0;const key=()=> 'photo-operation-'+(++n);
function fakeR2(){
 const objects=new Map();
 return {objects,async put(k,bytes){objects.set(k,new Uint8Array(bytes));return {key:k};},
   async get(k){const bytes=objects.get(k);return bytes?{arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}:null;},
   async delete(k){objects.delete(k);}};
}
async function setup({r2=null,local=true}={}){
 const db=openLocalDatabase();
 for(const file of ['0001_identity.sql','0002_commerce.sql','0003_cash_finance.sql',
  '0004_advanced_finance.sql','0005_vertical_parity.sql','0006_desktop_parity.sql',
  '0007_stock_transfers.sql','0008_transaction_reversals.sql',
  '0009_catalog_inventory.sql','0010_purchase_orders.sql','0011_product_media.sql','0012_sale_item_notes.sql','0013_cash_terminals.sql','0014_checkout_configurations.sql','0014_checkout_configurations.sql'])
  db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const hash=await hashPassword(password);
 for(const [id,email] of [['owner','owner@example.test'],['viewer','viewer@example.test'],['stranger','stranger@example.test']])
  await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
   .bind(id,email,id,hash,stamp).run();
 for(const [t,b] of [['a','x'],['b','y']]){
  await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind(t,'shop-'+t,t,stamp).run();
  await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)').bind(b,t,'M','Main',stamp).run();
 }
 for(const [t,u,role] of [['a','owner','OWNER'],['a','viewer','READ_ONLY'],['b','stranger','OWNER']])
  await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)').bind(t,u,role,stamp).run();
 const product=await createCommerceService(db).createProduct('a','owner',{sku:'PHOTO-1',name:'Product photo',salePriceCents:1000},key());
 const api=createApi({DB:db,AUTH_ENABLED:'true',...(local?{LOCAL_MEDIA_ENABLED:'true'}:{}),...(r2?{FILES:r2}:{})},
  {now:()=>Date.parse(stamp)});
 async function login(email){
  const r=await api.fetch(new Request(origin+'/api/v1/auth/login',{
   method:'POST',headers:{origin,'content-type':'application/json'},
   body:JSON.stringify({email,password})}));
  assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];
 }
 const cookies={owner:await login('owner@example.test'),viewer:await login('viewer@example.test'),
  stranger:await login('stranger@example.test')};
 async function photo(who,method='GET',bytes=null,{tenant='a',branch='x',type='image/png',operation=key()}={}){
  const url=origin+'/api/v1/tenants/'+tenant+'/products/'+product.id+'/photo?branchId='+branch;
  const headers={};
  if(who)headers.cookie=cookies[who];
  if(!['GET','HEAD'].includes(method)){headers.origin=origin;headers['x-mutation-id']=operation;}
  if(bytes)headers['content-type']=type;
  return api.fetch(new Request(url,{method,headers,...(bytes?{body:bytes}:{})}));
 }
 const scalar=async(sql,...args)=>(await db.prepare(sql).bind(...args).first()).n;
 return {db,product,cookies,api,photo,scalar,close:()=>db.close()};
}
test('P2 photos: local self-hosted fallback stores one private image in SQLite, owner can replace and viewer only reads',async()=>{
 const x=await setup();try{
  const put=await x.photo('owner','PUT',png);
  assert.equal(put.status,201,await put.text());
  const metadata=await x.db.prepare('SELECT storage,content_type AS mime,byte_size AS bytes FROM product_media WHERE product_id=?').bind(x.product.id).first();
  assert.equal(metadata.storage,'LOCAL');
  assert.equal(metadata.mime,'image/png');
  assert.equal(metadata.bytes,png.byteLength);
  const get=await x.photo('viewer');
  assert.equal(get.status,200);
  assert.equal(get.headers.get('content-type'),'image/png');
  assert.equal(get.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(new Uint8Array(await get.arrayBuffer()),png);
  assert.equal((await x.photo('viewer','PUT',png)).status,403);
  assert.equal((await x.photo(null)).status,401);
  assert.equal((await x.photo('stranger')).status,404);
  const clear=await x.photo('owner','DELETE');
  assert.equal(clear.status,200,await clear.text());
  assert.equal((await x.photo('viewer')).status,404);
  assert.equal(await x.scalar('SELECT COUNT(*) AS n FROM product_media'),0);
 }finally{x.close();}
});
test('P2 photos: R2 stores tenant-scoped private keys, never stores binary in D1, replacement removes old key',async()=>{
 const bucket=fakeR2(),x=await setup({r2:bucket,local:false});try{
  let r=await x.photo('owner','PUT',png);
  assert.equal(r.status,201,await r.text());
  const first=await x.db.prepare('SELECT storage,object_key AS k,data_blob AS raw FROM product_media WHERE product_id=?').bind(x.product.id).first();
  assert.equal(first.storage,'R2');
  assert.match(first.k,/^tenants\/a\/products\//);
  assert.equal(first.raw,null);
  assert.equal(bucket.objects.size,1);
  r=await x.photo('owner','PUT',png);
  assert.equal(r.status,201,await r.text());
  const next=await x.db.prepare('SELECT object_key AS k FROM product_media WHERE product_id=?').bind(x.product.id).first();
  assert.notEqual(next.k,first.k);
  assert.equal(bucket.objects.has(first.k),false);
  assert.equal(bucket.objects.size,1);
  const read=await x.photo('viewer');
  assert.equal(read.status,200);
  assert.deepEqual(new Uint8Array(await read.arrayBuffer()),png);
  await x.photo('owner','DELETE');
  assert.equal(bucket.objects.size,0);
 }finally{x.close();}
});
test('P2 photos: reject mismatched type, non-image and unavailable production R2 without writing metadata',async()=>{
 const x=await setup({local:false});try{
  assert.equal((await x.photo('owner','PUT',png)).status,503);
  const y=await setup();try{
   assert.equal((await y.photo('owner','PUT',png,{type:'image/jpeg'})).status,415);
   assert.equal((await y.photo('owner','PUT',Uint8Array.from([1,2,3,4,5,6,7,8]),{type:'image/png'})).status,415);
   assert.equal(await y.scalar('SELECT COUNT(*) AS n FROM product_media'),0);
  }finally{y.close();}
 }finally{x.close();}
});
