'use strict';

const { randomUUID }=require('node:crypto');
const { withTransaction }=require('../../core/database/sqlite-database');
const { writeAudit }=require('../../core/audit-log');
const { roundQuantity }=require('../inventory/inventory-rules');

function parseJson(value,fallback={}){try{return value?JSON.parse(value):fallback;}catch{return fallback;}}

function createRetailService({db,modules,sales,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db||!modules||!sales)throw new TypeError('db, modules and sales are required.');
  function variantRow(id,{includeInactive=false}={}){
    const row=db.prepare(`SELECT v.*,p.name AS product_name,p.sale_price_cents AS base_price_cents,p.active AS product_active,p.track_stock AS parent_track_stock
      FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=?`).get(String(id));
    if(!row||(!includeInactive&&(!row.active||!row.product_active)))throw new Error('Variacao de produto nao encontrada ou inativa.');
    return row;
  }
  function mapVariant(row){
    if(!row)return null;
    const balance=db.prepare('SELECT quantity,minimum_stock FROM retail_variant_balances WHERE variant_id=?').get(row.id)||{quantity:0,minimum_stock:0};
    return{variantId:row.id,productId:row.product_id,productName:row.product_name,name:row.name,sku:row.sku,barcode:row.barcode,attributes:parseJson(row.attributes_json,{}),priceDeltaCents:row.price_delta_cents,costCents:row.cost_cents,unitPriceCents:Number(row.base_price_cents)+Number(row.price_delta_cents),quantity:Number(balance.quantity||0),minimumStock:Number(balance.minimum_stock||0),parentTracksStock:Boolean(row.parent_track_stock),active:Boolean(row.active&&row.product_active)};
  }

  function listProductVariants({productId=null,query='',includeInactive=false}={}){
    const clauses=[];const params=[];
    if(!includeInactive){clauses.push('v.active=1','p.active=1');}
    if(productId){clauses.push('v.product_id=?');params.push(String(productId));}
    const text=String(query||'').trim().toLowerCase();
    if(text){const q=`%${text}%`;clauses.push("(LOWER(v.name) LIKE ? OR LOWER(COALESCE(v.sku,'')) LIKE ? OR LOWER(COALESCE(v.barcode,'')) LIKE ? OR LOWER(p.name) LIKE ?)");params.push(q,q,q,q);}
    return db.prepare(`SELECT v.*,p.name AS product_name,p.sale_price_cents AS base_price_cents,p.active AS product_active,p.track_stock AS parent_track_stock
      FROM product_variants v JOIN products p ON p.id=v.product_id${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY p.name,v.name,v.id LIMIT 500`).all(...params).map(mapVariant);
  }

  function prepareProductForVariants(productId,actor={}){
    const row=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(String(productId));
    if(!row)throw new Error('Produto pai nao encontrado ou inativo.');
    const quantity=Number(db.prepare('SELECT quantity FROM inventory_balances WHERE product_id=?').get(row.id)?.quantity||0);
    if(row.track_stock&&Math.abs(quantity)>0.000001)throw new Error('Produto pai possui estoque. Zere ou distribua o saldo antes de criar variacoes.');
    if(!row.track_stock)return{productId:row.id,trackStock:false,previousStockQuantity:quantity};
    const ts=now();
    db.prepare('UPDATE products SET track_stock=0,minimum_stock=0,updated_at=? WHERE id=?').run(ts,row.id);
    writeAudit(db,{action:'product.variants.enable',entity:'product',entityId:row.id,actor,context:{previousStockQuantity:quantity}},now);
    return{productId:row.id,trackStock:false,previousStockQuantity:quantity};
  }

  function getProductVariantStock(variantId,{includeInactive=false}={}){return mapVariant(variantRow(variantId,{includeInactive}));}
  function setProductVariantStock(variantId,quantity,actor={}){
    const row=variantRow(variantId);if(row.parent_track_stock)throw new Error('Produto com estoque por variacao deve manter o estoque do item pai desativado.');const next=roundQuantity(Number(quantity));if(!Number.isFinite(next)||next<0)throw new Error('Saldo da variacao invalido.');
    return withTransaction(db,()=>{
      const current=Number(db.prepare('SELECT quantity FROM retail_variant_balances WHERE variant_id=?').get(row.id)?.quantity||0);
      const delta=roundQuantity(next-current);const ts=now();
      db.prepare(`INSERT INTO retail_variant_balances(variant_id,quantity,minimum_stock,updated_at) VALUES(?,?,0,?)
        ON CONFLICT(variant_id) DO UPDATE SET quantity=excluded.quantity,updated_at=excluded.updated_at`).run(row.id,next,ts);
      if(delta!==0)db.prepare(`INSERT INTO retail_variant_movements(id,variant_id,movement_type,quantity_delta,reference_key,created_at) VALUES(?,?,?,?,?,?)`)
        .run(idFactory('retail-move'),row.id,'ADJUSTMENT',delta,`adjustment:${idFactory('ref')}`,ts);
      writeAudit(db,{action:'product.variant.stock.set',entity:'product_variant',entityId:row.id,actor,context:{from:current,to:next,delta}},now);
      return mapVariant(variantRow(row.id));
    });
  }

  function addProductVariantToSale(saleId,input={},actor={}){
    const row=variantRow(input.variantId);if(row.parent_track_stock)throw new Error('Produto com estoque por variacao deve manter o estoque do item pai desativado.');const variant=mapVariant(row);const quantity=roundQuantity(Number(input.quantity??1));if(quantity<=0)throw new Error('Quantidade da variacao invalida.');
    if(quantity>variant.quantity)throw new Error(`Estoque insuficiente para ${variant.productName} - ${variant.name}.`);
    const variantSnapshot={id:variant.variantId,name:variant.name,sku:variant.sku,barcode:variant.barcode,attributes:variant.attributes,costCents:variant.costCents,priceDeltaCents:variant.priceDeltaCents};
    const snapshot={version:2,variant:variantSnapshot,productVariant:variantSnapshot};
    const sale=sales.addItem(String(saleId),{productId:variant.productId,quantity,unitPriceCents:variant.unitPriceCents,configurationSnapshot:snapshot,forceSeparateLine:true});
    writeAudit(db,{action:'product.variant.sale-item',entity:'sale',entityId:String(saleId),actor,context:{variantId:variant.variantId,quantity}},now);
    return sale;
  }

  function getVariantStock(variantId){return getProductVariantStock(variantId);}
  function setVariantStock(variantId,quantity,actor={}){return setProductVariantStock(variantId,quantity,actor);}
  function searchVariants(query=''){return listProductVariants({query});}
  function addVariantToSale(saleId,input={},actor={}){
    const row=variantRow(input.variantId);if(row.parent_track_stock)throw new Error('Produto com estoque por variante deve manter o estoque do produto pai desativado.');const variant=mapVariant(row);const quantity=roundQuantity(Number(input.quantity??1));if(quantity<=0)throw new Error('Quantidade da variacao invalida.');
    if(quantity>variant.quantity)throw new Error(`Estoque insuficiente para ${variant.productName} - ${variant.name}.`);
    const snapshot={version:1,retailVariant:{id:variant.variantId,name:variant.name,sku:variant.sku,barcode:variant.barcode,attributes:variant.attributes,costCents:variant.costCents}};
    const sale=sales.addItem(String(saleId),{productId:variant.productId,quantity,unitPriceCents:variant.unitPriceCents,configurationSnapshot:snapshot,forceSeparateLine:true});
    writeAudit(db,{action:'retail.variant.sale-item',entity:'sale',entityId:String(saleId),actor,context:{variantId:variant.variantId,quantity}},now);
    return sale;
  }

  function applyVariantEvent(event,{factor,movementType,referenceSuffix}){
    const items=Array.isArray(event?.payload?.items)?event.payload.items:[];
    return withTransaction(db,()=>{
      let applied=0;
      for(const item of items){
        const variantId=item?.configuration?.productVariant?.id||item?.configuration?.retailVariant?.id;if(!variantId)continue;
        const row=variantRow(variantId,{includeInactive:true});const quantity=roundQuantity(Number(item.quantity||0));if(quantity<=0)continue;
        const referenceKey=`${event.eventId}:${String(item.itemId||item.saleItemId||item.id||item.productId||variantId)}:${referenceSuffix}`;
        if(db.prepare('SELECT 1 FROM retail_variant_movements WHERE reference_key=?').get(referenceKey))continue;
        const current=Number(db.prepare('SELECT quantity FROM retail_variant_balances WHERE variant_id=?').get(row.id)?.quantity||0);const next=roundQuantity(current+(factor*quantity));
        if(next<0)throw new Error(`Estoque insuficiente para variacao ${row.name}.`);
        const ts=event.occurredAt||now();
        db.prepare(`INSERT INTO retail_variant_balances(variant_id,quantity,minimum_stock,updated_at) VALUES(?,?,0,?) ON CONFLICT(variant_id) DO UPDATE SET quantity=excluded.quantity,updated_at=excluded.updated_at`).run(row.id,next,ts);
        db.prepare(`INSERT INTO retail_variant_movements(id,variant_id,movement_type,quantity_delta,reference_key,created_at) VALUES(?,?,?,?,?,?)`).run(idFactory('retail-move'),row.id,movementType,factor*quantity,referenceKey,ts);applied+=1;
      }
      return{applied};
    });
  }
  function applySaleEvent(event,direction='sale'){return applyVariantEvent(event,direction==='cancel'?{factor:1,movementType:'SALE_REVERSAL',referenceSuffix:'cancel'}:{factor:-1,movementType:'SALE',referenceSuffix:'sale'});}
  function applyReturnEvent(event,direction='return'){return applyVariantEvent(event,direction==='cancel'?{factor:-1,movementType:'RETURN_REVERSAL',referenceSuffix:'return-cancel'}:{factor:1,movementType:'RETURN',referenceSuffix:'return'});}

  return{setVariantStock,getVariantStock,searchVariants,addVariantToSale,applySaleEvent,applyReturnEvent,prepareProductForVariants,listProductVariants,getProductVariantStock,setProductVariantStock,addProductVariantToSale};
}

module.exports={createRetailService};
