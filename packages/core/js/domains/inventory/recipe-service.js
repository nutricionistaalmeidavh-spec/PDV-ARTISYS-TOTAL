'use strict';

const { randomUUID }=require('node:crypto');
const { withTransaction }=require('../../core/database/sqlite-database');
const { writeAudit }=require('../../core/audit-log');
const { roundQuantity }=require('./inventory-rules');

function createRecipeService({db,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db)throw new TypeError('Database is required.');

  function ensureRecipeColumns(){
    const table=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='product_recipes'").get());
    if(!table)return;
    const columns=new Set(db.prepare('PRAGMA table_info(product_recipes)').all().map(column=>column.name));
    const additions=[
      ['yield_quantity',"REAL NOT NULL DEFAULT 1 CHECK(yield_quantity>0)"],
      ['yield_unit',"TEXT NOT NULL DEFAULT 'UN'"],
      ['portion_quantity',"REAL NOT NULL DEFAULT 1 CHECK(portion_quantity>0)"],
      ['prep_time_minutes',"INTEGER NOT NULL DEFAULT 0 CHECK(prep_time_minutes>=0)"],
      ['preparation_notes','TEXT'],
      ['notes','TEXT']
    ];
    for(const [name,definition] of additions){
      if(columns.has(name))continue;
      db.exec(`ALTER TABLE product_recipes ADD COLUMN ${name} ${definition}`);
      columns.add(name);
    }
  }
  ensureRecipeColumns();

  function requireProduct(productId){const row=db.prepare('SELECT * FROM products WHERE id=?').get(String(productId));if(!row)throw new Error(`Produto ${productId} nao encontrado no catalogo.`);return row;}

  function getRecipe(productId){
    const recipe=db.prepare('SELECT * FROM product_recipes WHERE product_id=? AND active=1 ORDER BY version DESC LIMIT 1').get(String(productId));if(!recipe)return null;
    const components=db.prepare(`SELECT rc.id,rc.ingredient_product_id AS productId,p.name AS productName,rc.quantity,rc.unit,rc.conversion_factor AS conversionFactor,rc.loss_percent AS lossPercent,p.cost_cents AS costCents,p.track_stock AS trackStock
      FROM recipe_components rc JOIN products p ON p.id=rc.ingredient_product_id WHERE rc.recipe_id=? ORDER BY rc.id`).all(recipe.id);
    const theoreticalCostCents=components.reduce((total,c)=>total+Math.round(Number(c.costCents||0)*Number(c.quantity||0)*Number(c.conversionFactor||1)*(1+Number(c.lossPercent||0)/100)),0);
    const portions=Math.max(Number(recipe.yield_quantity||1)/Math.max(Number(recipe.portion_quantity||1),0.000001),1);
    return{id:recipe.id,productId:recipe.product_id,version:recipe.version,createdBy:recipe.created_by,createdAt:recipe.created_at,
      yieldQuantity:Number(recipe.yield_quantity||1),yieldUnit:recipe.yield_unit||'UN',portionQuantity:Number(recipe.portion_quantity||1),
      prepTimeMinutes:Number(recipe.prep_time_minutes||0),preparationNotes:recipe.preparation_notes||'',notes:recipe.notes||'',
      theoreticalCostCents,costPerPortionCents:Math.round(theoreticalCostCents/portions),components};
  }

  function setRecipe(productId,input={},actor=null){
    const product=requireProduct(productId);const components=Array.isArray(input.components)?input.components:[];if(!components.length)throw new Error('Ficha tecnica deve possuir ao menos um ingrediente.');
    const ts=now();return withTransaction(db,()=>{
      const last=Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM product_recipes WHERE product_id=?').get(product.id)?.version||0);const version=last+1;
      db.prepare('UPDATE product_recipes SET active=0 WHERE product_id=? AND active=1').run(product.id);const id=String(input.id||idFactory('recipe'));
      const yieldQuantity=Number(input.yieldQuantity??1);const portionQuantity=Number(input.portionQuantity??1);const prepTimeMinutes=Number(input.prepTimeMinutes??0);
      if(!Number.isFinite(yieldQuantity)||yieldQuantity<=0)throw new Error('Rendimento invalido.');
      if(!Number.isFinite(portionQuantity)||portionQuantity<=0)throw new Error('Porcao invalida.');
      if(!Number.isFinite(prepTimeMinutes)||prepTimeMinutes<0)throw new Error('Tempo de preparo invalido.');
      db.prepare('INSERT INTO product_recipes(id,product_id,version,active,created_by,created_at,yield_quantity,yield_unit,portion_quantity,prep_time_minutes,preparation_notes,notes) VALUES(?,?,?,1,?,?,?,?,?,?,?,?)')
        .run(id,product.id,version,actor?.userId||null,ts,yieldQuantity,String(input.yieldUnit||product.unit||'UN').toUpperCase(),portionQuantity,Math.round(prepTimeMinutes),String(input.preparationNotes||'').trim()||null,String(input.notes||'').trim()||null);
      const insert=db.prepare('INSERT INTO recipe_components(id,recipe_id,ingredient_product_id,quantity,unit,conversion_factor,loss_percent) VALUES(?,?,?,?,?,?,?)');
      for(const component of components){const ingredient=requireProduct(component.productId);if(ingredient.active===0)throw new Error('Ingrediente inativo.');if(ingredient.track_stock===0)throw new Error('Ficha tecnica aceita apenas insumos controlados no Estoque.');if(String(ingredient.usage_type||'DIRECT')==='DIRECT')db.prepare("UPDATE products SET usage_type='BOTH',updated_at=? WHERE id=?").run(ts,ingredient.id);const quantity=Number(component.quantity);const conversion=Number(component.conversionFactor??1);const loss=Number(component.lossPercent??0);if(!Number.isFinite(quantity)||quantity<=0)throw new Error('Quantidade de ingrediente invalida.');if(!Number.isFinite(conversion)||conversion<=0)throw new Error('Fator de conversao invalido.');if(!Number.isFinite(loss)||loss<0||loss>=100)throw new Error('Percentual de perda invalido.');insert.run(idFactory('recipe-component'),id,ingredient.id,roundQuantity(quantity),String(component.unit||ingredient.unit||'UN').toUpperCase(),conversion,loss);}
      writeAudit(db,{action:'recipe.set',entity:'product',entityId:product.id,actor,context:{recipeId:id,version,componentCount:components.length}},now);return getRecipe(product.id);
    });
  }

  function expandItems(items=[]){
    const totals=new Map();
    for(const item of items||[]){const quantity=roundQuantity(Number(item.quantity||0));if(quantity<=0)continue;const recipe=getRecipe(item.productId);if(!recipe){totals.set(String(item.productId),roundQuantity((totals.get(String(item.productId))||0)+quantity));continue;}
      const portionsPerBatch=Math.max(Number(recipe.yieldQuantity||1)/Math.max(Number(recipe.portionQuantity||1),0.000001),0.000001);
      for(const component of recipe.components){const multiplier=Number(component.conversionFactor||1)*(1+Number(component.lossPercent||0)/100);const used=roundQuantity(quantity*Number(component.quantity)*multiplier/portionsPerBatch);totals.set(String(component.productId),roundQuantity((totals.get(String(component.productId))||0)+used));}
    }
    return[...totals].map(([productId,quantity])=>({productId,quantity}));
  }

  function availability(productId){
    const recipe=getRecipe(productId);if(!recipe)return null;
    let capacity=Infinity;let low=false;let out=false;
    const portionsPerBatch=Math.max(Number(recipe.yieldQuantity||1)/Math.max(Number(recipe.portionQuantity||1),0.000001),0.000001);const ingredients=recipe.components.map(c=>{const balance=db.prepare('SELECT quantity FROM inventory_balances WHERE product_id=?').get(c.productId);const stock=Number(balance?.quantity||0);const perUnit=Number(c.quantity)*Number(c.conversionFactor||1)*(1+Number(c.lossPercent||0)/100)/portionsPerBatch;const possible=perUnit>0?Math.floor(stock/perUnit):Infinity;capacity=Math.min(capacity,possible);if(stock<=0)out=true;else if(possible<=1)low=true;return{productId:c.productId,productName:c.productName,stock,requiredPerUnit:perUnit,possible};});
    return{capacity:Number.isFinite(capacity)?Math.max(0,capacity):0,status:out?'OUT':low?'LOW':'OK',ingredients};
  }

  function theoreticalCostCents(productId){
    const recipe=getRecipe(productId);
    if(!recipe)return Number(requireProduct(productId).cost_cents||0);
    return Math.max(0,Number(recipe.costPerPortionCents||0));
  }

  return{getRecipe,setRecipe,expandItems,theoreticalCostCents,availability};
}

module.exports={createRecipeService};
