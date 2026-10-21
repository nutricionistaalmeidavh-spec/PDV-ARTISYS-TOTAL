import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createApi} from '../src/worker.mjs';
import {hashPassword} from '../src/password.mjs';

const origin='https://recipe.test';
async function fixture({omitRecipeMigration=false}={}){
 const db=openLocalDatabase();
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>/^\d{4}.*\.sql$/.test(x)&&(!omitRecipeMigration||!x.startsWith('0037_'))).sort())
  db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const stamp='2026-10-20T12:00:00.000Z',password='Recipe-test-123!';
 const hash=await hashPassword(password);
 for(const tenant of ['a','b']){
  await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind(tenant,'recipe-'+tenant,tenant,stamp).run();
  await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)').bind('branch-'+tenant,tenant,'MAIN','Matriz',stamp).run();
  await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').bind('owner-'+tenant,tenant+'@example.com',tenant,hash,stamp).run();
  await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)').bind(tenant,'owner-'+tenant,'OWNER',stamp).run();
 }
 const api=createApi({DB:db},{now:()=>Date.parse(stamp)}),cookies={};
 async function call(path,method='GET',body,tenant='a',key=crypto.randomUUID()){
  if(!cookies[tenant]){
   const login=await api.fetch(new Request(origin+'/api/v1/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:tenant+'@example.com',password})}));
   assert.equal(login.status,200);cookies[tenant]=login.headers.get('set-cookie').split(';')[0];
  }
  const result=await api.fetch(new Request(origin+'/api/v1/tenants/'+tenant+'/'+path,{method,headers:{cookie:cookies[tenant],origin,'content-type':'application/json','x-mutation-id':key},...(body===undefined?{}:{body:JSON.stringify({branchId:'branch-'+tenant,...body})})}));
  return {status:result.status,body:await result.json()};
 }
 async function product(name,sku,trackStock=true){
  const out=await call('products','POST',{name,sku,trackStock,salePriceCents:1000,unit:trackStock?'KG':'UN'});
  assert.equal(out.status,201,JSON.stringify(out.body));return out.body.product;
 }
 async function sell(productId,quantity){
  await call('cash/open','POST',{openingCents:0});
  const sale=(await call('sales','POST',{})).body.sale;
  assert.equal((await call('sales/'+sale.id+'/items','POST',{productId,quantity})).status,200);
  const key=crypto.randomUUID(),body={payments:[{method:'PIX',amountCents:1000*quantity}]};
  const out=await call('sales/'+sale.id+'/complete','POST',body,'a',key);
  assert.equal(out.status,200,JSON.stringify(out.body));
  assert.equal((await call('sales/'+sale.id+'/complete','POST',body,'a',key)).status,200);
  return sale.id;
 }
 return {db,call,product,sell,close:()=>db.close()};
}

test('pizza options enter Balcão as an authoritative immutable configured line and consume recipe stock once',async()=>{
 const x=await fixture();try{
   const ingredient=await x.product('Ingrediente pizza','PIZZA-INSUMO'),pizza=await x.product('Pizza do Balcão','PIZZA-BALCAO',false);
   await x.call('inventory/receipts','POST',{productId:ingredient.id,quantity:2,unitCostCents:300});
   await x.call('recipes/'+pizza.id,'PUT',{ingredients:[{ingredientId:ingredient.id,quantity:0.2}]});
   const profile={productId:pizza.id,policy:'HIGHEST_FLAVOR',pricingMode:'DESKTOP_DELTAS',maxFlavors:2,
     sizes:[{code:'M',name:'Média',priceCents:500}],flavors:[{code:'C',name:'Calabresa',priceCents:1000}],
     crusts:[{code:'B',name:'Catupiry',priceCents:300}],addons:[{code:'A',name:'Queijo',priceCents:200}]};
   assert.equal((await x.call('restaurant/pizzeria/profiles','POST',profile)).status,201);
   assert.equal((await x.call('recipes/'+pizza.id+'/options/FLAVOR/C','PUT',{ingredients:[{ingredientId:ingredient.id,quantity:0.05}]})).status,200);
   const config=await x.call('products/'+pizza.id+'/configuration?branchId=branch-a');assert.equal(config.status,200);assert.equal(config.body.configuration.pizzaProfile.flavors[0].name,'Calabresa');
   const choices={sizeCode:'M',flavorCodes:['C'],crustCode:'B',addonCodes:['A']};
   const quote=await x.call('products/'+pizza.id+'/configuration/price','POST',{pizza:choices});assert.equal(quote.status,200);assert.equal(quote.body.quote.unitPriceCents,3000);
   const sale=(await x.call('sales','POST',{})).body.sale;
   assert.equal((await x.call('sales/'+sale.id+'/items','POST',{productId:pizza.id,quantity:1})).status,409);
   const key=crypto.randomUUID(),payload={productId:pizza.id,quantity:2,pizza:choices,unitPriceCents:1};
   const added=await x.call('sales/'+sale.id+'/items/configured','POST',payload,'a',key);assert.equal(added.status,200,JSON.stringify(added.body));assert.equal(added.body.sale.totalCents,6000);
   assert.equal((await x.call('sales/'+sale.id+'/items/configured','POST',payload,'a',key)).body.sale.totalCents,6000);
   assert.equal((await x.call('products/'+pizza.id+'/configuration/price','POST',{pizza:{...choices,flavorCodes:['INVALID']}})).status,400);
   await x.call('restaurant/pizzeria/profiles','POST',{...profile,flavors:[{code:'C',name:'Novo nome',priceCents:9000}]});
   await x.call('cash/open','POST',{openingCents:0});
   const finishKey=crypto.randomUUID(),payments={payments:[{method:'PIX',amountCents:6000}]};
   const completed=await x.call('sales/'+sale.id+'/complete','POST',payments,'a',finishKey);assert.equal(completed.status,200,JSON.stringify(completed.body));
   assert.equal((await x.call('sales/'+sale.id+'/complete','POST',payments,'a',finishKey)).status,200);
   const frozen=await x.db.prepare('SELECT configuration_json AS json,unit_price_cents AS price FROM sale_configured_lines WHERE sale_id=?').bind(sale.id).first();
   assert.equal(frozen.price,3000);assert.match(frozen.json,/Calabresa/);assert.doesNotMatch(frozen.json,/Novo nome/);
   const balance=await x.db.prepare('SELECT balance_milli AS n FROM stock_positions WHERE product_id=?').bind(ingredient.id).first();assert.equal(balance.n,1500);
 }finally{x.close();}
});

test('recipe preserves batch yield, unit conversion, loss, preparation, costs and debits one canonical sale',async()=>{
 const x=await fixture();try{
  const flour=await x.product('Farinha','FARINHA'),bread=await x.product('Pão preparado','PAO',false);
  await x.call('inventory/receipts','POST',{productId:flour.id,quantity:2,type:'opening',unitCostCents:300});
  const key=crypto.randomUUID(),input={yieldQuantity:10,yieldUnit:'UN',portionQuantity:1,prepTimeMinutes:30,preparationNotes:'Assar por 20 minutos.',notes:'Receita interna',components:[{productId:flour.id,quantity:500,unit:'G',conversionFactor:0.001,lossPercent:10}]};
  const saved=await x.call('recipes/'+bread.id,'PUT',input,'a',key);
  assert.equal(saved.status,200,JSON.stringify(saved.body));
  assert.equal((await x.call('recipes/'+bread.id,'PUT',input,'a',key)).body.recipe.version,1);
  const read=await x.call('recipes/'+bread.id+'?branchId=branch-a');
  assert.equal(read.body.recipe.yieldQuantity,10);
  assert.equal(read.body.recipe.preparationNotes,input.preparationNotes);
  assert.equal(read.body.recipe.components[0].quantity,500);
  assert.equal(read.body.recipe.components[0].conversionFactor,0.001);
  assert.equal(read.body.recipe.components[0].lossPercent,10);
  assert.equal(read.body.recipe.theoreticalCostCents,165);
  assert.equal(read.body.recipe.costPerPortionCents,17);
  assert.equal(read.body.recipe.capacity,36);
  const saleId=await x.sell(bread.id,3);
  const movements=(await x.db.prepare("SELECT delta_milli FROM inventory_movements WHERE sale_id=? AND type='sale'").bind(saleId).all()).results;
  assert.equal(movements.length,1);assert.equal(movements[0].delta_milli,-165);
  const allocation=await x.db.prepare('SELECT quantity_milli,unit_cost_cents FROM sale_stock_allocations WHERE sale_id=?').bind(saleId).first();
  assert.equal(allocation.quantity_milli,165);assert.equal(allocation.unit_cost_cents,300);
  assert.throws(()=>x.db.exec("UPDATE r4_recipe_details SET yield_quantity=20"),/IMMUTABLE/);
 }finally{x.close();}
});

test('legacy recipe contract remains readable and sellable before and after the additive migration',async()=>{
 const x=await fixture({omitRecipeMigration:true});try{
  const flour=await x.product('Farinha','FARINHA'),bread=await x.product('Pão preparado','PAO',false);
  await x.call('inventory/receipts','POST',{productId:flour.id,quantity:2,type:'opening'});
  const saved=await x.call('recipes/'+bread.id,'PUT',{ingredients:[{ingredientId:flour.id,quantity:0.25}]});
  assert.equal(saved.status,200,JSON.stringify(saved.body));
  const before=await x.call('recipes/'+bread.id+'?branchId=branch-a');
  assert.equal(before.body.recipe.yieldQuantity,1);assert.equal(before.body.recipe.components[0].quantity,0.25);
  x.db.exec(readFileSync(new URL('../migrations/0037_recipe_details.sql',import.meta.url),'utf8'));
  const after=await x.call('recipes/'+bread.id+'?branchId=branch-a');
  assert.equal(after.body.recipe.yieldQuantity,1);assert.equal(after.body.recipe.components[0].quantity,0.25);
  const saleId=await x.sell(bread.id,2);
  assert.equal((await x.db.prepare("SELECT delta_milli FROM inventory_movements WHERE sale_id=? AND type='sale'").bind(saleId).first()).delta_milli,-500);
 }finally{x.close();}
});

test('recipe divides the batch at sale quantity before rounding; revisions and cross-tenant ingredients stay isolated',async()=>{
 const x=await fixture();try{
  const flour=await x.product('Farinha','FARINHA'),bread=await x.product('Pão preparado','PAO',false);
  await x.call('inventory/receipts','POST',{productId:flour.id,quantity:5,type:'opening'});
  const input={yieldQuantity:3,portionQuantity:1,components:[{productId:flour.id,quantity:1,unit:'KG',conversionFactor:1,lossPercent:0}]};
  const first=await x.call('recipes/'+bread.id,'PUT',input);
  assert.equal(first.status,200,JSON.stringify(first.body));
  const saleId=await x.sell(bread.id,3);
  assert.equal((await x.db.prepare("SELECT delta_milli FROM inventory_movements WHERE sale_id=? AND type='sale'").bind(saleId).first()).delta_milli,-1000);
  assert.equal((await x.call('recipes/'+bread.id,'PUT',{...input,yieldQuantity:6})).body.recipe.version,2);
  const snapshot=await x.db.prepare('SELECT version FROM r4_sale_recipe_versions WHERE sale_id=?').bind(saleId).first();assert.equal(snapshot.version,1);
  for(const bad of [{yieldQuantity:0},{portionQuantity:0},{components:[{productId:flour.id,quantity:1,lossPercent:100}]},{components:[{productId:flour.id,quantity:1,conversionFactor:-1}]}])
   assert.equal((await x.call('recipes/'+bread.id,'PUT',{...input,...bad})).status,400);
  assert.equal((await x.call('recipes/'+bread.id+'?branchId=branch-b','GET',undefined,'b')).status,404);
 }finally{x.close();}
});
