import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createApi} from '../src/worker.mjs';
import {hashPassword} from '../src/password.mjs';

const origin='https://pdv-total.test';
const identity=readFileSync(new URL('../migrations/0001_identity.sql',import.meta.url),'utf8');
const commerce=readFileSync(new URL('../migrations/0002_commerce.sql',import.meta.url),'utf8');
const NOW=Date.parse('2026-10-17T14:00:00Z');
const date='2026-10-17T14:00:00.000Z';
const password='SafeTestPasswordForPdv2026!';
let num=0;
const next=()=>('mutation-'+(++num)+'-long');
async function setup(){
  const db=openLocalDatabase();db.exec(identity);db.exec(commerce);
  const pass=await hashPassword(password);
  for(const [id,email] of [['owner','owner@test.com'],['other','other@test.com'],['viewer','viewer@test.com']])
    await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
      .bind(id,email,id,pass,date).run();
  for(const id of ['a','b']){
    await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)')
      .bind(id,'store-'+id,'Store '+id,date).run();
    await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)')
      .bind('branch-'+id,id,'MAIN','Matriz',date).run();
  }
  for(const [tid,uid,role] of [['a','owner','OWNER'],['b','other','OWNER'],['a','viewer','READ_ONLY']])
    await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)')
      .bind(tid,uid,role,date).run();
  const api=createApi({DB:db,AUTH_ENABLED:'true'},{now:()=>NOW});
  async function call(path,{cookie='',body,method='GET',key,originHeader=true}={}){
    const headers={};if(cookie)headers.cookie=cookie;
    if(originHeader&&method!=='GET')headers.origin=origin;
    if(body!==undefined)headers['content-type']='application/json';
    if(key)headers['x-mutation-id']=key;
    const res=await api.fetch(new Request(origin+path,{
      method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})
    }));
    return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]||''};
  }
  const login=async(email)=>call('/api/v1/auth/login',{method:'POST',body:{email,password}});
  const owner=(await login('owner@test.com')).cookie;
  const other=(await login('other@test.com')).cookie;
  const viewer=(await login('viewer@test.com')).cookie;
  const path=(tenant,suffix)=>'/api/v1/tenants/'+tenant+'/'+suffix;
  const write=(tenant,suffix,body,{who=owner,key=next(),method='POST'}={})=>
    call(path(tenant,suffix),{cookie:who,body,method,key});
  const get=(tenant,suffix,who=owner)=>call(path(tenant,suffix),{cookie:who});
  const id=async(name,sku,stock=1)=>{
    const p=await write('a','products',{branchId:'branch-a',name,sku,salePriceCents:1000,trackStock:true});
    assert.equal(p.status,201,p.body.error);
    const r=await write('a','inventory/receipts',{branchId:'branch-a',productId:p.body.product.id,quantity:stock,type:'opening'});
    assert.equal(r.status,201,r.body.error);
    return p.body.product.id;
  };
  return {db,owner,other,viewer,call,write,get,path,id,close:()=>db.close()};
}

test('P3 commerce: tenant isolation, canonical permissions, unique SKU and no ambient data leak',async()=>{
  const x=await setup();try{
    const p=await x.write('a','products',{branchId:'branch-a',name:'Teclado',sku:'T1',salePriceCents:2490,trackStock:true});
    assert.equal(p.status,201,p.body.error);
    const seen=await x.get('a','products?branchId=branch-a');
    assert.deepEqual(seen.body.products.map(p=>p.name),['Teclado']);
    assert.equal((await x.get('b','products?branchId=branch-b',x.other)).body.products.length,0);
    assert.equal((await x.get('a','products?branchId=branch-b')).status,404);
    assert.equal((await x.get('b','products?branchId=branch-b')).status,404);
    assert.equal((await x.write('a','products',{branchId:'branch-a',name:'X',sku:'NO',salePriceCents:123}, {who:x.viewer})).status,403);
    assert.equal((await x.write('a','products',{branchId:'branch-a',name:'Teclado Novo',sku:'T1',salePriceCents:300})).status,409);
    assert.equal((await x.get('a','products?branchId=branch-a',x.viewer)).status,200);
  }finally{x.close();}
});

test('P3 immutable stock ledger: receipt is idempotent and balance is projection',async()=>{
  const x=await setup();try{
    const product=await x.write('a','products',{branchId:'branch-a',name:'Mouse',sku:'M1',salePriceCents:1500});
    const pid=product.body.product.id,key=next();
    const a=await x.write('a','inventory/receipts',{branchId:'branch-a',productId:pid,quantity:2.125},{key});
    assert.equal(a.status,201,a.body.error);
    const b=await x.write('a','inventory/receipts',{branchId:'branch-a',productId:pid,quantity:2.125},{key});
    assert.deepEqual(a.body,b.body);
    const stock=await x.get('a','inventory?branchId=branch-a');
    assert.equal(stock.body.stock[0].quantity,2.125);
    const cnt=await x.db.prepare('SELECT COUNT(*) AS n FROM inventory_movements WHERE product_id=?').bind(pid).first();
    assert.equal(cnt.n,1);
    await assert.rejects(x.db.prepare('DELETE FROM inventory_movements WHERE product_id=?').bind(pid).run(),/IMMUTABLE/);
  }finally{x.close();}
});

test('P3 lifecycle: open cash, open sale, add item exactly once, calculate original totals, pay, ledger once',async()=>{
  const x=await setup();try{
    const pid=await x.id('Cafe','CAFE',4);
    const cash=await x.write('a','cash/open',{branchId:'branch-a',openingCents:5000});
    assert.equal(cash.status,201,cash.body.error);
    const opened=await x.write('a','sales',{branchId:'branch-a'});
    assert.equal(opened.status,201,opened.body.error);
    const sid=opened.body.sale.id;
    const key=next();
    const added=await x.write('a',`sales/${sid}/items`,{branchId:'branch-a',productId:pid,quantity:2},{key});
    assert.equal(added.status,200,added.body.error);
    assert.equal(added.body.sale.totalCents,2000);
    const duplicate=await x.write('a',`sales/${sid}/items`,{branchId:'branch-a',productId:pid,quantity:2},{key});
    assert.equal(duplicate.body.sale.items[0].quantity,2,'retry must not double quantity');
    const completeKey=next();
    const paid=await x.write('a',`sales/${sid}/complete`,{branchId:'branch-a',payments:[{method:'CASH',amountCents:2500}]},{key:completeKey});
    assert.equal(paid.status,200,paid.body.error);
    assert.equal(paid.body.sale.totalCents,2000);
    assert.equal(paid.body.sale.changeCents,500);
    const replay=await x.write('a',`sales/${sid}/complete`,{branchId:'branch-a',payments:[{method:'CASH',amountCents:2500}]},{key:completeKey});
    assert.deepEqual(replay.body,paid.body);
    const changedKey=await x.write('a',`sales/${sid}/complete`,{branchId:'branch-a',payments:[{method:'PIX',amountCents:2000}]});
    assert.equal(changedKey.status,409);
    assert.equal((await x.get('a','inventory?branchId=branch-a')).body.stock[0].quantity,2);
    const stats=await x.db.prepare('SELECT (SELECT COUNT(*) FROM inventory_movements WHERE type=\'sale\') AS s,(SELECT COUNT(*) FROM domain_events WHERE type=\'sale.completed\') AS e,(SELECT COUNT(*) FROM sale_payments) AS p').bind().first();
    assert.deepEqual(stats,{s:1,e:1,p:1});
  }finally{x.close();}
});

test('P3 D1 batch rolls back full sale when two items exceed the last available unit',async()=>{
  const x=await setup();try{
    const a=await x.id('Last item','LAST',1);
    const b=await x.id('Second item','SECOND',1);
    await x.write('a','cash/open',{branchId:'branch-a',openingCents:0});
    const makeSale=async()=>{
      const opened=await x.write('a','sales',{branchId:'branch-a'}),sid=opened.body.sale.id;
      for(const pid of [a,b])assert.equal((await x.write('a',`sales/${sid}/items`,{branchId:'branch-a',productId:pid,quantity:1})).status,200);
      return sid;
    };
    const first=await makeSale(),second=await makeSale();
    assert.equal((await x.write('a',`sales/${first}/complete`,{branchId:'branch-a',payments:[{method:'PIX',amountCents:2000}]})).status,200);
    const result=await x.write('a',`sales/${second}/complete`,{branchId:'branch-a',payments:[{method:'PIX',amountCents:2000}]});
    assert.equal(result.status,409,JSON.stringify(result.body));
    assert.equal((await x.get('a',`sales/${second}?branchId=branch-a`)).body.sale.status,'OPEN');
    assert.equal((await x.get('a','inventory?branchId=branch-a')).body.stock.reduce((s,p)=>s+p.quantity,0),0);
    const total=await x.db.prepare('SELECT COUNT(*) AS n FROM domain_events').bind().first();
    assert.equal(total.n,1,'failed sale must not create a domain event');
    const pay=await x.db.prepare('SELECT COUNT(*) AS n FROM sale_payments').bind().first();
    assert.equal(pay.n,1,'failed sale must not create payments');
  }finally{x.close();}
});

test('P3 commercial mutations reject missing CSRF origin and membership crossing',async()=>{
  const x=await setup();try{
    const p=x.path('a','products');
    const request={branchId:'branch-a',name:'Produto',sku:'PROD',salePriceCents:100};
    assert.equal((await x.call(p,{cookie:x.owner,method:'POST',body:request,originHeader:false,key:next()})).status,403);
    assert.equal((await x.call(p,{cookie:x.other,method:'POST',body:request,key:next()})).status,404);
    assert.equal((await x.call(p,{cookie:x.owner,method:'POST',body:request})).status,400,'missing unique key fails closed');
  }finally{x.close();}
});
