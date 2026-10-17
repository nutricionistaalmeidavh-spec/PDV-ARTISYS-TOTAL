'use strict';

const { randomUUID }=require('node:crypto');
const { assertCents }=require('../shared/money');
const { writeAudit }=require('../../core/audit-log');
const { roundQuantity }=require('../inventory/inventory-rules');

function createPizzeriaService({db,modules,catalogCustomization=null,recipes=null,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db||!modules)throw new TypeError('db and modules are required.');
  const gate=()=>modules.requireEnabled('FOOD');
  function product(id){const row=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(String(id));if(!row)throw new Error('Produto de pizza nao encontrado ou inativo.');return row;}
  function recipeProduct(id,label){
    if(id==null||String(id).trim()==='')return null;
    const row=product(String(id));
    if(recipes&&!recipes.getRecipe(row.id))throw new Error(`${label} deve apontar para um produto com ficha tecnica ativa.`);
    return row.id;
  }
  function upsertProfile(input={},actor={}){gate();const p=product(input.productId);const policy=String(input.pricingPolicy||'HIGHEST_FLAVOR').toUpperCase();if(!['HIGHEST_FLAVOR','PROPORTIONAL_AVERAGE'].includes(policy))throw new Error('Politica de preco da pizza invalida.');const ts=now();db.prepare(`INSERT INTO pizza_profiles(product_id,pricing_policy,active,created_at,updated_at) VALUES(?,?,1,?,?) ON CONFLICT(product_id) DO UPDATE SET pricing_policy=excluded.pricing_policy,active=1,updated_at=excluded.updated_at`).run(p.id,policy,ts,ts);writeAudit(db,{action:'pizzeria.profile.upsert',entity:'pizza-profile',entityId:p.id,actor,context:{pricingPolicy:policy}},now);return{productId:p.id,pricingPolicy:policy,active:true};}
  function upsertSize(input={},actor={}){gate();const p=product(input.productId);const id=String(input.id||idFactory('pizza-size'));const name=String(input.name||'').trim();if(!name)throw new Error('Nome do tamanho obrigatorio.');const maxFlavors=Number(input.maxFlavors??1);if(!Number.isInteger(maxFlavors)||maxFlavors<1||maxFlavors>8)throw new Error('Maximo de sabores invalido.');const delta=assertCents(Number(input.priceDeltaCents??0),'priceDeltaCents');const consumptionMultiplier=Number(input.consumptionMultiplier??1);if(!Number.isFinite(consumptionMultiplier)||consumptionMultiplier<=0||consumptionMultiplier>20)throw new Error('Fator de consumo do tamanho invalido.');const ts=now();db.prepare(`INSERT INTO pizza_sizes(id,product_id,name,max_flavors,price_delta_cents,active,created_at,updated_at,consumption_multiplier) VALUES(?,?,?,?,?,1,?,?,?) ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,name=excluded.name,max_flavors=excluded.max_flavors,price_delta_cents=excluded.price_delta_cents,active=1,updated_at=excluded.updated_at,consumption_multiplier=excluded.consumption_multiplier`).run(id,p.id,name,maxFlavors,delta,ts,ts,consumptionMultiplier);writeAudit(db,{action:'pizzeria.size.upsert',entity:'pizza-size',entityId:id,actor,context:{productId:p.id,name,maxFlavors,priceDeltaCents:delta,consumptionMultiplier}},now);return{id,productId:p.id,name,maxFlavors,priceDeltaCents:delta,consumptionMultiplier};}
  function upsertFlavor(input={},actor={}){gate();const p=product(input.productId);const id=String(input.id||idFactory('pizza-flavor'));const name=String(input.name||'').trim();if(!name)throw new Error('Nome do sabor obrigatorio.');const delta=assertCents(Number(input.priceDeltaCents??0),'priceDeltaCents');const recipeProductId=recipeProduct(input.recipeProductId,'Ficha tecnica do sabor');const ts=now();db.prepare(`INSERT INTO pizza_flavors(id,product_id,name,price_delta_cents,active,created_at,updated_at,recipe_product_id) VALUES(?,?,?,?,1,?,?,?) ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,name=excluded.name,price_delta_cents=excluded.price_delta_cents,active=1,updated_at=excluded.updated_at,recipe_product_id=excluded.recipe_product_id`).run(id,p.id,name,delta,ts,ts,recipeProductId);writeAudit(db,{action:'pizzeria.flavor.upsert',entity:'pizza-flavor',entityId:id,actor,context:{productId:p.id,name,priceDeltaCents:delta,recipeProductId}},now);return{id,productId:p.id,name,priceDeltaCents:delta,recipeProductId};}
  function upsertCrust(input={},actor={}){gate();const p=product(input.productId);const id=String(input.id||idFactory('pizza-crust'));const name=String(input.name||'').trim();if(!name)throw new Error('Nome da borda obrigatorio.');const delta=assertCents(Number(input.priceDeltaCents??0),'priceDeltaCents');const recipeProductId=recipeProduct(input.recipeProductId,'Ficha tecnica da borda');const ts=now();db.prepare(`INSERT INTO pizza_crusts(id,product_id,name,price_delta_cents,active,created_at,updated_at,recipe_product_id) VALUES(?,?,?,?,1,?,?,?) ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,name=excluded.name,price_delta_cents=excluded.price_delta_cents,active=1,updated_at=excluded.updated_at,recipe_product_id=excluded.recipe_product_id`).run(id,p.id,name,delta,ts,ts,recipeProductId);writeAudit(db,{action:'pizzeria.crust.upsert',entity:'pizza-crust',entityId:id,actor,context:{productId:p.id,name,priceDeltaCents:delta,recipeProductId}},now);return{id,productId:p.id,name,priceDeltaCents:delta,recipeProductId};}
  function getProfile(productId){gate();const p=product(productId);const profile=db.prepare('SELECT * FROM pizza_profiles WHERE product_id=? AND active=1').get(p.id);if(!profile)return null;return{productId:p.id,pricingPolicy:profile.pricing_policy,sizes:db.prepare('SELECT id,name,max_flavors AS maxFlavors,price_delta_cents AS priceDeltaCents,consumption_multiplier AS consumptionMultiplier FROM pizza_sizes WHERE product_id=? AND active=1 ORDER BY name,id').all(p.id),flavors:db.prepare('SELECT id,name,price_delta_cents AS priceDeltaCents,recipe_product_id AS recipeProductId FROM pizza_flavors WHERE product_id=? AND active=1 ORDER BY name,id').all(p.id),crusts:db.prepare('SELECT id,name,price_delta_cents AS priceDeltaCents,recipe_product_id AS recipeProductId FROM pizza_crusts WHERE product_id=? AND active=1 ORDER BY name,id').all(p.id)};}

  function stockItemsFor({productId,size,flavors,crust}){
    if(!recipes)return[];
    const totals=new Map();
    const add=(recipeProductId,quantity)=>{
      if(!recipeProductId||quantity<=0||!recipes.getRecipe(recipeProductId))return;
      for(const item of recipes.expandItems([{productId:recipeProductId,quantity}])||[]){
        const id=String(item.productId||'');const value=roundQuantity(Number(item.quantity||0));
        if(id&&value>0)totals.set(id,roundQuantity((totals.get(id)||0)+value));
      }
    };
    const multiplier=Number(size.consumption_multiplier||1);
    add(productId,multiplier);
    for(const flavor of flavors)add(flavor.recipeProductId,multiplier*Number(flavor.fraction||0));
    if(crust?.recipeProductId)add(crust.recipeProductId,multiplier);
    return[...totals].sort(([a],[b])=>a.localeCompare(b)).map(([id,quantity])=>({productId:id,quantity}));
  }

  function pricePizza(input={}){
    gate();const p=product(input.productId);const profile=getProfile(p.id);if(!profile)throw new Error('Perfil de pizzaria nao configurado para o produto.');
    const size=db.prepare('SELECT * FROM pizza_sizes WHERE id=? AND product_id=? AND active=1').get(String(input.sizeId||''),p.id);if(!size)throw new Error('Tamanho de pizza invalido.');
    const ids=(input.flavorIds||[]).map(String);if(!ids.length)throw new Error('Selecione ao menos um sabor.');if(ids.length>size.max_flavors)throw new Error(`Tamanho permite no maximo ${size.max_flavors} sabores.`);
    if(new Set(ids).size!==ids.length)throw new Error('Selecione sabores diferentes para dividir a pizza.');
    const flavors=ids.map(id=>{const row=db.prepare('SELECT * FROM pizza_flavors WHERE id=? AND product_id=? AND active=1').get(id,p.id);if(!row)throw new Error(`Sabor de pizza invalido: ${id}.`);return{id:row.id,name:row.name,priceDeltaCents:row.price_delta_cents,recipeProductId:row.recipe_product_id||null,fraction:1/ids.length};});
    let flavorDelta=0;if(profile.pricingPolicy==='HIGHEST_FLAVOR')flavorDelta=Math.max(...flavors.map(f=>f.priceDeltaCents));else flavorDelta=Math.round(flavors.reduce((sum,f)=>sum+f.priceDeltaCents,0)/flavors.length);
    let crust=null;if(input.crustId){const row=db.prepare('SELECT * FROM pizza_crusts WHERE id=? AND product_id=? AND active=1').get(String(input.crustId),p.id);if(!row)throw new Error('Borda de pizza invalida.');crust={id:row.id,name:row.name,priceDeltaCents:row.price_delta_cents,recipeProductId:row.recipe_product_id||null};}
    let additionsDelta=0;let additions=null;if(catalogCustomization&&Array.isArray(input.selections)&&input.selections.length){const configured=catalogCustomization.priceConfiguredItem({productId:p.id,selections:input.selections});additions=configured.configurationSnapshot.options;additionsDelta=configured.unitPriceCents-p.sale_price_cents;}
    const unitPriceCents=p.sale_price_cents+size.price_delta_cents+flavorDelta+(crust?.priceDeltaCents||0)+additionsDelta;if(unitPriceCents<0||!Number.isSafeInteger(unitPriceCents))throw new Error('Preco da pizza invalido.');
    const sizeSnapshot={id:size.id,name:size.name,priceDeltaCents:size.price_delta_cents,maxFlavors:size.max_flavors,consumptionMultiplier:Number(size.consumption_multiplier||1)};
    const stockItems=stockItemsFor({productId:p.id,size,flavors,crust});
    return{unitPriceCents,configurationSnapshot:{version:2,productId:p.id,stockItems,pizza:{pricingPolicy:profile.pricingPolicy,size:sizeSnapshot,flavors,crust,additions:additions||[]}}};
  }
  return{upsertProfile,upsertSize,upsertFlavor,upsertCrust,getProfile,pricePizza};
}
module.exports={createPizzeriaService};
