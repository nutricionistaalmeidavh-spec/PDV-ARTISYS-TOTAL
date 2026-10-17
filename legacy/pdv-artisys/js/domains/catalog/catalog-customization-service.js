'use strict';

const { randomUUID }=require('node:crypto');
const { assertCents }=require('../shared/money');
const { writeAudit }=require('../../core/audit-log');

function bool(value,fallback=true){return(value==null?fallback:Boolean(value))?1:0;}
function requiredText(value,label){const text=String(value||'').trim();if(!text)throw new Error(`${label} obrigatorio.`);return text;}
function int(value,label,{min=0,max=Number.MAX_SAFE_INTEGER}={}){const n=Number(value);if(!Number.isInteger(n)||n<min||n>max)throw new Error(`${label} invalido.`);return n;}
function cleanAttributes(value){if(value==null)return{};if(typeof value!=='object'||Array.isArray(value))throw new Error('Atributos da variacao invalidos.');const result={};for(const [key,entry] of Object.entries(value)){const name=String(key||'').trim();const text=String(entry??'').trim();if(name&&text)result[name]=text;}return result;}
function parseAttributes(value){try{return value?JSON.parse(value):{};}catch{return{};}}

function createCatalogCustomizationService({db,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db)throw new TypeError('Database is required.');

  function requireProduct(productId){const row=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(String(productId));if(!row)throw new Error('Produto nao encontrado ou inativo.');return row;}
  function requireGroup(groupId){const row=db.prepare('SELECT * FROM catalog_option_groups WHERE id=? AND active=1').get(String(groupId));if(!row)throw new Error('Grupo de opcoes nao encontrado ou inativo.');return row;}

  function upsertOptionGroup(input={},actor=null){
    const id=String(input.id||idFactory('optgrp'));const name=requiredText(input.name,'Nome do grupo');
    const type=String(input.selectionType||'MULTIPLE').toUpperCase();if(!['SINGLE','MULTIPLE'].includes(type))throw new Error('Tipo de selecao invalido.');
    const min=int(input.minSelections??0,'Minimo de selecoes',{min:0,max:100});const max=int(input.maxSelections??(type==='SINGLE'?1:1),'Maximo de selecoes',{min:1,max:100});
    if(min>max)throw new Error('Minimo de selecoes nao pode exceder o maximo.');if(type==='SINGLE'&&max!==1)throw new Error('Grupo SINGLE deve aceitar no maximo uma opcao.');
    const ts=now();db.prepare(`INSERT INTO catalog_option_groups(id,name,selection_type,min_selections,max_selections,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,selection_type=excluded.selection_type,min_selections=excluded.min_selections,max_selections=excluded.max_selections,active=excluded.active,updated_at=excluded.updated_at`)
      .run(id,name,type,min,max,bool(input.active),ts,ts);
    writeAudit(db,{action:'catalog.option-group.upsert',entity:'catalog-option-group',entityId:id,actor,context:{name,type,min,max}},now);
    return {id,name,selectionType:type,minSelections:min,maxSelections:max,active:Boolean(bool(input.active))};
  }

  function upsertOption(input={},actor=null){
    const id=String(input.id||idFactory('opt'));const group=requireGroup(input.groupId);const name=requiredText(input.name,'Nome da opcao');
    const delta=assertCents(Number(input.priceDeltaCents??0),'priceDeltaCents');const ts=now();
    db.prepare(`INSERT INTO catalog_options(id,group_id,name,price_delta_cents,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET group_id=excluded.group_id,name=excluded.name,price_delta_cents=excluded.price_delta_cents,active=excluded.active,updated_at=excluded.updated_at`)
      .run(id,group.id,name,delta,bool(input.active),ts,ts);
    writeAudit(db,{action:'catalog.option.upsert',entity:'catalog-option',entityId:id,actor,context:{groupId:group.id,name,priceDeltaCents:delta}},now);
    return{id,groupId:group.id,name,priceDeltaCents:delta,active:Boolean(bool(input.active))};
  }

  function linkGroupToProduct(productId,groupId,input={},actor=null){
    const product=requireProduct(productId);const group=requireGroup(groupId);const required=bool(input.required,false);const sortOrder=int(input.sortOrder??0,'Ordem',{min:0,max:10000});
    db.prepare(`INSERT INTO product_option_groups(product_id,group_id,sort_order,required) VALUES(?,?,?,?)
      ON CONFLICT(product_id,group_id) DO UPDATE SET sort_order=excluded.sort_order,required=excluded.required`).run(product.id,group.id,sortOrder,required);
    writeAudit(db,{action:'catalog.product-option-group.link',entity:'product',entityId:product.id,actor,context:{groupId:group.id,required:Boolean(required),sortOrder}},now);
    return{productId:product.id,groupId:group.id,required:Boolean(required),sortOrder};
  }

  function upsertVariant(input={},actor=null){
    const product=requireProduct(input.productId);const id=String(input.id||idFactory('variant'));const existing=db.prepare('SELECT id,product_id FROM product_variants WHERE id=?').get(id);const editsExisting=Boolean(existing&&String(existing.product_id)===String(product.id));if(existing&&!editsExisting)throw new Error('Esta variação pertence a outro produto. Crie uma nova variação sem reutilizar o ID.');const recipeTable=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='product_recipes'").get());const hasRecipe=recipeTable&&Boolean(db.prepare('SELECT 1 FROM product_recipes WHERE product_id=? AND active=1').get(product.id));if(hasRecipe&&!editsExisting)throw new Error('Produto preparado com Ficha Tecnica nao aceita variacao de estoque. Use opcoes/adicionais da receita.');const name=requiredText(input.name,'Nome da variacao');
    const delta=assertCents(Number(input.priceDeltaCents??0),'priceDeltaCents');const cost=input.costCents==null?null:assertCents(Number(input.costCents),'costCents');const ts=now();
    const sku=String(input.sku||'').trim()||null;const barcode=String(input.barcode||'').trim()||null;const attributes=cleanAttributes(input.attributes);
    db.prepare(`INSERT INTO product_variants(id,product_id,name,sku,barcode,price_delta_cents,cost_cents,active,created_at,updated_at,attributes_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,name=excluded.name,sku=excluded.sku,barcode=excluded.barcode,price_delta_cents=excluded.price_delta_cents,cost_cents=excluded.cost_cents,active=excluded.active,updated_at=excluded.updated_at,attributes_json=excluded.attributes_json`)
      .run(id,product.id,name,sku,barcode,delta,cost,bool(input.active),ts,ts,JSON.stringify(attributes));
    writeAudit(db,{action:'catalog.variant.upsert',entity:'product-variant',entityId:id,actor,context:{productId:product.id,name,sku,barcode,priceDeltaCents:delta,attributes}},now);
    return{id,productId:product.id,name,sku,barcode,attributes,priceDeltaCents:delta,costCents:cost,active:Boolean(bool(input.active))};
  }

  function upsertComboGroup(input={},actor=null){
    const product=requireProduct(input.productId);const id=String(input.id||idFactory('combo'));const name=requiredText(input.name,'Nome do grupo do combo');
    const min=int(input.minSelections??1,'Minimo de selecoes',{min:0,max:100});const max=int(input.maxSelections??1,'Maximo de selecoes',{min:1,max:100});if(min>max)throw new Error('Minimo de selecoes nao pode exceder o maximo.');
    const sortOrder=int(input.sortOrder??0,'Ordem',{min:0,max:10000});const ts=now();
    db.prepare(`INSERT INTO combo_groups(id,product_id,name,min_selections,max_selections,sort_order,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,name=excluded.name,min_selections=excluded.min_selections,max_selections=excluded.max_selections,sort_order=excluded.sort_order,active=excluded.active,updated_at=excluded.updated_at`)
      .run(id,product.id,name,min,max,sortOrder,bool(input.active),ts,ts);
    writeAudit(db,{action:'catalog.combo-group.upsert',entity:'combo-group',entityId:id,actor,context:{productId:product.id,name,min,max}},now);
    return{id,productId:product.id,name,minSelections:min,maxSelections:max,sortOrder,active:Boolean(bool(input.active))};
  }

  function upsertComboItem(groupId,input={},actor=null){
    const group=db.prepare('SELECT * FROM combo_groups WHERE id=? AND active=1').get(String(groupId));if(!group)throw new Error('Grupo de combo nao encontrado ou inativo.');
    const product=requireProduct(input.productId);const quantity=Number(input.quantity??1);if(!Number.isFinite(quantity)||quantity<=0)throw new Error('Quantidade do combo invalida.');
    const delta=assertCents(Number(input.priceDeltaCents??0),'priceDeltaCents');
    db.prepare(`INSERT INTO combo_group_items(group_id,product_id,quantity,price_delta_cents) VALUES(?,?,?,?)
      ON CONFLICT(group_id,product_id) DO UPDATE SET quantity=excluded.quantity,price_delta_cents=excluded.price_delta_cents`).run(group.id,product.id,quantity,delta);
    writeAudit(db,{action:'catalog.combo-item.upsert',entity:'combo-group',entityId:group.id,actor,context:{productId:product.id,quantity,priceDeltaCents:delta}},now);
    return{groupId:group.id,productId:product.id,quantity,priceDeltaCents:delta};
  }

  function getProductConfiguration(productId){
    const product=requireProduct(productId);
    const groups=db.prepare(`SELECT g.*,pg.required,pg.sort_order FROM product_option_groups pg JOIN catalog_option_groups g ON g.id=pg.group_id WHERE pg.product_id=? AND g.active=1 ORDER BY pg.sort_order,g.name,g.id`).all(product.id).map(g=>({
      id:g.id,name:g.name,selectionType:g.selection_type,minSelections:g.min_selections,maxSelections:g.max_selections,required:Boolean(g.required),sortOrder:g.sort_order,
      options:db.prepare('SELECT id,name,price_delta_cents AS priceDeltaCents FROM catalog_options WHERE group_id=? AND active=1 ORDER BY name,id').all(g.id)
    }));
    const variants=db.prepare('SELECT id,name,sku,barcode,attributes_json AS attributesJson,price_delta_cents AS priceDeltaCents,cost_cents AS costCents FROM product_variants WHERE product_id=? AND active=1 ORDER BY name,id').all(product.id).map(({attributesJson,...variant})=>({...variant,attributes:parseAttributes(attributesJson)}));
    const combos=db.prepare('SELECT * FROM combo_groups WHERE product_id=? AND active=1 ORDER BY sort_order,name,id').all(product.id).map(g=>({
      id:g.id,name:g.name,minSelections:g.min_selections,maxSelections:g.max_selections,sortOrder:g.sort_order,
      items:db.prepare(`SELECT i.product_id AS productId,p.name AS productName,i.quantity,i.price_delta_cents AS priceDeltaCents FROM combo_group_items i JOIN products p ON p.id=i.product_id WHERE i.group_id=? AND p.active=1 ORDER BY p.name,p.id`).all(g.id)
    }));
    return{productId:product.id,basePriceCents:product.sale_price_cents,groups,variants,combos};
  }

  function priceConfiguredItem(input={}){
    const product=requireProduct(input.productId);let price=product.sale_price_cents;let variant=null;
    if(input.variantId){const row=db.prepare('SELECT * FROM product_variants WHERE id=? AND product_id=? AND active=1').get(String(input.variantId),product.id);if(!row)throw new Error('Variacao invalida para o produto.');variant={id:row.id,name:row.name,sku:row.sku,barcode:row.barcode,attributes:parseAttributes(row.attributes_json),priceDeltaCents:row.price_delta_cents};price+=row.price_delta_cents;}
    const config=getProductConfiguration(product.id);const selectedIds=(input.selections||[]).map(s=>String(s.optionId||s));const selected=[];
    for(const group of config.groups){const allowed=new Map(group.options.map(o=>[o.id,o]));const inGroup=selectedIds.filter(id=>allowed.has(id));const min=Math.max(group.minSelections,group.required?1:0);if(inGroup.length<min)throw new Error(`Selecione ao menos ${min} opcao(oes) em ${group.name}.`);if(inGroup.length>group.maxSelections)throw new Error(`Selecoes excedem o maximo em ${group.name}.`);if(group.selectionType==='SINGLE'&&inGroup.length>1)throw new Error(`Grupo ${group.name} aceita apenas uma opcao.`);for(const id of inGroup){const option=allowed.get(id);selected.push({id:option.id,groupId:group.id,groupName:group.name,name:option.name,priceDeltaCents:option.priceDeltaCents});price+=option.priceDeltaCents;}}
    const knownOptionIds=new Set(config.groups.flatMap(g=>g.options.map(o=>o.id)));for(const id of selectedIds)if(!knownOptionIds.has(id))throw new Error(`Opcao ${id} nao pertence ao produto.`);
    const comboSelections=[];const inputCombos=input.comboSelections||[];
    for(const group of config.combos){const picks=inputCombos.filter(x=>String(x.groupId)===group.id);if(picks.length<group.minSelections||picks.length>group.maxSelections)throw new Error(`Selecao do combo invalida em ${group.name}.`);const allowed=new Map(group.items.map(i=>[i.productId,i]));for(const pick of picks){const item=allowed.get(String(pick.productId));if(!item)throw new Error('Item invalido para o combo.');comboSelections.push({groupId:group.id,groupName:group.name,productId:item.productId,productName:item.productName,quantity:item.quantity,priceDeltaCents:item.priceDeltaCents});price+=item.priceDeltaCents;}}
    if(!Number.isSafeInteger(price)||price<0)throw new Error('Preco configurado invalido.');
    return{unitPriceCents:price,configurationSnapshot:{version:1,productId:product.id,variant,options:selected,comboSelections}};
  }

  return{upsertOptionGroup,upsertOption,linkGroupToProduct,upsertVariant,upsertComboGroup,upsertComboItem,getProductConfiguration,priceConfiguredItem};
}

module.exports={createCatalogCustomizationService};
