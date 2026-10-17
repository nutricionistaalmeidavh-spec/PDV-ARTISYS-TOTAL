'use strict';

const {randomUUID}=require('node:crypto');
const {withTransaction}=require('../../core/database/sqlite-database');
const {writeAudit}=require('../../core/audit-log');
const {roundQuantity}=require('../inventory/inventory-rules');
const {assertCents}=require('../shared/money');

const TRANSITIONS={OPEN:['DIAGNOSIS','CANCELLED'],DIAGNOSIS:['QUOTED','CANCELLED'],QUOTED:['APPROVED','CANCELLED'],APPROVED:['IN_PROGRESS','CANCELLED'],IN_PROGRESS:['READY','CANCELLED'],READY:['CLOSED','CANCELLED'],CLOSED:[],CANCELLED:[]};
function required(value,label){const text=String(value||'').trim();if(!text)throw new Error(`${label} obrigatorio.`);return text;}

function createWorkshopService({db,modules,catalog,services,sales,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db||!modules||!catalog||!services||!sales)throw new TypeError('db, modules, catalog, services and sales are required.');
  const gate=()=>modules.requireEnabled('WORKSHOP');

  function mapAsset(row){return row&&{id:row.id,customerId:row.customer_id,kind:row.kind,identifier:row.identifier,make:row.make,model:row.model,year:row.year,notes:row.notes,createdAt:row.created_at,updatedAt:row.updated_at};}
  function getAsset(id){gate();const row=db.prepare('SELECT * FROM workshop_assets WHERE id=?').get(String(id));if(!row)throw new Error('Veiculo/equipamento nao encontrado.');return mapAsset(row);}
  function listAssets(){gate();return db.prepare('SELECT * FROM workshop_assets ORDER BY updated_at DESC,id').all().map(mapAsset);}
  function upsertAsset(input={},actor={}){
    gate();const customer=catalog.getCustomer(input.customerId);if(!customer||!customer.active)throw new Error('Cliente nao encontrado ou inativo.');const id=String(input.id||idFactory('asset')).trim();const kind=String(input.kind||'VEHICLE').toUpperCase();if(!['VEHICLE','EQUIPMENT'].includes(kind))throw new Error('Tipo de bem invalido.');const identifier=required(input.identifier,'Identificador');const ts=now();
    db.prepare(`INSERT INTO workshop_assets(id,customer_id,kind,identifier,make,model,year,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET customer_id=excluded.customer_id,kind=excluded.kind,identifier=excluded.identifier,make=excluded.make,model=excluded.model,year=excluded.year,notes=excluded.notes,updated_at=excluded.updated_at`).run(id,customer.id,kind,identifier,String(input.make||'').trim()||null,String(input.model||'').trim()||null,String(input.year||'').trim()||null,String(input.notes||'').trim()||null,ts,ts);
    writeAudit(db,{action:'workshop.asset.upsert',entity:'workshop_asset',entityId:id,actor,context:{customerId:customer.id,kind,identifier}},now);return getAsset(id);
  }

  function mapItem(row){return{id:row.id,kind:row.kind,productId:row.product_id,serviceId:row.service_id,description:row.description,quantity:row.quantity,unitPriceCents:row.unit_price_cents,totalCents:row.total_cents};}
  function mapOrder(row){if(!row)return null;const items=db.prepare('SELECT * FROM work_order_items WHERE work_order_id=? ORDER BY created_at,id').all(row.id).map(mapItem);return{id:row.id,customerId:row.customer_id,assetId:row.asset_id,status:row.status,complaint:row.complaint,diagnosis:row.diagnosis,quotedTotalCents:row.quoted_total_cents,approvalNote:row.approval_note,approvedAt:row.approved_at,saleId:row.sale_id,cancelReason:row.cancel_reason,createdAt:row.created_at,updatedAt:row.updated_at,items,totalCents:items.reduce((sum,item)=>sum+item.totalCents,0)};}
  function getWorkOrder(id){gate();const row=db.prepare('SELECT * FROM work_orders WHERE id=?').get(String(id));if(!row)throw new Error('Ordem de servico nao encontrada.');return mapOrder(row);}
  function listWorkOrders(){gate();return db.prepare('SELECT * FROM work_orders ORDER BY updated_at DESC,id LIMIT 100').all().map(mapOrder);}
  function openWorkOrder(input={},actor={}){
    gate();const customer=catalog.getCustomer(input.customerId);if(!customer||!customer.active)throw new Error('Cliente nao encontrado ou inativo.');const asset=getAsset(input.assetId);if(asset.customerId!==customer.id)throw new Error('Bem nao pertence ao cliente informado.');const id=String(input.id||idFactory('work-order'));const ts=now();
    db.prepare(`INSERT INTO work_orders(id,customer_id,asset_id,status,complaint,diagnosis,quoted_total_cents,approval_note,approved_at,sale_id,cancel_reason,created_at,updated_at) VALUES(?,?,?,'OPEN',?,NULL,0,NULL,NULL,NULL,NULL,?,?)`).run(id,customer.id,asset.id,String(input.complaint||'').trim()||null,ts,ts);writeAudit(db,{action:'workshop.order.open',entity:'work_order',entityId:id,actor,context:{customerId:customer.id,assetId:asset.id}},now);return getWorkOrder(id);
  }

  function addItem(id,input={},actor={}){
    gate();const order=getWorkOrder(id);if(['CLOSED','CANCELLED'].includes(order.status))throw new Error('Ordem de servico nao aceita novos itens.');const kind=String(input.kind||'').toUpperCase();if(!['PART','LABOR'].includes(kind))throw new Error('Tipo de item da OS invalido.');const quantity=roundQuantity(Number(input.quantity??1));if(quantity<=0)throw new Error('Quantidade invalida.');let productId,serviceId=null,description,price;
    if(kind==='PART'){
      const product=catalog.getProduct(input.productId);if(!product||!product.active)throw new Error('Peca/produto nao encontrado ou inativo.');productId=product.id;description=product.name;price=input.unitPriceCents==null?product.salePriceCents:assertCents(Number(input.unitPriceCents),'unitPriceCents');
    }else{
      const service=services.getService(input.serviceId);if(!service.active)throw new Error('Servico de mao de obra inativo.');productId=service.productId;serviceId=service.id;description=service.name;price=input.unitPriceCents==null?service.priceCents:assertCents(Number(input.unitPriceCents),'unitPriceCents');
    }
    if(price<0)throw new Error('Preco do item da OS invalido.');const ts=now();db.prepare(`INSERT INTO work_order_items(id,work_order_id,kind,product_id,service_id,description,quantity,unit_price_cents,total_cents,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(idFactory('work-item'),order.id,kind,productId,serviceId,description,quantity,price,Math.round(quantity*price),ts);
    db.prepare('UPDATE work_orders SET updated_at=? WHERE id=?').run(ts,order.id);writeAudit(db,{action:'workshop.order.item',entity:'work_order',entityId:order.id,actor,context:{kind,productId,serviceId,quantity,unitPriceCents:price}},now);return getWorkOrder(order.id);
  }

  function updateStatus(id,status,input={},actor={}){
    gate();const order=getWorkOrder(id);const next=String(status||'').toUpperCase();if(!(TRANSITIONS[order.status]||[]).includes(next))throw new Error(`Transicao de OS invalida: ${order.status} -> ${next}.`);if(next==='CLOSED')throw new Error('Fechamento da OS deve ocorrer pela venda canonica.');const ts=now();let diagnosis=order.diagnosis;let quoted=order.quotedTotalCents;let approval=order.approvalNote;let approvedAt=order.approvedAt;
    if(next==='DIAGNOSIS')diagnosis=required(input.diagnosis,'Diagnostico');
    if(next==='QUOTED'){const current=getWorkOrder(id);if(!current.items.length)throw new Error('Adicione itens antes de gerar o orcamento.');quoted=current.totalCents;}
    if(next==='APPROVED'){approval=required(input.approvalNote,'Aprovacao manual');approvedAt=ts;}
    db.prepare('UPDATE work_orders SET status=?,diagnosis=?,quoted_total_cents=?,approval_note=?,approved_at=?,updated_at=? WHERE id=?').run(next,diagnosis,quoted,approval,approvedAt,ts,order.id);writeAudit(db,{action:'workshop.order.status',entity:'work_order',entityId:order.id,actor,context:{from:order.status,to:next,approvalNote:next==='APPROVED'?approval:undefined}},now);return getWorkOrder(order.id);
  }

  function cancel(id,reason,actor={}){
    gate();const order=getWorkOrder(id);if(!TRANSITIONS[order.status]?.includes('CANCELLED'))throw new Error('OS nao pode ser cancelada no status atual.');const text=required(reason,'Motivo do cancelamento');db.prepare("UPDATE work_orders SET status='CANCELLED',cancel_reason=?,updated_at=? WHERE id=?").run(text,now(),order.id);writeAudit(db,{action:'workshop.order.cancel',entity:'work_order',entityId:order.id,actor,context:{reason:text}},now);return getWorkOrder(order.id);
  }

  function createSale(id,input={},actor={}){
    gate();const order=getWorkOrder(id);if(order.saleId)return sales.getSale(order.saleId);if(order.status!=='READY')throw new Error('OS deve estar pronta para fechamento.');const terminalId=required(input.terminalId,'Terminal');const operatorId=required(input.operatorId,'Operador');if(!order.items.length)throw new Error('OS sem itens para venda.');
    return withTransaction(db,()=>{const sale=sales.openSale({terminalId,operatorId,customerId:order.customerId},actor);for(const item of order.items)sales.addItem(sale.id,{productId:item.productId,quantity:item.quantity,unitPriceCents:item.unitPriceCents,configurationSnapshot:{version:1,workOrder:{id:order.id,itemId:item.id,kind:item.kind,serviceId:item.serviceId}},forceSeparateLine:true});const ts=now();db.prepare("UPDATE work_orders SET status='CLOSED',sale_id=?,updated_at=? WHERE id=?").run(sale.id,ts,order.id);writeAudit(db,{action:'workshop.order.sale',entity:'work_order',entityId:order.id,actor,context:{saleId:sale.id}},now);return sales.getSale(sale.id);});
  }

  return{upsertAsset,getAsset,listAssets,openWorkOrder,getWorkOrder,listWorkOrders,addItem,updateStatus,cancel,createSale,TRANSITIONS};
}
module.exports={createWorkshopService,TRANSITIONS};
