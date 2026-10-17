'use strict';

const { assertCents } = require('../shared/money');
const { sanitizeSaleObservation } = require('./sale-observation');

function parsePromotions(value) { try { return value ? JSON.parse(value) : []; } catch { return []; } }

function variantIdSql(column = 'configuration_json') {
  return `COALESCE(
    json_extract(${column},'$.productVariant.id'),
    json_extract(${column},'$.retailVariant.id'),
    json_extract(${column},'$.variant.id'),
    json_extract(${column},'$.variantId')
  )`;
}

function createPromotionSaleService({ db, baseSales, promotionService, commercialPricingService = null, now = () => new Date().toISOString() } = {}) {
  if(!db || !baseSales || !promotionService) throw new TypeError('db, baseSales and promotionService are required.');

  const saleColumns=new Set(db.prepare('PRAGMA table_info(sales)').all().map(column=>column.name));
  if(!saleColumns.has('observation'))db.exec('ALTER TABLE sales ADD COLUMN observation TEXT');
  if(!saleColumns.has('print_observation'))db.exec('ALTER TABLE sales ADD COLUMN print_observation INTEGER NOT NULL DEFAULT 0 CHECK (print_observation IN (0,1))');

  function readState(sale) {
    const row=db.prepare('SELECT * FROM sale_discount_states WHERE sale_id=?').get(String(sale.id));
    if(row) return {manualDiscountCents:row.manual_discount_cents,promotionDiscountCents:row.promotion_discount_cents,promotions:parsePromotions(row.promotions_json),blocksManualDiscount:Boolean(row.blocks_manual_discount)};
    return {manualDiscountCents:Number(sale.discountCents||0),promotionDiscountCents:0,promotions:[],blocksManualDiscount:false};
  }

  function readObservation(saleId){
    return db.prepare('SELECT observation,print_observation FROM sales WHERE id=?').get(String(saleId))||{};
  }

  function readPartyNames(sale) {
    const operatorId=String(sale?.operatorId || '').trim();
    const customerId=String(sale?.customerId || '').trim();
    const operator=operatorId ? db.prepare('SELECT name FROM users WHERE id=?').get(operatorId) : null;
    const customer=customerId ? db.prepare('SELECT name FROM customers WHERE id=?').get(customerId) : null;
    const operatorName=String(sale?.operatorName || operator?.name || '').trim() || null;
    const customerName=String(sale?.customerName || customer?.name || '').trim() || null;
    return {operatorName,customerName};
  }

  function enrich(sale) {
    if(!sale) return sale;
    const state=readState(sale);
    const observation=readObservation(sale.id);
    const partyNames=readPartyNames(sale);
    return {...sale,...partyNames,manualDiscountCents:state.manualDiscountCents,promotionDiscountCents:state.promotionDiscountCents,totalDiscountCents:Number(sale.discountCents||0),promotions:state.promotions,blocksManualDiscount:state.blocksManualDiscount,observation:observation.observation||'',printObservation:Boolean(observation.print_observation)};
  }

  function enrichCostDetails(sale) {
    const enriched=enrich(sale);
    if(!enriched||!Array.isArray(enriched.items)||!enriched.items.length)return enriched;
    const itemVariantId=variantIdSql('si.configuration_json');
    const rows=db.prepare(`SELECT si.id,si.cost_cents_snapshot AS costCentsSnapshot,si.cost_snapshot_source AS costSnapshotSource,
      COALESCE(pv.cost_cents,p.cost_cents,0) AS currentCostCents
      FROM sale_items si
      LEFT JOIN products p ON p.id=si.product_id
      LEFT JOIN product_variants pv ON pv.id=${itemVariantId}
      WHERE si.sale_id=?`).all(String(enriched.id));
    const costs=new Map(rows.map(row=>[String(row.id),row]));
    return {...enriched,items:enriched.items.map(item=>{
      const cost=costs.get(String(item.id));
      if(!cost)return item;
      const historical=cost.costCentsSnapshot!=null;
      const effectiveCostCents=historical?Number(cost.costCentsSnapshot):Number(cost.currentCostCents||0);
      return {...item,costCentsSnapshot:historical?Number(cost.costCentsSnapshot):null,costSnapshotSource:historical?(cost.costSnapshotSource||'PRODUCT'):null,effectiveCostCents,costBasis:historical?'HISTORICAL_SNAPSHOT':'ESTIMATED_CURRENT'};
    })};
  }

  function writeState(saleId,state) {
    db.prepare(`INSERT INTO sale_discount_states(sale_id,manual_discount_cents,promotion_discount_cents,promotions_json,blocks_manual_discount,updated_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(sale_id) DO UPDATE SET manual_discount_cents=excluded.manual_discount_cents,promotion_discount_cents=excluded.promotion_discount_cents,promotions_json=excluded.promotions_json,blocks_manual_discount=excluded.blocks_manual_discount,updated_at=excluded.updated_at`)
      .run(String(saleId),state.manualDiscountCents,state.promotionDiscountCents,JSON.stringify(state.promotions||[]),state.blocksManualDiscount?1:0,now());
  }

  function extractObservation(input={}){
    const first=Array.isArray(input.payments)?input.payments[0]:null;
    if(!first||(!Object.prototype.hasOwnProperty.call(first,'saleObservation')&&!Object.prototype.hasOwnProperty.call(first,'printObservation')))return null;
    const observation=sanitizeSaleObservation(first.saleObservation);
    return{observation,printObservation:Boolean(first.printObservation&&observation.trim())};
  }

  function stripObservationTransport(input={}){
    return{...input,payments:(input.payments||[]).map(payment=>{const{saleObservation:_saleObservation,printObservation:_printObservation,...safe}=payment||{};return safe;})};
  }

  function persistObservation(saleId,input={}){
    const data=extractObservation(input);if(!data)return;
    db.prepare('UPDATE sales SET observation=?,print_observation=?,updated_at=? WHERE id=?').run(data.observation||null,data.printObservation?1:0,now(),String(saleId));
  }

  function applyQuantityPricing(saleId) {
    if(!commercialPricingService)return;
    const sale=baseSales.getSale(saleId);if(!sale)return;
    const update=db.prepare('UPDATE sale_items SET catalog_unit_price_cents=?,unit_price_cents=?,total_cents=?,allocated_discount_cents=0,net_total_cents=NULL,updated_at=? WHERE id=?');
    for(const item of sale.items||[]){
      if(item.priceOverrideReason||item.configuration)continue;
      const resolved=commercialPricingService.resolveUnitPrice({productId:item.productId,quantity:item.quantity,customerId:sale.customerId||null,channel:'POS'});
      if(Number(item.unitPriceCents)!==Number(resolved.unitPriceCents)||Number(item.catalogUnitPriceCents??resolved.baseUnitPriceCents)!==Number(resolved.baseUnitPriceCents)){
        update.run(resolved.baseUnitPriceCents,resolved.unitPriceCents,Math.round(Number(item.quantity)*Number(resolved.unitPriceCents)),now(),item.id);
      }
    }
  }

  function reprice(saleId, manualOverride) {
    applyQuantityPricing(saleId);
    const sale=baseSales.getSale(saleId); if(!sale) throw new Error('Venda nao encontrada.');
    const previous=readState(sale);
    let requested=manualOverride===undefined?previous.manualDiscountCents:assertCents(Number(manualOverride),'discountCents');
    if(requested<0) throw new Error('Desconto nao pode ser negativo.');
    const promotion=promotionService.resolvePromotions(sale.items||[],now());
    if(promotion.blocksManualDiscount&&requested>0){
      if(manualOverride!==undefined)throw new Error('Este combo nao permite desconto manual acumulado.');
      requested=0;
    }
    const calculatedSubtotal=(sale.items||[]).reduce((sum,item)=>sum+Math.round(Number(item.unitPriceCents||0)*Number(item.quantity||0)),0);
    const promotionDiscountCents=Math.min(Number(promotion.discountCents||0),calculatedSubtotal);
    const manualDiscountCents=Math.min(requested,Math.max(calculatedSubtotal-promotionDiscountCents,0));
    const combined=promotionDiscountCents+manualDiscountCents;
    const priced=baseSales.applyDiscount(saleId,{discountCents:combined});
    writeState(saleId,{manualDiscountCents,promotionDiscountCents,promotions:promotion.applied||[],blocksManualDiscount:Boolean(promotion.blocksManualDiscount)});
    return enrich(priced);
  }

  function kitSnapshot(productId) {
    const kit=promotionService.getKit?.(productId);
    if(!kit||!kit.active)return null;
    return {
      version:1,
      productId:kit.id,
      name:kit.name,
      components:(kit.components||[]).map(component=>({
        productId:component.productId,
        productName:component.productName||null,
        quantity:Number(component.quantity),
        unit:component.unit||'UN'
      }))
    };
  }

  function assertVariantStock(sale){
    const totals=new Map();
    for(const item of sale?.items||[]){
      const variant=item.configuration?.productVariant||item.configuration?.retailVariant;if(!variant?.id)continue;
      const current=totals.get(String(variant.id))||{quantity:0,label:`${item.productName} - ${variant.name||'variação'}`};
      current.quantity+=Number(item.quantity||0);totals.set(String(variant.id),current);
    }
    for(const [variantId,required] of totals){
      const row=db.prepare(`SELECT v.active,p.active AS product_active,COALESCE(b.quantity,0) AS quantity
        FROM product_variants v JOIN products p ON p.id=v.product_id LEFT JOIN retail_variant_balances b ON b.variant_id=v.id WHERE v.id=?`).get(variantId);
      if(!row||!row.active||!row.product_active)throw new Error(`Variacao inativa ou inexistente: ${required.label}.`);
      if(Number(required.quantity)>Number(row.quantity||0))throw new Error(`Estoque insuficiente para ${required.label}.`);
    }
  }

  function hasActiveVariants(productId){
    if(productId==null)return false;
    return Boolean(db.prepare('SELECT 1 FROM product_variants WHERE product_id=? AND active=1 LIMIT 1').get(String(productId)));
  }

  function openSale(input={},actor=null) {
    const sale=baseSales.openSale(input,actor);
    writeState(sale.id,{manualDiscountCents:0,promotionDiscountCents:0,promotions:[],blocksManualDiscount:false});
    return enrich(sale);
  }
  function setCustomer(id,customerId){baseSales.setCustomer(id,customerId);return reprice(id);}
  function setSeller(id,sellerId,actor=null){return enrich(baseSales.setSeller(id,sellerId,actor));}
  function addItem(id,input={}){
    const kit=kitSnapshot(input.productId);
    if(!kit&&!input.configurationSnapshot&&input.forceSeparateLine!==true&&hasActiveVariants(input.productId))throw new Error('Este produto possui variacoes. Selecione o subitem desejado.');
    if(kit&&!input.configurationSnapshot&&input.forceSeparateLine!==true){
      const current=baseSales.getSale(id);
      const existing=(current?.items||[]).find(item=>item.productId===String(input.productId)&&item.configuration?.kit?.productId===kit.productId);
      if(existing){
        const quantity=Number(existing.quantity||0)+Number(input.quantity??1);
        baseSales.updateItemQuantityById(id,existing.id,quantity);
        return reprice(id);
      }
    }
    const payload=kit?{...input,configurationSnapshot:{...(input.configurationSnapshot||{}),kit}}:input;
    baseSales.addItem(id,payload);return reprice(id);
  }
  function updateItemQuantity(id,productId,quantity){baseSales.updateItemQuantity(id,productId,quantity);return reprice(id);}
  function updateItemQuantityById(id,itemId,quantity){baseSales.updateItemQuantityById(id,itemId,quantity);return reprice(id);}
  function overrideItemPrice(id,itemId,input={}){baseSales.overrideItemPrice(id,itemId,input);return reprice(id);}
  function removeItem(id,productId){baseSales.removeItem(id,productId);return reprice(id);}
  function removeItemById(id,itemId){baseSales.removeItemById(id,itemId);return reprice(id);}
  function applyDiscount(id,{discountCents=0}={}){return reprice(id,discountCents);}
  function suspendSale(id){reprice(id);return enrich(baseSales.suspendSale(id));}
  function resumeSale(id){baseSales.resumeSale(id);return reprice(id);}
  function completeSale(id,input={}){reprice(id);const sale=baseSales.getSale(id);assertVariantStock(sale);persistObservation(id,input);baseSales.completeSale(id,stripObservationTransport(input));return enrich(baseSales.getSale(id));}
  function cancelSale(id,input={}){return enrich(baseSales.cancelSale(id,input));}
  function getSale(id){return enrich(baseSales.getSale(id));}
  function getSaleDetails(id){return enrichCostDetails(baseSales.getSaleDetails(id));}
  function listSales(filters={}){return baseSales.listSales(filters).map(enrich);}
  function listHistory(filters={}){return baseSales.listHistory(filters).map(enrich);}

  return {openSale,setCustomer,setSeller,addItem,updateItemQuantity,updateItemQuantityById,overrideItemPrice,removeItem,removeItemById,applyDiscount,suspendSale,resumeSale,completeSale,cancelSale,getSale,getSaleDetails,listSales,listHistory};
}

module.exports = { createPromotionSaleService };
