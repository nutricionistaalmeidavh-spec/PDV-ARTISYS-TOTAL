'use strict';

const { randomUUID }=require('node:crypto');
const { writeAudit }=require('../../core/audit-log');
const { roundQuantity }=require('../inventory/inventory-rules');
const { assertCents }=require('../shared/money');
const { principalFromActor }=require('../../core/auth/principal-resolver');

function createCommercialPricingService({db,modules,authorization=null,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db||!modules)throw new TypeError('db and modules are required.');
  const text=value=>String(value||'').trim();
  const wholesaleEnabled=()=>modules.isEnabled('WHOLESALE');
  function product(productId){
    const row=db.prepare('SELECT id,name,sale_price_cents AS salePriceCents,active FROM products WHERE id=?').get(text(productId));
    if(!row||!row.active)throw new Error('Produto nao encontrado ou inativo.');
    return row;
  }
  function requirePricingManage(actor={}){if(authorization)authorization.require({principal:principalFromActor(actor),capability:'products.manage'});}
  function mapTier(row){
    if(!row)return null;const p=db.prepare('SELECT name,sale_price_cents AS salePriceCents FROM products WHERE id=?').get(row.product_id);
    return{id:row.id,productId:row.product_id,productName:p?.name||null,minQuantity:roundQuantity(row.min_quantity),unitPriceCents:Number(row.unit_price_cents),baseUnitPriceCents:Number(p?.salePriceCents||0),active:Boolean(row.active),createdBy:row.created_by,createdAt:row.created_at,updatedAt:row.updated_at};
  }
  function listQuantityTiers({productId=null,includeInactive=false}={}){
    const clauses=[];const params=[];if(productId){clauses.push('product_id=?');params.push(text(productId));}if(!includeInactive)clauses.push('active=1');
    return db.prepare(`SELECT * FROM wholesale_price_tiers${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY product_id,min_quantity,id`).all(...params).map(mapTier);
  }
  function upsertQuantityTier(input={},actor={}){
    requirePricingManage(actor);const p=product(input.productId);const minQuantity=roundQuantity(Number(input.minQuantity));
    if(!Number.isFinite(minQuantity)||minQuantity<=0)throw new Error('Quantidade minima da faixa deve ser maior que zero.');
    const unitPriceCents=assertCents(Number(input.unitPriceCents),'unitPriceCents');
    if(unitPriceCents>Number(p.salePriceCents))throw new Error('Preco por quantidade nao pode ser maior que o preco base atual.');
    const requestedId=text(input.id);const sameThreshold=db.prepare('SELECT id FROM wholesale_price_tiers WHERE product_id=? AND min_quantity=?').get(p.id,minQuantity);
    const id=requestedId||sameThreshold?.id||text(idFactory('quantity-tier'));const ts=now();
    const collision=db.prepare('SELECT id FROM wholesale_price_tiers WHERE product_id=? AND min_quantity=? AND id<>?').get(p.id,minQuantity,id);
    if(collision)throw new Error('Ja existe uma faixa para esta quantidade minima.');
    const existing=db.prepare('SELECT id FROM wholesale_price_tiers WHERE id=?').get(id);
    if(existing)db.prepare('UPDATE wholesale_price_tiers SET product_id=?,min_quantity=?,unit_price_cents=?,active=?,updated_at=? WHERE id=?').run(p.id,minQuantity,unitPriceCents,input.active===false?0:1,ts,id);
    else db.prepare('INSERT INTO wholesale_price_tiers(id,product_id,min_quantity,unit_price_cents,active,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,p.id,minQuantity,unitPriceCents,input.active===false?0:1,actor?.userId||null,ts,ts);
    writeAudit(db,{action:'commercial-pricing.quantity-tier.upsert',entity:'quantity-price-tier',entityId:id,actor,context:{productId:p.id,minQuantity,unitPriceCents}},now);
    return mapTier(db.prepare('SELECT * FROM wholesale_price_tiers WHERE id=?').get(id));
  }
  function deactivateQuantityTier(id,actor={}){
    requirePricingManage(actor);const row=db.prepare('SELECT * FROM wholesale_price_tiers WHERE id=?').get(text(id));if(!row)throw new Error('Faixa de preco nao encontrada.');
    db.prepare('UPDATE wholesale_price_tiers SET active=0,updated_at=? WHERE id=?').run(now(),row.id);
    writeAudit(db,{action:'commercial-pricing.quantity-tier.deactivate',entity:'quantity-price-tier',entityId:row.id,actor,context:{productId:row.product_id,minQuantity:row.min_quantity}},now);
    return mapTier(db.prepare('SELECT * FROM wholesale_price_tiers WHERE id=?').get(row.id));
  }
  function resolveUnitPrice({productId,quantity,customerId=null,channel='POS'}={}){
    const p=product(productId);const q=roundQuantity(Number(quantity));if(!Number.isFinite(q)||q<=0)throw new Error('Quantidade deve ser maior que zero.');
    const base=Number(p.salePriceCents);let tier=null;
    if(wholesaleEnabled())tier=db.prepare('SELECT * FROM wholesale_price_tiers WHERE product_id=? AND active=1 AND min_quantity<=? ORDER BY min_quantity DESC,id LIMIT 1').get(p.id,q);
    const tierPrice=tier?Number(tier.unit_price_cents):base;const effective=Math.min(base,tierPrice);const applied=tier&&tierPrice<=base?tier:null;
    return{productId:p.id,productName:p.name,quantity:q,customerId:customerId||null,channel:String(channel||'POS').toUpperCase(),baseUnitPriceCents:base,unitPriceCents:effective,tierId:applied?.id||null,minQuantity:applied?roundQuantity(applied.min_quantity):null,savingsPerUnitCents:Math.max(0,base-effective),totalCents:Math.round(effective*q)};
  }
  return{listQuantityTiers,upsertQuantityTier,deactivateQuantityTier,resolveUnitPrice};
}
module.exports={createCommercialPricingService};
