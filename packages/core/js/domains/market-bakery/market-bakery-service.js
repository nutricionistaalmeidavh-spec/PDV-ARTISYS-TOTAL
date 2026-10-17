'use strict';

const { randomUUID }=require('node:crypto');
const { writeAudit }=require('../../core/audit-log');
const { roundQuantity }=require('../inventory/inventory-rules');

const BAKERY_TRANSITIONS={OPEN:['READY','CANCELLED'],READY:['PICKED_UP','CANCELLED'],PICKED_UP:[],CANCELLED:[]};

function createMarketBakeryService({db,modules,sales=null,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`,readScale=null}={}){
  if(!db||!modules)throw new TypeError('db and modules are required.');
  const foodGate=()=>modules.requireEnabled('FOOD');

  function product(id){
    const row=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(String(id));
    if(!row)throw new Error('Produto nao encontrado ou inativo.');
    return row;
  }

  function priceWeightedItem({productId,grams}={}){
    const p=product(productId);
    const g=Number(grams);
    if(!Number.isFinite(g)||g<=0)throw new Error('Peso em gramas invalido.');
    const unit=String(p.unit||'UN').toUpperCase();
    if(!['KG','G'].includes(unit))throw new Error('Produto nao configurado para venda por peso.');
    const quantity=unit==='KG'?g/1000:g;
    const totalCents=Math.round(Number(p.sale_price_cents)*quantity);
    return{productId:p.id,grams:roundQuantity(g),quantity:roundQuantity(quantity),unit,totalCents,unitPriceCents:p.sale_price_cents};
  }

  function addWeightedItemToSale(saleId,input={},actor={}){
    if(!sales)throw new Error('Motor canonico de vendas indisponivel para item por peso.');
    const priced=priceWeightedItem(input);
    const source=String(input.source||'MANUAL').toUpperCase();
    if(!['MANUAL','SCALE','BARCODE'].includes(source))throw new Error('Origem de peso invalida.');
    const configurationSnapshot={version:1,weight:{grams:priced.grams,source,unit:priced.unit}};
    const updated=sales.addItem(saleId,{
      productId:priced.productId,
      quantity:priced.quantity,
      unitPriceCents:priced.unitPriceCents,
      configurationSnapshot,
      forceSeparateLine:true
    });
    writeAudit(db,{action:'market.weighted-item.add',entity:'sale',entityId:String(saleId),actor,context:{productId:priced.productId,grams:priced.grams,source}},now);
    return updated;
  }

  async function resolveWeight({manualGrams=null}={}){
    if(manualGrams!=null){
      const grams=Number(manualGrams);
      if(!Number.isFinite(grams)||grams<=0)throw new Error('Peso manual invalido.');
      return{grams:roundQuantity(grams),source:'MANUAL'};
    }
    if(typeof readScale!=='function')throw new Error('Balanca nao configurada; informe o peso manualmente.');
    const value=await readScale();
    const grams=Number(value?.grams??value);
    if(!Number.isFinite(grams)||grams<=0)throw new Error('Leitura de balanca invalida.');
    return{grams:roundQuantity(grams),source:'SCALE'};
  }

  function upsertWeightBarcodeProfile(input={},actor={}){
    const id=String(input.id||idFactory('weight-profile'));
    const name=String(input.name||'').trim();
    const prefix=String(input.prefix||'');
    if(!name||!prefix)throw new Error('Nome e prefixo do perfil sao obrigatorios.');
    const fields=['totalLength','productStart','productLength','weightStart','weightLength','decimalPlaces'];
    const values={};
    for(const field of fields){
      values[field]=Number(input[field]??(field==='decimalPlaces'?3:NaN));
      if(!Number.isInteger(values[field])||values[field]<(field.includes('Start')||field==='decimalPlaces'?0:1))throw new Error(`Campo ${field} invalido.`);
    }
    if(values.productStart+values.productLength>values.totalLength||values.weightStart+values.weightLength>values.totalLength)throw new Error('Posicoes do codigo de balanca excedem o comprimento.');
    const ts=now();
    db.prepare(`INSERT INTO weight_barcode_profiles(id,name,prefix,total_length,product_start,product_length,weight_start,weight_length,decimal_places,active,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,1,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,prefix=excluded.prefix,total_length=excluded.total_length,product_start=excluded.product_start,product_length=excluded.product_length,weight_start=excluded.weight_start,weight_length=excluded.weight_length,decimal_places=excluded.decimal_places,active=1,updated_at=excluded.updated_at`)
      .run(id,name,prefix,values.totalLength,values.productStart,values.productLength,values.weightStart,values.weightLength,values.decimalPlaces,ts,ts);
    writeAudit(db,{action:'market.weight-profile.upsert',entity:'weight_barcode_profile',entityId:id,actor,context:{name,prefix,...values}},now);
    return{id,name,prefix,...values,active:true};
  }

  function parseWeightBarcode(barcode,{profileId=null}={}){
    const code=String(barcode||'').trim();
    const rows=profileId
      ?db.prepare('SELECT * FROM weight_barcode_profiles WHERE id=? AND active=1').all(String(profileId))
      :db.prepare('SELECT * FROM weight_barcode_profiles WHERE active=1 ORDER BY LENGTH(prefix) DESC,id').all();
    const profile=rows.find(row=>code.length===row.total_length&&code.startsWith(row.prefix));
    if(!profile)throw new Error('Formato de codigo de balanca nao suportado.');
    const productCode=code.slice(profile.product_start,profile.product_start+profile.product_length);
    const raw=code.slice(profile.weight_start,profile.weight_start+profile.weight_length);
    if(!/^\d+$/.test(raw)||!/^\d+$/.test(productCode))throw new Error('Codigo de balanca invalido.');
    const weight=Number(raw)/(10**profile.decimal_places);
    return{profileId:profile.id,productCode,weight,unit:'KG',grams:roundQuantity(weight*1000)};
  }

  function mapBakery(row){
    if(!row)return null;
    const items=db.prepare('SELECT id,product_id AS productId,product_name AS productName,quantity,unit_price_cents AS unitPriceCents,total_cents AS totalCents FROM bakery_order_items WHERE bakery_order_id=? ORDER BY id').all(row.id);
    return{id:row.id,customerId:row.customer_id,customerName:row.customer_name,requestedPickupAt:row.requested_pickup_at,status:row.status,note:row.note,cancelReason:row.cancel_reason,createdAt:row.created_at,updatedAt:row.updated_at,items,totalCents:items.reduce((s,i)=>s+i.totalCents,0)};
  }

  function getBakeryOrder(id){
    foodGate();
    const row=db.prepare('SELECT * FROM bakery_orders WHERE id=?').get(String(id));
    if(!row)throw new Error('Encomenda de padaria nao encontrada.');
    return mapBakery(row);
  }

  function createBakeryOrder(input={},actor={}){
    foodGate();
    const name=String(input.customerName||'').trim();
    if(!name)throw new Error('Nome do cliente obrigatorio.');
    const items=Array.isArray(input.items)?input.items:[];
    if(!items.length)throw new Error('Adicione itens a encomenda.');
    const id=String(input.id||idFactory('bakery-order'));
    const ts=now();
    db.prepare(`INSERT INTO bakery_orders(id,customer_id,customer_name,requested_pickup_at,status,note,cancel_reason,created_at,updated_at)
      VALUES(?,?,?,?,'OPEN',?,NULL,?,?)`).run(id,input.customerId||null,name,input.requestedPickupAt||null,String(input.note||'').trim()||null,ts,ts);
    const insert=db.prepare('INSERT INTO bakery_order_items(id,bakery_order_id,product_id,product_name,quantity,unit_price_cents,total_cents) VALUES(?,?,?,?,?,?,?)');
    for(const entry of items){
      const p=product(entry.productId);
      const q=roundQuantity(Number(entry.quantity??1));
      if(q<=0)throw new Error('Quantidade invalida na encomenda.');
      const price=entry.unitPriceCents==null?p.sale_price_cents:Number(entry.unitPriceCents);
      if(!Number.isSafeInteger(price)||price<0)throw new Error('Preco invalido na encomenda.');
      insert.run(idFactory('bakery-item'),id,p.id,p.name,q,price,Math.round(price*q));
    }
    writeAudit(db,{action:'bakery.order.create',entity:'bakery_order',entityId:id,actor,context:{customerName:name,itemCount:items.length}},now);
    return getBakeryOrder(id);
  }

  function updateBakeryOrderStatus(id,status,actor={}){
    foodGate();
    const order=getBakeryOrder(id);
    const next=String(status||'').toUpperCase();
    if(!(BAKERY_TRANSITIONS[order.status]||[]).includes(next))throw new Error(`Transicao de encomenda invalida: ${order.status} -> ${next}.`);
    db.prepare('UPDATE bakery_orders SET status=?,updated_at=? WHERE id=?').run(next,now(),order.id);
    writeAudit(db,{action:'bakery.order.status',entity:'bakery_order',entityId:order.id,actor,context:{from:order.status,to:next}},now);
    return getBakeryOrder(order.id);
  }

  function cancelBakeryOrder(id,reason,actor={}){
    foodGate();
    const order=getBakeryOrder(id);
    if(!BAKERY_TRANSITIONS[order.status]?.includes('CANCELLED'))throw new Error('Encomenda nao pode ser cancelada no status atual.');
    const text=String(reason||'').trim();
    if(!text)throw new Error('Informe o motivo do cancelamento.');
    db.prepare("UPDATE bakery_orders SET status='CANCELLED',cancel_reason=?,updated_at=? WHERE id=?").run(text,now(),order.id);
    writeAudit(db,{action:'bakery.order.cancel',entity:'bakery_order',entityId:order.id,actor,context:{reason:text}},now);
    return getBakeryOrder(order.id);
  }

  return{priceWeightedItem,addWeightedItemToSale,resolveWeight,upsertWeightBarcodeProfile,parseWeightBarcode,createBakeryOrder,getBakeryOrder,updateBakeryOrderStatus,cancelBakeryOrder};
}

module.exports={createMarketBakeryService,BAKERY_TRANSITIONS};
