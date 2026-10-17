'use strict';

const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../core/database/sqlite-database');
const { writeAudit } = require('../../core/audit-log');
const { assertCents } = require('../shared/money');
const { roundQuantity } = require('../inventory/inventory-rules');

function boolInt(value, fallback = true) { return (value == null ? fallback : Boolean(value)) ? 1 : 0; }
function text(value, label) { const result=String(value||'').trim(); if(!result) throw new Error(`${label} obrigatorio.`); return result; }
function positiveInt(value, label, min = 1) { const n=Number(value); if(!Number.isInteger(n)||n<min) throw new Error(`${label} invalido.`); return n; }
function normalizeIso(value, label) {
  if(value==null || String(value).trim()==='') return null;
  const date=new Date(value); if(Number.isNaN(date.getTime())) throw new Error(`${label} invalido.`);
  return date.toISOString();
}

function createKitComboService({ db, catalog, recipes, now = () => new Date().toISOString(), idFactory = p => `${p}-${randomUUID()}` } = {}) {
  if(!db || !catalog || !recipes) throw new TypeError('db, catalog and recipes are required.');

  function requireProduct(productId) {
    const row=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(String(productId));
    if(!row) throw new Error(`Produto ${productId} nao encontrado ou inativo.`);
    return row;
  }

  function normalizeComponents(productId, components) {
    if(!Array.isArray(components) || !components.length) throw new Error('Kit deve possuir ao menos um componente.');
    const totals=new Map();
    for(const component of components) {
      const componentId=String(component.productId||'').trim();
      if(!componentId) throw new Error('Produto do componente obrigatorio.');
      if(componentId===String(productId)) throw new Error('Kit nao pode conter ele mesmo.');
      if(db.prepare('SELECT 1 FROM product_kits WHERE product_id=?').get(componentId)) throw new Error('Kit dentro de kit nao e suportado.');
      const product=requireProduct(componentId);
      const quantity=roundQuantity(Number(component.quantity));
      if(!Number.isFinite(quantity)||quantity<=0) throw new Error('Quantidade do componente invalida.');
      totals.set(product.id, roundQuantity((totals.get(product.id)||0)+quantity));
    }
    return [...totals].sort(([a],[b])=>a.localeCompare(b)).map(([componentId,quantity])=>({productId:componentId,quantity,conversionFactor:1,lossPercent:0}));
  }

  function getKit(productId) {
    const marker=db.prepare('SELECT * FROM product_kits WHERE product_id=?').get(String(productId));
    if(!marker) return null;
    const product=catalog.getProduct(productId); if(!product) return null;
    const recipe=recipes.getRecipe(productId);
    return {...product,kind:'KIT',active:Boolean(product.active&&marker.active),components:(recipe?.components||[]).map(c=>({productId:c.productId,productName:c.productName,quantity:c.quantity,unit:c.unit}))};
  }

  function upsertKit(input = {}, actor = null) {
    const id=String(input.id||idFactory('kit')).trim();
    const name=text(input.name,'Nome do kit');
    const components=normalizeComponents(id,input.components);
    const salePriceCents=assertCents(Number(input.salePriceCents??0),'salePriceCents');
    const costCents=assertCents(Number(input.costCents??0),'costCents');
    if(salePriceCents<0||costCents<0) throw new Error('Valores do kit nao podem ser negativos.');
    return withTransaction(db,()=>{
      const product=catalog.upsertProduct({
        id,name,sku:input.sku,barcode:input.barcode,categoryId:input.categoryId,unit:input.unit||'UN',
        salePriceCents,costCents,trackStock:false,minimumStock:0,active:input.active==null?true:Boolean(input.active)
      },actor);
      recipes.setRecipe(product.id,{components},actor);
      const ts=now();
      db.prepare(`INSERT INTO product_kits(product_id,active,created_at,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(product_id) DO UPDATE SET active=excluded.active,updated_at=excluded.updated_at`)
        .run(product.id,boolInt(input.active),ts,ts);
      writeAudit(db,{action:'kit.upsert',entity:'product-kit',entityId:product.id,actor,context:{name,componentCount:components.length,salePriceCents}},now);
      return getKit(product.id);
    });
  }

  function listKits({ includeInactive = false } = {}) {
    const rows=includeInactive
      ? db.prepare('SELECT product_id AS productId FROM product_kits ORDER BY updated_at DESC,product_id').all()
      : db.prepare('SELECT k.product_id AS productId FROM product_kits k JOIN products p ON p.id=k.product_id WHERE k.active=1 AND p.active=1 ORDER BY p.name,p.id').all();
    return rows.map(row=>getKit(row.productId)).filter(Boolean);
  }

  function rowToCombo(row) {
    if(!row) return null;
    const products=db.prepare(`SELECT cp.product_id AS productId,p.name AS productName,p.sale_price_cents AS salePriceCents
      FROM promotional_combo_products cp JOIN products p ON p.id=cp.product_id WHERE cp.combo_id=? ORDER BY p.name,p.id`).all(row.id);
    return {
      id:row.id,name:row.name,selectionMode:row.selection_mode,requiredQuantity:row.required_quantity,bundlePriceCents:row.bundle_price_cents,
      maxApplicationsPerSale:row.max_applications_per_sale,allowManualDiscount:Boolean(row.allow_manual_discount),startsAt:row.starts_at,endsAt:row.ends_at,
      active:Boolean(row.active),createdAt:row.created_at,updatedAt:row.updated_at,productIds:products.map(p=>p.productId),products
    };
  }

  function getPromotionalCombo(id) { return rowToCombo(db.prepare('SELECT * FROM promotional_combo_rules WHERE id=?').get(String(id))); }

  function upsertPromotionalCombo(input = {}, actor = null) {
    const id=String(input.id||idFactory('promo-combo')).trim();
    const name=text(input.name,'Nome do combo');
    const selectionMode=String(input.selectionMode||'SAME_PRODUCT').trim().toUpperCase();
    if(!['SAME_PRODUCT','ANY_SELECTED'].includes(selectionMode)) throw new Error('Modo do combo invalido.');
    const requiredQuantity=positiveInt(input.requiredQuantity,'Quantidade necessaria',2);
    const bundlePriceCents=assertCents(Number(input.bundlePriceCents??0),'bundlePriceCents');
    if(bundlePriceCents<0) throw new Error('Preco do combo nao pode ser negativo.');
    const maxApplicationsPerSale=input.maxApplicationsPerSale==null||String(input.maxApplicationsPerSale).trim()===''?null:positiveInt(input.maxApplicationsPerSale,'Limite por venda',1);
    const startsAt=normalizeIso(input.startsAt,'Inicio da promocao');
    const endsAt=normalizeIso(input.endsAt,'Fim da promocao');
    if(startsAt&&endsAt&&new Date(startsAt)>=new Date(endsAt)) throw new Error('Fim da promocao deve ser posterior ao inicio.');
    const productIds=[...new Set((Array.isArray(input.productIds)?input.productIds:[]).map(value=>String(value||'').trim()).filter(Boolean))];
    if(!productIds.length) throw new Error('Selecione ao menos um produto para o combo.');
    for(const productId of productIds) requireProduct(productId);
    const ts=now();
    return withTransaction(db,()=>{
      db.prepare(`INSERT INTO promotional_combo_rules(id,name,selection_mode,required_quantity,bundle_price_cents,max_applications_per_sale,allow_manual_discount,starts_at,ends_at,active,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,selection_mode=excluded.selection_mode,required_quantity=excluded.required_quantity,bundle_price_cents=excluded.bundle_price_cents,max_applications_per_sale=excluded.max_applications_per_sale,allow_manual_discount=excluded.allow_manual_discount,starts_at=excluded.starts_at,ends_at=excluded.ends_at,active=excluded.active,updated_at=excluded.updated_at`)
        .run(id,name,selectionMode,requiredQuantity,bundlePriceCents,maxApplicationsPerSale,boolInt(input.allowManualDiscount),startsAt,endsAt,boolInt(input.active),ts,ts);
      db.prepare('DELETE FROM promotional_combo_products WHERE combo_id=?').run(id);
      const insert=db.prepare('INSERT INTO promotional_combo_products(combo_id,product_id) VALUES(?,?)');
      for(const productId of productIds) insert.run(id,productId);
      writeAudit(db,{action:'promotional-combo.upsert',entity:'promotional-combo',entityId:id,actor,context:{name,selectionMode,requiredQuantity,bundlePriceCents,productIds,allowManualDiscount:input.allowManualDiscount!==false}},now);
      return getPromotionalCombo(id);
    });
  }

  function listPromotionalCombos({ includeInactive = false } = {}) {
    const rows=includeInactive
      ? db.prepare('SELECT * FROM promotional_combo_rules ORDER BY active DESC,name,id').all()
      : db.prepare('SELECT * FROM promotional_combo_rules WHERE active=1 ORDER BY name,id').all();
    return rows.map(rowToCombo);
  }

  function activeRules(at) {
    const instant=new Date(at||now());
    if(Number.isNaN(instant.getTime())) throw new Error('Data de avaliacao da promocao invalida.');
    return listPromotionalCombos().filter(rule=>(!rule.startsAt||instant>=new Date(rule.startsAt))&&(!rule.endsAt||instant<=new Date(rule.endsAt)));
  }

  function normalizeCart(items) {
    const byProduct=new Map();
    for(const item of items||[]) {
      const productId=String(item.productId||'').trim(); if(!productId) continue;
      const quantity=Math.max(0,Math.floor(Number(item.quantity||0)+1e-9)); if(!quantity) continue;
      const unitPriceCents=assertCents(Number(item.unitPriceCents??0),'unitPriceCents'); if(unitPriceCents<0) continue;
      const current=byProduct.get(productId);
      if(current && current.unitPriceCents===unitPriceCents) current.quantity+=quantity;
      else if(!current) byProduct.set(productId,{productId,quantity,unitPriceCents});
      else {
        const weighted=Math.round((current.unitPriceCents*current.quantity+unitPriceCents*quantity)/(current.quantity+quantity));
        current.quantity+=quantity; current.unitPriceCents=weighted;
      }
    }
    return byProduct;
  }

  function candidatesForRule(rule,cart) {
    const candidates=[]; const eligible=rule.productIds.map(id=>cart.get(id)).filter(Boolean);
    const cap=rule.maxApplicationsPerSale??Number.MAX_SAFE_INTEGER;
    if(rule.selectionMode==='SAME_PRODUCT') {
      for(const item of eligible) {
        const normal=rule.requiredQuantity*item.unitPriceCents; const discount=normal-rule.bundlePriceCents;
        if(discount<=0) continue;
        const applications=Math.min(Math.floor(item.quantity/rule.requiredQuantity),cap);
        for(let i=0;i<applications;i++) candidates.push({rule,discountCents:discount,allocation:{[item.productId]:rule.requiredQuantity},tie:`${item.productId}:${String(i).padStart(8,'0')}`});
      }
      return candidates;
    }
    const local=new Map(eligible.map(item=>[item.productId,item.quantity]));
    const ordered=[...eligible].sort((a,b)=>b.unitPriceCents-a.unitPriceCents||a.productId.localeCompare(b.productId));
    const total=eligible.reduce((sum,item)=>sum+item.quantity,0); const applications=Math.min(Math.floor(total/rule.requiredQuantity),cap);
    for(let index=0;index<applications;index++) {
      let need=rule.requiredQuantity,normal=0; const allocation={};
      for(const item of ordered) {
        const available=local.get(item.productId)||0; if(!available||need<=0) continue;
        const take=Math.min(available,need); local.set(item.productId,available-take); allocation[item.productId]=(allocation[item.productId]||0)+take; normal+=take*item.unitPriceCents; need-=take;
      }
      if(need>0) break;
      const discount=normal-rule.bundlePriceCents; if(discount<=0) break;
      candidates.push({rule,discountCents:discount,allocation,tie:String(index).padStart(8,'0')});
    }
    return candidates;
  }

  function resolvePromotions(items = [], at = now()) {
    const cart=normalizeCart(items); const remaining=new Map([...cart].map(([id,item])=>[id,item.quantity]));
    const candidates=activeRules(at).flatMap(rule=>candidatesForRule(rule,cart));
    candidates.sort((a,b)=>b.discountCents-a.discountCents||a.rule.id.localeCompare(b.rule.id)||a.tie.localeCompare(b.tie));
    const appliedMap=new Map();const acceptedByRule=new Map();let discountCents=0;let blocksManualDiscount=false;
    for(const candidate of candidates) {
      const accepted=acceptedByRule.get(candidate.rule.id)||0;
      const cap=candidate.rule.maxApplicationsPerSale??Number.MAX_SAFE_INTEGER;
      if(accepted>=cap)continue;
      const fits=Object.entries(candidate.allocation).every(([productId,quantity])=>(remaining.get(productId)||0)>=quantity); if(!fits) continue;
      for(const [productId,quantity] of Object.entries(candidate.allocation)) remaining.set(productId,(remaining.get(productId)||0)-quantity);
      acceptedByRule.set(candidate.rule.id,accepted+1);
      discountCents+=candidate.discountCents; blocksManualDiscount ||= !candidate.rule.allowManualDiscount;
      const current=appliedMap.get(candidate.rule.id)||{comboId:candidate.rule.id,name:candidate.rule.name,selectionMode:candidate.rule.selectionMode,applications:0,discountCents:0,allowManualDiscount:candidate.rule.allowManualDiscount};
      current.applications+=1; current.discountCents+=candidate.discountCents; appliedMap.set(candidate.rule.id,current);
    }
    const subtotal=[...cart.values()].reduce((sum,item)=>sum+item.quantity*item.unitPriceCents,0);
    return {discountCents:Math.min(discountCents,subtotal),blocksManualDiscount,applied:[...appliedMap.values()]};
  }

  return { upsertKit,getKit,listKits,upsertPromotionalCombo,getPromotionalCombo,listPromotionalCombos,resolvePromotions };
}

module.exports = { createKitComboService };
