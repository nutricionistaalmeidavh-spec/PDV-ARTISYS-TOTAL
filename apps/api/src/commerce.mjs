// D1 persistence adapter for the one PDV domain. Arithmetic, stock rounding and
// payment rules are imported unchanged from packages/core; this is NOT a second core.
import salePricing from '../../../packages/core/js/domains/sales/pricing.js';
import paymentRules from '../../../packages/core/js/domains/payments/payment-rules.js';
import inventoryRules from '../../../packages/core/js/domains/inventory/inventory-rules.js';
import cashRules from '../../../packages/core/js/domains/cash/cash-rules.js';
import {createSaleReturnAdapter} from './sale-reversals.mjs';
import {createLotLedger} from './inventory-lot-ledger.mjs';
import {createCatalogDepthService} from './catalog-depth.mjs';
import {createPurchasingService} from './purchasing.mjs';
import {createCatalogImportService} from './catalog-import.mjs';
import {createHistoricalMarginService} from './historical-margin.mjs';
import {createReportDepthService} from './report-depth.mjs';
import {createCheckoutConfigurationService} from './checkout-configuration.mjs';
import {createSellerTargetService} from './seller-targets.mjs';

const {calculateSaleTotals,allocateSaleDiscount}=salePricing;
const {resolvePayment,normalizeMethod}=paymentRules;
const {roundQuantity}=inventoryRules;
const {calculateCashClosing}=cashRules;
const MAX_LINES=80;
const canonicalTerminalId=(raw)=>{
  const id=String(raw??'DEFAULT').trim();
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id))throw error(400,'Identificador do terminal inválido.');
  return id;
};
const nowISO=()=>new Date().toISOString();
const randomId=()=>crypto.randomUUID();
const error=(status,message)=>Object.assign(new Error(message),{status});
const allowedPayments=new Set(['CASH','PIX','DEBIT_CARD','CREDIT_CARD','OTHER','STORE_CREDIT']);
const validKey=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(value);
const text=(value,max=120)=>typeof value==='string'?value.trim().slice(0,max):'';
const integer=(value,max=1_000_000_000)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const quantityMilli=value=>{
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>100000)return null;
  const rounded=roundQuantity(value);
  if(Math.abs(value-rounded)>0.00000001)return null;
  const result=Math.round(rounded*1000);
  return Number.isSafeInteger(result)&&result>0?result:null;
};
const {hasOwnProperty}=Object.prototype;
const has=(object,key)=>hasOwnProperty.call(object,key);

function sqlError(e){
  const message=String(e?.message||e);
  if(/RESERVED_STOCK_UNAVAILABLE|RESERVATION_STOCK_INSUFFICIENT|KIT_DEFINITION_INVALID|PRODUCT_REFERENCE_TENANT_MISMATCH/i.test(message))return error(409,'Saldo reservado ou vínculo de catálogo incompatível. Atualize e tente novamente.');
  if(/CHECK constraint failed: stock_positions|CHECK constraint failed:.*balance_milli|INSUFFICIENT_STOCK/i.test(message))return error(409,'Estoque insuficiente. Atualize a disponibilidade e tente novamente.');
  if(/PRODUCT_UNIT_WITH_HISTORY/i.test(message))return error(409,'A unidade de produto com venda ou estoque histórico não pode mudar.');
  if(/PRODUCT_HAS_PENDING_SALE/i.test(message))return error(409,'Finalize ou cancele as vendas abertas antes de desativar o produto.');
  if(/CASH_SESSION_NOT_OPEN/i.test(message))return error(409,'O caixa foi fechado. Abra outro antes de finalizar.');
  if(/CASH_INSUFFICIENT/i.test(message))return error(409,'Saldo físico insuficiente para a sangria.');
  if(/CASH_CLOSING_STALE/i.test(message))return error(409,'O saldo do caixa mudou. Atualize e confira novamente.');
  if(/REFUND_TENDER_EXCEEDED|RETURN_QUANTITY_EXCEEDED|CREDIT_REVERSAL_OVERPAYMENT|FINANCE_REVERSAL_INVALID/i.test(message))return error(409,'Reversão já registrada ou saldo de restituição insuficiente.');
  if(/CREDIT_LIMIT_EXCEEDED/i.test(message))return error(409,'Limite de crédito insuficiente. Atualize a ficha do cliente.');
  if(/FINANCE_OVERPAY_OR_CANCELLED/i.test(message))return error(409,'A conta mudou de situação ou o pagamento excede o saldo.');
  if(/SALE_NOT_OPEN|FINAL_SALE_IMMUTABLE/i.test(message))return error(409,'Esta venda mudou de estado. Atualize antes de continuar.');
  if(/UNIQUE constraint failed|constraint failed/i.test(message))return error(409,'Registro já alterado. Atualize os dados e tente novamente.');
  return e;
}

function formatSale(sale,items=[],payments=[]){
  return {
    id:sale.id,tenantId:sale.tenant_id,branchId:sale.branch_id,
    saleNumber:sale.sale_number,operatorId:sale.operator_id,terminalId:sale.terminal_id||'DEFAULT',
    status:sale.status,customerId:sale.customer_id||null,sellerId:sale.seller_id||sale.operator_id,subtotalCents:sale.subtotal_cents,
    discountCents:sale.discount_cents,totalCents:sale.total_cents,
    changeCents:sale.change_cents,completedAt:sale.completed_at,
    items:items.map(row=>({
      id:row.id,productId:row.product_id,productName:row.product_name,
      sku:row.sku,quantity:row.quantity_milli/1000,
      unitPriceCents:row.unit_price_cents,
      catalogUnitPriceCents:row.catalog_unit_price_cents??row.unit_price_cents,
      priceOverrideReason:row.price_override_reason||null,
      note:row.note||'',
      configuration:row.configuration_json?JSON.parse(row.configuration_json):null,
      totalCents:Math.round((row.quantity_milli/1000)*row.unit_price_cents)
    })),
    payments:payments.map(row=>({id:row.id,method:row.method,amountCents:row.amount_cents}))
  };
}

export function createCommerceService(db,{now=nowISO}={}){
  const q=(sql,...params)=>db.prepare(sql).bind(...params);
  const first=(sql,...params)=>q(sql,...params).first();
  const all=async(sql,...params)=>(await q(sql,...params).all()).results;
  const run=(sql,...params)=>q(sql,...params).run();
  async function batch(statements){
    try{return await db.batch(statements);}
    catch(e){throw sqlError(e);}
  }
  const applied=async(tenant,scope,key)=>{
    if(!validKey(key))throw error(400,'Identificador da operação obrigatório.');
    const row=await first('SELECT result_json FROM commerce_mutations WHERE tenant_id=? AND scope=? AND mutation_id=?',tenant,scope,key);
    return row?JSON.parse(row.result_json):null;
  };
  const stamp=()=>now();
  const audit=(tenant,scope,key,result)=>q(
    'INSERT INTO commerce_mutations(tenant_id,scope,mutation_id,result_json,occurred_at) VALUES(?,?,?,?,?)',
    tenant,scope,key,JSON.stringify(result),stamp());
  const tenantSale=async(tenant,branch,id)=>{
    const row=await first('SELECT * FROM sales WHERE id=? AND tenant_id=? AND branch_id=?',id,tenant,branch);
    if(!row)throw error(404,'Venda não encontrada.');
    return row;
  };
  const saleSnapshot=async(sale)=>{
    const items=await all(`SELECT i.*,
      (SELECT o.reason FROM sale_item_price_overrides o
       WHERE o.sale_item_id=i.id ORDER BY o.created_at DESC,o.id DESC LIMIT 1) AS price_override_reason
      FROM sale_items i WHERE i.sale_id=? ORDER BY i.created_at,i.id`,sale.id);
    const payments=await all('SELECT * FROM sale_payments WHERE sale_id=? ORDER BY created_at,id',sale.id);
    // A store-credit tender belongs to the credit ledger, not to cash or card payments.
    const credit=await all("SELECT id,'STORE_CREDIT' AS method,amount_cents AS amount_cents FROM customer_credit_ledger WHERE tenant_id=? AND branch_id=? AND sale_id=? AND type='CHARGE'",sale.tenant_id,sale.branch_id,sale.id);
    const returns=await first('SELECT COALESCE(SUM(amount_cents),0) AS refundedCents FROM sale_returns WHERE tenant_id=? AND branch_id=? AND sale_id=?',sale.tenant_id,sale.branch_id,sale.id);
    const original=formatSale(sale,items,[...payments,...credit]);
    return {...original,refundedCents:returns.refundedCents,netTotalCents:original.totalCents-returns.refundedCents};
  };
  const requireOpen=sale=>{if(sale.status!=='OPEN')throw error(409,'Esta venda não está aberta. Atualize e continue.');};
  const branchExists=async(tenant,branch)=>{
    if(!branch||typeof branch!=='string'||branch.length>128)throw error(400,'Selecione a filial.');
    const row=await first('SELECT id FROM branches WHERE tenant_id=? AND id=? AND active=1',tenant,branch);
    if(!row)throw error(404,'Filial não encontrada neste estabelecimento.');
    return branch;
  };
  const product=async(tenant,id)=>{
    const row=await first('SELECT * FROM products WHERE id=? AND tenant_id=? AND active=1',id,tenant);
    if(!row)throw error(404,'Produto não encontrado neste estabelecimento.');
    return row;
  };
  const requiredNumber=(value,label,max=1_000_000_000)=>{
    if(!integer(value,max))throw error(400,label+' deve ser um valor inteiro válido.');
    return value;
  };
  const requiredMutation=(body,header)=>{
    const key=String(header||body?.mutationId||'');
    if(!validKey(key))throw error(400,'Identificador único da operação obrigatório.');
    return key;
  };

  const cashSession=async(tenant,branch,id)=>{
    const row=await first('SELECT * FROM cash_sessions WHERE tenant_id=? AND branch_id=? AND id=?',tenant,branch,id);
    if(!row)throw error(404,'Caixa não encontrado.');
    return row;
  };
  const cashLines=async(tenant,branch,id)=>{
    const sales=await all(`SELECT cm.id,cm.method AS paymentMethod,cm.amount_cents AS amountCents,
      cm.created_at AS createdAt,'SALE' AS type,cm.sale_id AS saleId
      FROM cash_movements cm WHERE cm.tenant_id=? AND cm.branch_id=?
        AND cm.cash_session_id=? ORDER BY cm.created_at,cm.id`,tenant,branch,id);
    const adjustments=await all(`SELECT id,'CASH' AS paymentMethod,amount_cents AS amountCents,
      created_at AS createdAt,type, NULL AS saleId,note FROM cash_adjustments
      WHERE tenant_id=? AND branch_id=? AND cash_session_id=? ORDER BY created_at,id`,tenant,branch,id);
    // Credit repayments are receivable settlements, not second sales.
    // CASH repayments must still enter the real cash drawer reconciliation.
    const credits=await all(`SELECT id,method AS paymentMethod,amount_cents AS amountCents,
      received_at AS createdAt,'SALE' AS type,NULL AS saleId,customer_id AS customerId
      FROM customer_credit_receipts WHERE tenant_id=? AND branch_id=? AND cash_session_id=?
      ORDER BY received_at,id`,tenant,branch,id);
    const refunds=await all("SELECT id,'CASH' AS paymentMethod,amount_cents AS amountCents,created_at AS createdAt,'REVERSAL' AS type,sale_id AS saleId FROM sale_refund_movements WHERE tenant_id=? AND branch_id=? AND cash_session_id=? AND method='CASH'",tenant,branch,id);
    return [...sales,...adjustments,...credits,...refunds].sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))||String(a.id).localeCompare(String(b.id)));
  };
  const cashClosing=async(tenant,branch,session,countedCashCents=0)=>{
    const lines=await cashLines(tenant,branch,session.id);
    // Reuse original authoritative closing arithmetic: noncash tenders never
    // count toward expected physical cash.
    const closing=calculateCashClosing({
      initialCashCents:session.opening_cents,movements:lines,
      countedByMethod:{CASH:countedCashCents}
    });
    return {closing,lines};
  };
  const financeRow=async(tenant,branch,id)=>{
    const row=await first(`SELECT e.id,e.tenant_id AS tenantId,e.branch_id AS branchId,
      e.description,e.kind,e.amount_cents AS amountCents,e.due_date AS dueDate,
      e.created_at AS createdAt,e.cancelled_at AS cancelledAt,
      COALESCE(SUM(f.amount_cents-COALESCE(r.amount_cents,0)),0) AS settledCents
      FROM finance_entries e LEFT JOIN finance_settlements f ON f.entry_id=e.id
      LEFT JOIN finance_settlement_reversals r ON r.settlement_id=f.id
      WHERE e.id=? AND e.tenant_id=? AND e.branch_id=? GROUP BY e.id`,id,tenant,branch);
    if(!row)throw error(404,'Lançamento financeiro não encontrado.');
    const openCents=row.amountCents-row.settledCents;
    return {...row,openCents,status:row.cancelledAt?'CANCELLED':openCents===0?'SETTLED':row.settledCents?'PARTIAL':'OPEN'};
  };
  const dateWindow=value=>{
    if(value==null||value==='')return null;
    if(typeof value!=='string'||!/^(20\d\d)-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)||
      !Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)
      throw error(400,'Data inválida: informe AAAA-MM-DD.');
    return value;
  };
  const period=({from='',to=''}={})=>{
    const a=dateWindow(from),b=dateWindow(to);
    if(a&&b&&a>b)throw error(400,'O início não pode ser posterior ao fim.');
    if(a&&b&&(Date.parse(b)-Date.parse(a))>366*86400000)
      throw error(400,'Máximo de 366 dias por consulta.');
    return {a:a?a+'T00:00:00.000Z':'0000',b:b?b+'T23:59:59.999Z':'9999'};
  };
  const snapshot=async(tenant,branch,id)=>{
    const s=await tenantSale(tenant,branch,id);
    const view=await saleSnapshot(s);
    if(s.status==='OPEN'||s.status==='SUSPENDED'){
      const totals=calculateSaleTotals({items:view.items,discountCents:s.discount_cents});
      return {...view,...totals};
    }
    return view;
  };
  const snapshotAfterCartChange=async(tenant,branch,id)=>{
    // The original desktop recalculate() caps persisted discounts whenever a
    // line is added, removed, re-priced, or its quantity changes. Keep the
    // original single-sale ledger and avoid a latent over-discount on re-add.
    await run(`UPDATE sales SET discount_cents=MIN(discount_cents,COALESCE((
        SELECT SUM(ROUND(unit_price_cents*quantity_milli/1000.0)) FROM sale_items
        WHERE sale_id=sales.id AND tenant_id=sales.tenant_id AND branch_id=sales.branch_id
      ),0)) WHERE id=? AND tenant_id=? AND branch_id=? AND status='OPEN'`,id,tenant,branch);
    return snapshot(tenant,branch,id);
  };
  const listing=async(tenant,branch,limit=25,status=null)=>{
    await branchExists(tenant,branch);
    const n=Number.isInteger(limit)?Math.min(50,Math.max(1,limit)):25;
    const allowed=['OPEN','SUSPENDED','COMPLETED','CANCELLED'];
    if(status&& !allowed.includes(status))throw error(400,'Estado da venda inválido.');
    const rows=status
      ?await all('SELECT id FROM sales WHERE tenant_id=? AND branch_id=? AND status=? ORDER BY created_at DESC,id DESC LIMIT ?',tenant,branch,status,n)
      :await all('SELECT id FROM sales WHERE tenant_id=? AND branch_id=? ORDER BY created_at DESC,id DESC LIMIT ?',tenant,branch,n);
    return Promise.all(rows.map(row=>snapshot(tenant,branch,row.id)));
  };
  // One inventory/cost posting implementation for both direct receipts and
  // ordered receiving. Every caller includes all statements in one D1 batch.
  const ledgerReceipt=(tenant,branch,user,productId,milli,cost,supplierId,key,at,movementId,kind='purchase')=>{
    const statements=[q(`INSERT INTO inventory_movements
      (id,tenant_id,branch_id,product_id,delta_milli,type,sale_id,mutation_id,occurred_at)
      VALUES(?,?,?,?,?,?,NULL,?,?)`,movementId,tenant,branch,productId,milli,kind,key,at)];
    if(cost!=null){
      statements.push(q(`INSERT INTO purchase_cost_history
        (id,tenant_id,branch_id,product_id,movement_id,supplier_id,unit_cost_cents,quantity_milli,operator_id,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`,randomId(),tenant,branch,productId,movementId,supplierId,cost,milli,user,at));
      statements.push(q('UPDATE products SET last_cost_cents=?,updated_at=? WHERE tenant_id=? AND id=?',cost,at,tenant,productId));
    }
    return statements;
  };
  const lotLedger=createLotLedger({all,q,randomId,error});
  const purchasing=createPurchasingService({q,first,all,batch,applied,audit,stamp,branchExists,
    requiredMutation,quantityMilli,error,text,randomId,ledgerReceipt});
  const catalogImporter=createCatalogImportService({q,first,batch,applied,audit,stamp,branchExists,requiredMutation,error,text,randomId});
  const historicalMargin=createHistoricalMarginService({all,branchExists,period,allocateSaleDiscount,error});
  const reportDepth=(salesHistory)=>createReportDepthService({all,branchExists,period,stamp,error,salesHistory});
  const checkoutConfig=createCheckoutConfigurationService({q,first,batch,applied,audit,stamp,branchExists,product,requiredMutation,error});
  const sellerTargets=createSellerTargetService({q,first,all,batch,applied,audit,stamp,branchExists,requiredMutation,error});
  const catalogDepth=createCatalogDepthService({q,first,all,batch,applied,audit,stamp,branchExists,requiredMutation,
    quantityMilli,error,text,randomId});
  const saleReversals=createSaleReturnAdapter({
    q,first,all,batch,applied,audit,stamp,tenantSale,requiredMutation,quantityMilli,lotLedger,
    normalizeMethod,allocateSaleDiscount,error,text,randomId,
    getCash:async(tenant,branch,terminalId='DEFAULT')=>{
      const session=await first("SELECT * FROM cash_sessions WHERE tenant_id=? AND branch_id=? AND terminal_id=? AND status='OPEN' LIMIT 1",tenant,branch,canonicalTerminalId(terminalId));
      if(!session)return null;
      const {closing}=await cashClosing(tenant,branch,session,0);
      return {id:session.id,expectedCashCents:closing.expectedCashCents};
    }
  });
  return {
    saveSellerSalesTarget:(t,b,u,body,key)=>sellerTargets.save(t,b,u,body,key),
    sellerSalesRanking:(t,b,filters)=>sellerTargets.ranking(t,b,filters),
    checkoutProductConfiguration:(t,b,id)=>checkoutConfig.configuration(t,b,id),
    saveCheckoutProductConfiguration:(t,b,id,body,key)=>checkoutConfig.save(t,b,id,body,key),
    priceCheckoutProductConfiguration:(t,b,id,body)=>checkoutConfig.quote(t,b,id,body),
    marginReport:(t,b,filters)=>historicalMargin.margin(t,b,filters),
    reportDetails(tenant,branch,filters){return reportDepth((...args)=>this.salesHistory(...args)).details(tenant,branch,filters);},
    reportDetailsCsv(tenant,branch,filters){return reportDepth((...args)=>this.salesHistory(...args)).detailedCsv(tenant,branch,filters);},
    reportStockCoverage(tenant,branch,filters){return reportDepth((...args)=>this.salesHistory(...args)).stockCoverage(tenant,branch,filters);},
    previewCatalogImport:(t,b,body)=>catalogImporter.preview(t,b,body),
    commitCatalogImport:(t,b,u,body,key)=>catalogImporter.commit(t,b,u,body,key),
    createPurchaseOrder:(t,b,u,body,key)=>purchasing.createPurchaseOrder(t,b,u,body,key),
    purchaseOrders:(t,b)=>purchasing.purchaseOrders(t,b),
    purchaseOrder:(t,b,id)=>purchasing.purchaseOrder(t,b,id),
    receivePurchaseOrder:(t,b,id,u,body,key)=>purchasing.receivePurchaseOrder(t,b,id,u,body,key),
    cancelPurchaseOrder:(t,b,id,u,body,key)=>purchasing.cancelPurchaseOrder(t,b,id,u,body,key),
    purchaseCostSummary:(t,b,filters)=>purchasing.purchaseCostSummary(t,b,filters),
    categories:(t,b)=>catalogDepth.categories(t,b),
    createCategory:(t,b,u,body,key)=>catalogDepth.createCategory(t,b,u,body,key),
    productBundle:(t,b,id)=>catalogDepth.bundle(t,b,id),
    setBundle:(t,b,id,u,body,key)=>catalogDepth.setBundle(t,b,id,u,body,key),
    reserveStock:(t,b,u,body,key)=>catalogDepth.reserveStock(t,b,u,body,key),
    releaseReservation:(t,b,id,u,key)=>catalogDepth.releaseReservation(t,b,id,u,key),
    stockReservations:(t,b,filters)=>catalogDepth.reservations(t,b,filters),
    purchaseCosts:(t,b,filters)=>catalogDepth.purchaseCosts(t,b,filters),
    async salesHistory(tenant,branch,filters={}){
      await branchExists(tenant,branch);
      const status=text(filters.status||'',32).toUpperCase();
      if(status&&!['OPEN','SUSPENDED','COMPLETED','CANCELLED'].includes(status))
        throw error(400,'Situação de venda inválida.');
      const {a,b}=period({from:filters.from||'',to:filters.to||''});
      const limit=Number(filters.limit??25),offset=Number(filters.offset??0);
      if(!Number.isInteger(limit)||limit<1||limit>100||
         !Number.isInteger(offset)||offset<0||offset>5000)
        throw error(400,'Paginação inválida: limite 1–100 e offset 0–5000.');
      const clauses=['tenant_id=?','branch_id=?','COALESCE(completed_at,created_at)>=?',
        'COALESCE(completed_at,created_at)<=?'];
      const args=[tenant,branch,a,b];
      if(status){clauses.push('status=?');args.push(status);}
      const operator=text(filters.operatorId||'',128);
      if(operator){clauses.push('operator_id=?');args.push(operator);}
      const seller=text(filters.sellerId||'',128);
      if(seller){clauses.push('seller_id=?');args.push(seller);}
      const customer=text(filters.customerId||'',128);
      if(customer){clauses.push('customer_id=?');args.push(customer);}
      const productId=text(filters.productId||'',128);
      if(productId){
        clauses.push('EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id=sales.id AND si.tenant_id=sales.tenant_id AND si.branch_id=sales.branch_id AND si.product_id=?)');
        args.push(productId);
      }
      const method=text(filters.paymentMethod||'',32).toUpperCase();
      if(method&&!allowedPayments.has(method))throw error(400,'Forma de pagamento inválida.');
      if(method==='STORE_CREDIT'){
        clauses.push("EXISTS (SELECT 1 FROM customer_credit_ledger cl WHERE cl.sale_id=sales.id AND cl.tenant_id=sales.tenant_id AND cl.branch_id=sales.branch_id AND cl.type='CHARGE')");
      }else if(method){
        clauses.push('EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id=sales.id AND sp.tenant_id=sales.tenant_id AND sp.branch_id=sales.branch_id AND sp.method=?)');
        args.push(method);
      }
      const query=text(filters.query||'',90);
      if(query){clauses.push('instr(lower(sale_number),lower(?))>0');args.push(query);}
      const where=clauses.join(' AND ');
      const count=await first('SELECT COUNT(*) AS total FROM sales WHERE '+where,...args);
      const rows=await all(`SELECT id FROM sales WHERE ${where}
        ORDER BY COALESCE(completed_at,created_at) DESC,id DESC LIMIT ? OFFSET ?`,
        ...args,limit,offset);
      return {items:await Promise.all(rows.map(row=>snapshot(tenant,branch,row.id))),
        total:count.total,limit,offset};
    },
    async inventoryMovements(tenant,branch,filters={}){
      await branchExists(tenant,branch);
      const productId=text(filters.productId||'',128),type=text(filters.type||'',30);
      if(type&&!['opening','purchase','adjustment','sale','return'].includes(type))
        throw error(400,'Tipo de movimentação inválido.');
      if(productId){
        const p=await first('SELECT id FROM products WHERE tenant_id=? AND id=?',tenant,productId);
        if(!p)throw error(404,'Produto não encontrado nesta empresa.');
      }
      const limit=Number(filters.limit??100),offset=Number(filters.offset??0);
      if(!Number.isInteger(limit)||limit<1||limit>100||
        !Number.isInteger(offset)||offset<0||offset>5000)
        throw error(400,'Paginação inválida.');
      const {a,b}=period({from:filters.from||'',to:filters.to||''});
      const clauses=['tenant_id=?','branch_id=?','occurred_at>=?','occurred_at<=?'];
      const args=[tenant,branch,a,b];
      if(productId){clauses.push('product_id=?');args.push(productId);}
      if(type){clauses.push('type=?');args.push(type);}
      const where=clauses.join(' AND ');
      const total=await first('SELECT COUNT(*) AS total FROM inventory_movements WHERE '+where,...args);
      const rows=await all(`SELECT id,product_id AS productId,branch_id AS branchId,
        type,delta_milli/1000.0 AS quantityDelta,reason,mutation_id AS mutationId,
        sale_id AS saleId,occurred_at AS occurredAt
        FROM inventory_movements WHERE ${where}
        ORDER BY occurred_at DESC,rowid DESC LIMIT ? OFFSET ?`,...args,limit,offset);
      return {items:rows,total:total.total,limit,offset};
    },
    async adjustStock(tenant,branch,body,header){
      await branchExists(tenant,branch);
      const key=requiredMutation(body,header),scope='inventory.adjust:'+branch;
      const previous=await applied(tenant,scope,key);if(previous)return previous;
      const p=await product(tenant,body?.productId);
      if(!p.track_stock)throw error(409,'Produto não controla estoque físico.');
      const amount=body?.quantityDelta;
      if(typeof amount!=='number'||!Number.isFinite(amount)||amount===0)
        throw error(400,'Informe variação positiva ou negativa válida.');
      const milli=quantityMilli(Math.abs(amount));
      if(!milli)throw error(400,'Informe quantidade com até três casas decimais.');
      const reason=text(body?.reason,240);
      if(reason.length<3)throw error(400,'Ajuste exige justificativa.');
      const delta=amount>0?milli:-milli;
      const result={movementId:randomId(),productId:p.id,branchId:branch,
        quantityDelta:delta/1000,reason,type:'adjustment'};
      const at=stamp(),chosen=delta<0?await lotLedger.consume(tenant,branch,p.id,-delta):[];
      await batch([
        q(`INSERT INTO inventory_movements
          (id,tenant_id,branch_id,product_id,delta_milli,type,sale_id,mutation_id,occurred_at,reason)
          VALUES(?,?,?,?,?,?,?,?,?,?)`,
          result.movementId,tenant,branch,p.id,delta,'adjustment',null,key,at,reason),
        ...lotLedger.statements(tenant,branch,p.id,result.movementId,chosen,-1,at),
        audit(tenant,scope,key,result)
      ]);
      return result;
    },
    // Counted stock is an adjustment to the existing immutable stock ledger,
    // not a second mutable stock balance. The client must prove what it saw.
    async countStock(tenant,branch,user,body,header){
      await branchExists(tenant,branch);
      const key=requiredMutation(body,header),scope='inventory.count:'+branch;
      const prior=await applied(tenant,scope,key);if(prior)return prior;
      const p=await product(tenant,body?.productId);
      if(!p.track_stock)throw error(409,'Produto não controla estoque físico.');
      const parseCount=(value,label)=>{
        if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100000||
           Math.abs(value-roundQuantity(value))>0.00000001)
          throw error(400,label+' deve ser positiva ou zero, com até três casas decimais.');
        return Math.round(roundQuantity(value)*1000);
      };
      const expectedMilli=parseCount(body?.expectedQuantity,'Saldo esperado');
      const countedMilli=parseCount(body?.countedQuantity,'Quantidade contada');
      const reason=text(body?.reason,240);
      if(reason.length<3)throw error(400,'Inventário contado exige justificativa.');
      const existing=await first('SELECT balance_milli AS milli FROM stock_positions WHERE tenant_id=? AND branch_id=? AND product_id=?',tenant,branch,p.id);
      if((existing?.milli||0)!==expectedMilli)
        throw error(409,'O saldo mudou desde a contagem. Atualize o inventário antes de confirmar.');
      const delta=countedMilli-expectedMilli,at=stamp();
      const result={movementId:delta?randomId():null,productId:p.id,branchId:branch,
        quantityBefore:expectedMilli/1000,quantityDelta:delta/1000,
        quantityAfter:countedMilli/1000,reason,type:'inventory-count',operatorId:user};
      // A nonzero delta is checked a SECOND time inside the write statement.
      // If another terminal changes stock between read and write, CHECK(delta<>0)
      // aborts the whole batch (including the idempotency record).
      const commands=[];
      if(delta)commands.push(q(`INSERT INTO inventory_movements
        (id,tenant_id,branch_id,product_id,delta_milli,type,sale_id,mutation_id,occurred_at,reason)
        SELECT ?,?,?,?,
          CASE WHEN COALESCE((SELECT balance_milli FROM stock_positions
            WHERE tenant_id=? AND branch_id=? AND product_id=?),0)=?
          THEN ? ELSE 0 END,'adjustment',NULL,?,?,?`,
        result.movementId,tenant,branch,p.id,tenant,branch,p.id,expectedMilli,delta,key,at,reason));
      if(delta<0){
        const chosen=await lotLedger.consume(tenant,branch,p.id,-delta);
        commands.push(...lotLedger.statements(tenant,branch,p.id,result.movementId,chosen,-1,at));
      }
      commands.push(audit(tenant,scope,key,result));
      await batch(commands);
      return result;
    },
    async transferStock(tenant,branch,user,body,header){
      await branchExists(tenant,branch);
      const target=String(body?.toBranchId||'').trim();
      if(!target||target===branch)throw error(400,'Selecione uma filial de destino diferente da origem.');
      await branchExists(tenant,target);
      const key=requiredMutation(body,header),scope='inventory.transfer:'+branch;
      const prior=await applied(tenant,scope,key);if(prior)return prior;
      const item=await product(tenant,body?.productId);
      if(!item.track_stock)throw error(409,'Produto não controla estoque físico.');
      const milli=quantityMilli(body?.quantity);
      if(!milli)throw error(400,'Informe quantidade positiva com até três casas decimais.');
      const reason=text(body?.reason,240);
      if(reason.length<3)throw error(400,'Transferência exige justificativa.');
      const stock=await first('SELECT balance_milli FROM stock_positions WHERE tenant_id=? AND branch_id=? AND product_id=?',
        tenant,branch,item.id);
      if((stock?.balance_milli||0)<milli)throw error(409,'Estoque insuficiente na filial de origem.');
      const id=randomId(),sourceMovementId=randomId(),destinationMovementId=randomId(),at=stamp();
      const result={id,fromBranchId:branch,toBranchId:target,productId:item.id,
        quantity:milli/1000,reason,sourceMovementId,destinationMovementId,createdAt:at};
      // FEFO picks identified lots; any remaining quantity is unlabeled stock.
      const chosen=await lotLedger.consume(tenant,branch,item.id,milli);
      // The stock projection is updated solely by immutable ledger triggers.
      // The two legs, transfer linkage and idempotency proof commit together.
      await batch([
        q(`INSERT INTO inventory_movements
          (id,tenant_id,branch_id,product_id,delta_milli,type,sale_id,mutation_id,occurred_at,reason)
          VALUES(?,?,?,?,?,?,?,?,?,?)`,
          sourceMovementId,tenant,branch,item.id,-milli,'adjustment',null,key,at,
          'Transferência '+id+' para '+target+': '+reason),
        ...lotLedger.statements(tenant,branch,item.id,sourceMovementId,chosen,-1,at),
        q(`INSERT INTO inventory_movements
          (id,tenant_id,branch_id,product_id,delta_milli,type,sale_id,mutation_id,occurred_at,reason)
          VALUES(?,?,?,?,?,?,?,?,?,?)`,
          destinationMovementId,tenant,target,item.id,milli,'adjustment',null,key,at,
          'Transferência '+id+' de '+branch+': '+reason),
        ...lotLedger.statements(tenant,target,item.id,destinationMovementId,chosen,1,at),
        q(`INSERT INTO inventory_transfers
          (id,tenant_id,from_branch_id,to_branch_id,product_id,quantity_milli,reason,
           source_movement_id,destination_movement_id,operator_id,mutation_id,created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
          id,tenant,branch,target,item.id,milli,reason,sourceMovementId,destinationMovementId,user,key,at),
        audit(tenant,scope,key,result)
      ]);
      return result;
    },
    async stockTransfers(tenant,branch,{limit=50}={}){
      await branchExists(tenant,branch);
      const cap=Math.min(100,Math.max(1,Math.trunc(Number(limit)||50)));
      return all(`SELECT id,from_branch_id AS fromBranchId,to_branch_id AS toBranchId,
        product_id AS productId,quantity_milli/1000.0 AS quantity,reason,
        operator_id AS operatorId,created_at AS createdAt
        FROM inventory_transfers WHERE tenant_id=?
          AND (from_branch_id=? OR to_branch_id=?)
        ORDER BY created_at DESC,id DESC LIMIT ?`,tenant,branch,branch,cap);
    },
    async products(tenant,branch,{includeInactive=false,limit=100}={}){
      await branchExists(tenant,branch);
      const cap=Math.min(100,Math.max(1,Math.trunc(Number(limit)||100)));
      const rows=await all(`SELECT p.id,p.sku,p.name,p.sale_price_cents AS salePriceCents,p.unit,
        p.track_stock AS trackStock,p.active,COALESCE(s.balance_milli,0) AS balanceMilli,
        COALESCE((SELECT SUM(r.quantity_milli) FROM inventory_reservations r
          WHERE r.tenant_id=p.tenant_id AND r.branch_id=? AND r.product_id=p.id
          AND r.status='ACTIVE'),0) AS reservedMilli,p.brand,p.barcode,p.category_id,
          p.parent_product_id,p.variant_label,p.last_cost_cents,
          EXISTS(SELECT 1 FROM product_media pm WHERE pm.tenant_id=p.tenant_id AND pm.product_id=p.id) AS hasPhoto
        FROM products p LEFT JOIN stock_positions s ON s.tenant_id=p.tenant_id
        AND s.product_id=p.id AND s.branch_id=?
        WHERE p.tenant_id=? AND (?=1 OR p.active=1)
        ORDER BY p.name,p.id LIMIT ?`,branch,branch,tenant,includeInactive?1:0,cap);
      return rows.map(x=>({...x,trackStock:Boolean(x.trackStock),active:Boolean(x.active),
        balance:x.balanceMilli/1000,reserved:x.reservedMilli/1000,
        available:(x.balanceMilli-x.reservedMilli)/1000,menuEnabled:true,
        brand:x.brand||'',barcode:x.barcode||x.sku,categoryId:x.category_id||null,
        parentProductId:x.parent_product_id||null,variantLabel:x.variant_label||null,
        lastCostCents:x.last_cost_cents||0,photo:Boolean(x.hasPhoto)}));
    },
    async createProduct(tenant,user,body,header){
      const key=requiredMutation(body,header),scope='product.create';
      const prior=await applied(tenant,scope,key);if(prior)return prior;
      const name=text(body?.name,120),sku=text(body?.sku,64).toUpperCase();
      if(!name||name.length<2||!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(sku))throw error(400,'Informe nome e SKU válido.');
      const price=requiredNumber(body?.salePriceCents,'Preço');
      const unit=String(body?.unit||'UN').trim().toUpperCase();
      if(!new Set(['UN','KG','G','L','M','M2','M3','CX','PCT']).has(unit))throw error(400,'Unidade de produto inválida.');
      const brand=text(body?.brand,100),barcode=text(body?.barcode,80)||null;
      const categoryId=body?.categoryId||null,parentProductId=body?.parentProductId||null;
      const variantLabel=text(body?.variantLabel,80)||null;
      if((parentProductId&&!variantLabel)||(!parentProductId&&variantLabel))
        throw error(400,'Variação exige produto pai e nome da variação.');
      if(barcode&&!/^[A-Za-z0-9._-]{4,80}$/.test(barcode))throw error(400,'Código de barras inválido.');
      if(categoryId&&!await first('SELECT id FROM product_categories WHERE tenant_id=? AND id=?',tenant,categoryId))
        throw error(404,'Categoria não encontrada nesta empresa.');
      if(parentProductId&&!await first('SELECT id FROM products WHERE tenant_id=? AND id=? AND parent_product_id IS NULL AND active=1',tenant,parentProductId))
        throw error(404,'Produto pai não encontrado nesta empresa.');
      const id=randomId(),created=stamp();
      const result={id,name,sku,salePriceCents:price,unit,trackStock:body?.trackStock!==false,
        active:true,brand,barcode,categoryId,parentProductId,variantLabel,lastCostCents:0};
      await batch([
        q(`INSERT INTO products(id,tenant_id,sku,name,sale_price_cents,unit,track_stock,created_at,updated_at,
           brand,barcode,category_id,parent_product_id,variant_label)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          id,tenant,sku,name,price,unit,result.trackStock?1:0,created,created,
          brand,barcode,categoryId,parentProductId,variantLabel),
        audit(tenant,scope,key,result)
      ]);
      return result;
    },
    async updateProduct(tenant,branch,id,body,header){
      await branchExists(tenant,branch);
      const key=requiredMutation(body,header),scope='product.update:'+id;
      const previous=await applied(tenant,scope,key);if(previous)return previous;
      if(!['name','sku','salePriceCents','unit','active','brand','barcode','categoryId','parentProductId','variantLabel'].some(field=>Object.hasOwn(body,field)))
        throw error(400,'Informe ao menos um campo de produto para editar.');
      const old=await first('SELECT * FROM products WHERE tenant_id=? AND id=?',tenant,id);
      if(!old)throw error(404,'Produto não encontrado.');
      const name=Object.hasOwn(body,'name')?text(body.name,120):old.name;
      const sku=Object.hasOwn(body,'sku')?text(body.sku,64).toUpperCase():old.sku;
      const unit=Object.hasOwn(body,'unit')?String(body.unit||'').trim().toUpperCase():old.unit;
      const price=Object.hasOwn(body,'salePriceCents')?requiredNumber(body.salePriceCents,'Preço'):old.sale_price_cents;
      if(name.length<2||!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(sku))
        throw error(400,'Informe nome e SKU válido.');
      if(!new Set(['UN','KG','G','L','M','M2','M3','CX','PCT']).has(unit))
        throw error(400,'Unidade de produto inválida.');
      if(Object.hasOwn(body,'active')&&typeof body.active!=='boolean')
        throw error(400,'A situação do produto deve ser ativa ou inativa.');
      if(Object.hasOwn(body,'trackStock')&&body.trackStock!==Boolean(old.track_stock))
        throw error(409,'O modo de controle de estoque não pode ser alterado após o cadastro.');
      const active=Object.hasOwn(body,'active')?body.active:Boolean(old.active);
      if(unit!==old.unit){
        const sold=await first('SELECT 1 AS found FROM sale_items WHERE tenant_id=? AND product_id=? LIMIT 1',tenant,id);
        const moved=await first('SELECT 1 AS found FROM inventory_movements WHERE tenant_id=? AND product_id=? LIMIT 1',tenant,id);
        if(sold||moved)throw error(409,'A unidade de um produto já vendido ou movimentado não pode ser alterada sem conversão auditada.');
      }
      if(!active&&Boolean(old.active)){
        const pending=await first(`SELECT s.id FROM sales s JOIN sale_items i ON i.sale_id=s.id
          WHERE i.tenant_id=? AND i.product_id=? AND s.status IN ('OPEN','SUSPENDED') LIMIT 1`,tenant,id);
        if(pending)throw error(409,'Há venda aberta ou suspensa contendo o produto. Finalize ou cancele antes de desativar.');
      }
      const brand=Object.hasOwn(body,'brand')?text(body.brand,100):old.brand||'';
      const barcode=Object.hasOwn(body,'barcode')?(text(body.barcode,80)||null):old.barcode;
      const categoryId=Object.hasOwn(body,'categoryId')?(body.categoryId||null):old.category_id;
      const parentProductId=Object.hasOwn(body,'parentProductId')?(body.parentProductId||null):old.parent_product_id;
      const variantLabel=Object.hasOwn(body,'variantLabel')?(text(body.variantLabel,80)||null):old.variant_label;
      if(barcode&&!/^[A-Za-z0-9._-]{4,80}$/.test(barcode))throw error(400,'Código de barras inválido.');
      if((parentProductId&&!variantLabel)||(!parentProductId&&variantLabel)||parentProductId===id)
        throw error(400,'Produto pai e variação inválidos.');
      if(categoryId&&!await first('SELECT id FROM product_categories WHERE id=? AND tenant_id=?',categoryId,tenant))
        throw error(404,'Categoria não encontrada nesta empresa.');
      if(parentProductId&&!await first('SELECT id FROM products WHERE id=? AND tenant_id=? AND parent_product_id IS NULL',parentProductId,tenant))
        throw error(404,'Produto pai não encontrado nesta empresa.');
      const result={id,name,sku,unit,salePriceCents:price,brand,barcode,categoryId,parentProductId,variantLabel,
        trackStock:Boolean(old.track_stock),active,lastCostCents:old.last_cost_cents,updatedAt:stamp()};
      await batch([
        q(`UPDATE products SET name=?,sku=?,sale_price_cents=?,unit=?,active=?,updated_at=?,
          brand=?,barcode=?,category_id=?,parent_product_id=?,variant_label=? WHERE id=? AND tenant_id=?`,
          name,sku,price,unit,active?1:0,result.updatedAt,
          brand,barcode,categoryId,parentProductId,variantLabel,id,tenant),
        audit(tenant,scope,key,result)
      ]);
      return result;
    },
    async receipt(tenant,branch,user,body,header){
      await branchExists(tenant,branch);
      const key=requiredMutation(body,header),scope='inventory.receipt:'+branch;
      const prior=await applied(tenant,scope,key);if(prior)return prior;
      const row=await product(tenant,body?.productId);
      if(!row.track_stock)throw error(409,'Este produto não controla estoque físico.');
      const milli=quantityMilli(body?.quantity);
      if(!milli)throw error(400,'Informe quantidade positiva com até três casas decimais.');
      const kind=body?.type==='opening'?'opening':'purchase';
      const hasCost=Object.hasOwn(body,'unitCostCents')&&body.unitCostCents!=null;
      const cost=hasCost?requiredNumber(body.unitCostCents,'Custo unitário'):null;
      const supplierId=body?.supplierId||null;
      if(supplierId&&!await first('SELECT id FROM suppliers WHERE tenant_id=? AND id=? AND active=1',tenant,supplierId))
        throw error(404,'Fornecedor não encontrado nesta empresa.');
      if(supplierId&&!hasCost)throw error(400,'Compra com fornecedor exige custo unitário.');
      const code=body?.lotCode==null?'':String(body.lotCode).trim().toUpperCase();
      if(code&&!/^[A-Z0-9][A-Z0-9._/-]{0,63}$/.test(code))
        throw error(400,'Lote deve conter até 64 caracteres alfanuméricos, ponto, barra, hífen ou sublinhado.');
      if(!code&&(body?.manufacturedAt||body?.expiresAt))
        throw error(400,'Informe o lote antes de registrar fabricação ou validade.');
      const dateField=(value,label)=>{
        if(value==null||value==='')return null;
        if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||
          Number.isNaN(Date.parse(value+'T00:00:00Z'))||
          new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)
          throw error(400,label+' deve usar a data AAAA-MM-DD.');
        return value;
      };
      const manufacturedAt=dateField(body?.manufacturedAt,'Fabricação');
      const expiresAt=dateField(body?.expiresAt,'Validade');
      if(manufacturedAt&&expiresAt&&expiresAt<manufacturedAt)
        throw error(400,'Validade anterior à fabricação.');
      const at=stamp(),result={movementId:randomId(),productId:row.id,branchId:branch,
        quantity:milli/1000,type:kind,...(hasCost?{unitCostCents:cost,supplierId}:{}),
        ...(code?{lot:{code,manufacturedAt,expiresAt}}:{})};
      const statements=ledgerReceipt(tenant,branch,user,row.id,milli,cost,supplierId,key,at,result.movementId,kind);
      if(code){
        const lotId=randomId();
        statements.push(q(`INSERT INTO inventory_lot_receipts
          (id,tenant_id,branch_id,product_id,movement_id,lot_code,manufactured_at,expires_at,quantity_milli,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)`,lotId,tenant,branch,row.id,result.movementId,code,
          manufacturedAt,expiresAt,milli,at));
        statements.push(...lotLedger.statements(tenant,branch,row.id,result.movementId,
          [{lotId,quantityMilli:milli}],1,at));
      }
      statements.push(audit(tenant,scope,key,result));
      await batch(statements);
      return result;
    },
    async lotReceipts(tenant,branch,{productId='',limit=50}={}){
      await branchExists(tenant,branch);
      const filter=text(productId,128);
      const capped=Number(limit);
      if(!Number.isInteger(capped)||capped<1||capped>100)
        throw error(400,'Limite de consulta inválido.');
      return all(`SELECT l.id,l.product_id AS productId,p.name AS productName,
        l.movement_id AS movementId,l.lot_code AS lotCode,
        l.manufactured_at AS manufacturedAt,l.expires_at AS expiresAt,
        l.quantity_milli/1000.0 AS receivedQuantity,l.created_at AS receivedAt,
        COALESCE(b.balance_milli,0)/1000.0 AS trackedBalance,
        CASE WHEN EXISTS(SELECT 1 FROM inventory_lot_entries e
           WHERE e.lot_receipt_id=l.id AND e.delta_milli>0) THEN 1 ELSE 0 END AS tracked
        FROM inventory_lot_receipts l
        JOIN products p ON p.id=l.product_id AND p.tenant_id=l.tenant_id
        LEFT JOIN inventory_lot_balances b ON b.lot_receipt_id=l.id
          AND b.tenant_id=l.tenant_id AND b.product_id=l.product_id AND b.branch_id=?
        WHERE l.tenant_id=? AND (l.branch_id=? OR b.balance_milli>0)
          AND (?='' OR l.product_id=?)
        ORDER BY l.created_at DESC,l.id DESC LIMIT ?`,
        branch,tenant,branch,filter,filter,capped);
    },
    async stock(tenant,branch,limit=100){
      await branchExists(tenant,branch);
      return all(`SELECT p.id AS productId,p.name,p.sku,COALESCE(s.balance_milli,0)/1000.0 AS quantity
        FROM products p LEFT JOIN stock_positions s ON s.tenant_id=p.tenant_id AND s.product_id=p.id AND s.branch_id=?
        WHERE p.tenant_id=? AND p.track_stock=1 AND p.active=1 ORDER BY p.name LIMIT ?`,branch,tenant,Math.min(100,Math.max(1,Number(limit)||100)));
    },
    async cash(tenant,branch,terminalId='DEFAULT'){
      await branchExists(tenant,branch);
      const terminal=canonicalTerminalId(terminalId);
      const row=await first(`SELECT * FROM cash_sessions c WHERE c.tenant_id=? AND c.branch_id=?
        AND c.terminal_id=? AND c.status='OPEN' LIMIT 1`,tenant,branch,terminal);
      if(!row)return null;
      const {closing}=await cashClosing(tenant,branch,row,0);
      return {id:row.id,status:row.status,operatorId:row.operator_id,terminalId:row.terminal_id,
        openingCents:row.opening_cents,initialCashCents:row.opening_cents,
        openedAt:row.opened_at,expectedCashCents:closing.expectedCashCents,
        branchId:branch};
    },
    async openCash(tenant,branch,user,body,header){
      await branchExists(tenant,branch);
      const terminal=canonicalTerminalId(body?.terminalId);
      const key=requiredMutation(body,header),scope='cash.open:'+branch+':'+terminal;
      const prior=await applied(tenant,scope,key);if(prior)return prior;
      const opening=requiredNumber(body?.openingCents??body?.initialCashCents,'Valor inicial');
      const result={id:randomId(),status:'OPEN',openingCents:opening,branchId:branch,terminalId:terminal,openedAt:stamp(),operatorId:user};
      await batch([
        q('INSERT INTO cash_sessions(id,tenant_id,branch_id,operator_id,status,opening_cents,opened_at,terminal_id) VALUES(?,?,?,?,?,?,?,?)',
          result.id,tenant,branch,user,'OPEN',opening,result.openedAt,terminal),
        audit(tenant,scope,key,result)
      ]);
      return result;
    },

    async cashSessions(tenant,branch,{limit=40,terminalId=''}={}){
      await branchExists(tenant,branch);
      const terminal=terminalId?canonicalTerminalId(terminalId):'';
      const rows=await all(`SELECT * FROM cash_sessions WHERE tenant_id=? AND branch_id=?
        AND (?='' OR terminal_id=?) ORDER BY opened_at DESC,id DESC LIMIT ?`,tenant,branch,terminal,terminal,Math.min(50,Math.max(1,Number(limit)||40)));
      return Promise.all(rows.map(async row=>{
        const {closing}=await cashClosing(tenant,branch,row,row.counted_cash_cents||0);
        return {id:row.id,operatorId:row.operator_id,terminalId:row.terminal_id,status:row.status,
          openedAt:row.opened_at,closedAt:row.closed_at,
          openingCents:row.opening_cents,initialCashCents:row.opening_cents,
          expectedCashCents:row.expected_cash_cents??closing.expectedCashCents,
          countedCashCents:row.counted_cash_cents,divergenceCents:row.divergence_cents,
          branchId:branch};
      }));
    },
    async cashSessionsSearch(tenant,branch,filters={}){
      await branchExists(tenant,branch);
      const status=text(filters.status||'',20).toUpperCase();
      if(status&&!['OPEN','CLOSED'].includes(status))throw error(400,'Estado do caixa inválido.');
      const operatorId=text(filters.operatorId||'',128);
      const terminal=filters.terminalId?canonicalTerminalId(filters.terminalId):'';
      const {a,b}=period({from:filters.from||'',to:filters.to||''});
      const limit=Number(filters.limit??25),offset=Number(filters.offset??0);
      if(!Number.isSafeInteger(limit)||limit<1||limit>100||
         !Number.isSafeInteger(offset)||offset<0||offset>50000)
        throw error(400,'Paginação do histórico de caixa inválida.');
      const where=['tenant_id=?','branch_id=?','opened_at>=?','opened_at<=?'];
      const args=[tenant,branch,a,b];
      if(operatorId){where.push('operator_id=?');args.push(operatorId);}
      if(terminal){where.push('terminal_id=?');args.push(terminal);}
      if(status){where.push('status=?');args.push(status);}
      const clause=where.join(' AND ');
      const counted=await first('SELECT COUNT(*) AS total FROM cash_sessions WHERE '+clause,...args);
      const rows=await all(`SELECT * FROM cash_sessions WHERE ${clause}
        ORDER BY opened_at DESC,id DESC LIMIT ? OFFSET ?`,...args,limit,offset);
      const items=await Promise.all(rows.map(async row=>{
        const {closing}=await cashClosing(tenant,branch,row,row.counted_cash_cents??0);
        return {id:row.id,status:row.status,operatorId:row.operator_id,terminalId:row.terminal_id,
          openedAt:row.opened_at,closedAt:row.closed_at||null,
          openingCents:row.opening_cents,
          expectedCashCents:row.expected_cash_cents??closing.expectedCashCents,
          countedCashCents:row.counted_cash_cents,divergenceCents:row.divergence_cents,
          branchId:branch};
      }));
      return {items,total:counted.total,limit,offset};
    },
    async cashMovements(tenant,branch,id){
      await cashSession(tenant,branch,id);
      return cashLines(tenant,branch,id);
    },
    async cashAdjust(tenant,branch,id,user,body,keyHeader,type){
      const key=requiredMutation(body,keyHeader),scope='cash.'+type.toLowerCase()+':'+branch+':'+id;
      const prior=await applied(tenant,scope,key);if(prior)return prior;
      const session=await cashSession(tenant,branch,id);
      if(session.status!=='OPEN')throw error(409,'O caixa não está aberto.');
      const amount=requiredNumber(body?.amountCents,'Valor');
      if(amount===0)throw error(400,'Informe valor maior que zero.');
      const {closing}=await cashClosing(tenant,branch,session);
      if(type==='WITHDRAWAL'&&amount>closing.expectedCashCents)
        throw error(409,'Dinheiro insuficiente para a sangria.');
      const result={id:randomId(),sessionId:id,type,amountCents:amount,
        note:text(body?.note||'',240),createdAt:stamp()};
      await batch([
        q('INSERT INTO cash_adjustments(id,tenant_id,branch_id,cash_session_id,type,amount_cents,note,mutation_id,operator_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
          result.id,tenant,branch,id,type,amount,result.note,key,user,result.createdAt),
        audit(tenant,scope,key,result)
      ]);
      return result;
    },
    async closeCash(tenant,branch,id,user,body,keyHeader){
      const key=requiredMutation(body,keyHeader),scope='cash.close:'+branch+':'+id;
      const prior=await applied(tenant,scope,key);if(prior)return prior;
      const session=await cashSession(tenant,branch,id);
      if(session.status!=='OPEN')throw error(409,'Este caixa já foi fechado.');
      const counted=requiredNumber(body?.countedCashCents??body?.countedByMethod?.CASH,'Valor contado');
      const {closing}=await cashClosing(tenant,branch,session,counted);
      const result={id,branchId:branch,status:'CLOSED',closedAt:stamp(),
        expectedCashCents:closing.expectedCashCents,countedCashCents:counted,
        divergenceCents:closing.divergenceCents,operatorId:session.operator_id};
      await batch([
        q(`UPDATE cash_sessions SET status='CLOSED',closed_at=?,closed_by_user_id=?,
          expected_cash_cents=?,counted_cash_cents=?,divergence_cents=?
          WHERE id=? AND tenant_id=? AND branch_id=? AND status='OPEN'`,
          result.closedAt,user,result.expectedCashCents,counted,result.divergenceCents,id,tenant,branch),
        q('INSERT INTO domain_events(id,tenant_id,branch_id,aggregate_type,aggregate_id,type,payload_json,mutation_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)',
          randomId(),tenant,branch,'cash',id,'cash.closed',JSON.stringify(result),key,result.closedAt),
        audit(tenant,scope,key,result)
      ]);
      return result;
    },
    async financeEntries(tenant,branch,{kind='',status='',query='',limit=100}={}){
      await branchExists(tenant,branch);
      if(kind&&!['PAYABLE','RECEIVABLE'].includes(kind))throw error(400,'Tipo financeiro inválido.');
      if(status&&!['OPEN','PARTIAL','SETTLED','CANCELLED','OVERDUE'].includes(status))
        throw error(400,'Situação financeira inválida.');
      const today=new Date().toISOString().slice(0,10);
      const rows=await all(`WITH balances AS (
        SELECT e.id,e.tenant_id AS tenantId,e.branch_id AS branchId,
          e.description,e.kind,e.amount_cents AS amountCents,e.due_date AS dueDate,
          e.created_at AS createdAt,e.cancelled_at AS cancelledAt,
          COALESCE(SUM(f.amount_cents-COALESCE(r.amount_cents,0)),0) AS settledCents
        FROM finance_entries e LEFT JOIN finance_settlements f ON f.entry_id=e.id
        LEFT JOIN finance_settlement_reversals r ON r.settlement_id=f.id
        WHERE e.tenant_id=? AND e.branch_id=? AND (?='' OR e.kind=?)
          AND (?='' OR instr(lower(e.description),lower(?))>0)
        GROUP BY e.id
      )
      SELECT *,amountCents-settledCents AS openCents,
        CASE WHEN cancelledAt IS NOT NULL THEN 'CANCELLED'
          WHEN amountCents=settledCents THEN 'SETTLED'
          WHEN settledCents>0 THEN 'PARTIAL' ELSE 'OPEN' END AS status
      FROM balances
      WHERE (?='' OR status=? OR (?='OVERDUE' AND cancelledAt IS NULL
        AND amountCents>settledCents AND dueDate<?))
      ORDER BY dueDate,createdAt DESC LIMIT ?`,
        tenant,branch,kind,kind,String(query||'').slice(0,120),String(query||'').slice(0,120),
        status,status,status,today,Math.min(200,Math.max(1,Number(limit)||100)));
      return rows.map(row=>({...row,isOverdue:row.status!=='SETTLED'&&row.status!=='CANCELLED'&&row.dueDate<today}));
    },
    async createFinanceEntry(tenant,branch,user,body,keyHeader){
      await branchExists(tenant,branch);
      const key=requiredMutation(body,keyHeader),scope='finance.create:'+branch;
      const prior=await applied(tenant,scope,key);if(prior)return prior;
      const kind=body?.kind,description=text(body?.description,180),amount=requiredNumber(body?.amountCents,'Valor');
      const dueDate=dateWindow(body?.dueDate);
      if(!['PAYABLE','RECEIVABLE'].includes(kind)||description.length<2||!dueDate||!amount)
        throw error(400,'Informe tipo, descrição, valor positivo e vencimento.');
      const result={id:randomId(),kind,description,amountCents:amount,dueDate,
        branchId:branch,createdAt:stamp(),settledCents:0,openCents:amount,status:'OPEN'};
      await batch([
        q('INSERT INTO finance_entries(id,tenant_id,branch_id,kind,description,amount_cents,due_date,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
          result.id,tenant,branch,kind,description,amount,dueDate,user,result.createdAt),
        audit(tenant,scope,key,result)
      ]);
      return result;
    },
    async settleFinanceEntry(tenant,branch,id,user,body,keyHeader){
      const key=requiredMutation(body,keyHeader),scope='finance.settle:'+branch+':'+id;
      const prior=await applied(tenant,scope,key);if(prior)return prior;
      const entry=await financeRow(tenant,branch,id);
      if(entry.status==='CANCELLED'||entry.openCents===0)throw error(409,'Conta encerrada ou cancelada.');
      const amount=requiredNumber(body?.amountCents,'Valor');
      const method=body?.method;
      if(!amount||amount>entry.openCents||!['PIX','BANK_TRANSFER','CASH','DEBIT_CARD','CREDIT_CARD','OTHER'].includes(method))
        throw error(400,'Informe valor até o saldo aberto e uma forma válida.');
      const result={id:randomId(),entryId:id,amountCents:amount,method,occurredAt:stamp()};
      await batch([
        q('INSERT INTO finance_settlements(id,tenant_id,branch_id,entry_id,amount_cents,method,occurred_at,operator_id,mutation_id) VALUES(?,?,?,?,?,?,?,?,?)',
          result.id,tenant,branch,id,amount,method,result.occurredAt,user,key),
        audit(tenant,scope,key,result)
      ]);
      return {...result,entry:await financeRow(tenant,branch,id)};
    },
    async reverseFinanceSettlement(tenant,branch,id,settlementId,user,body,keyHeader){
      const key=requiredMutation(body,keyHeader),scope='finance.reverse:'+branch+':'+id+':'+settlementId;
      const prior=await applied(tenant,scope,key);if(prior)return {...prior,entry:await financeRow(tenant,branch,id)};
      const reason=text(body?.reason,240);
      if(reason.length<3)throw error(400,'Informe o motivo da reversão.');
      const entry=await financeRow(tenant,branch,id);
      if(entry.status==='CANCELLED')throw error(409,'Conta cancelada não pode receber reversão.');
      const settlement=await first('SELECT id,amount_cents AS amountCents FROM finance_settlements WHERE tenant_id=? AND branch_id=? AND entry_id=? AND id=?',
        tenant,branch,id,settlementId);
      if(!settlement)throw error(404,'Liquidação não encontrada nesta filial.');
      const exists=await first('SELECT id FROM finance_settlement_reversals WHERE tenant_id=? AND branch_id=? AND settlement_id=?',tenant,branch,settlementId);
      if(exists)throw error(409,'Liquidação já revertida.');
      const result={id:randomId(),entryId:id,settlementId,amountCents:settlement.amountCents,reason,occurredAt:stamp()};
      await batch([
        q('INSERT INTO finance_settlement_reversals(id,tenant_id,branch_id,entry_id,settlement_id,amount_cents,operator_id,reason,mutation_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
          result.id,tenant,branch,id,settlementId,result.amountCents,user,reason,key,result.occurredAt),
        q('INSERT INTO domain_events(id,tenant_id,branch_id,aggregate_type,aggregate_id,type,payload_json,mutation_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)',
          randomId(),tenant,branch,'finance',settlementId,'finance.settlement.reversed',JSON.stringify(result),key,result.occurredAt),
        audit(tenant,scope,key,result)
      ]);
      return {...result,entry:await financeRow(tenant,branch,id)};
    },
    async cancelFinanceEntry(tenant,branch,id,user,body,keyHeader){
      const key=requiredMutation(body,keyHeader),scope='finance.cancel:'+branch+':'+id;
      const prior=await applied(tenant,scope,key);if(prior)return prior;
      const entry=await financeRow(tenant,branch,id);
      if(entry.settledCents!==0||entry.status==='CANCELLED')throw error(409,'Conta liquidada ou já cancelada.');
      const result={id,status:'CANCELLED',cancelledAt:stamp()};
      await batch([
        q('UPDATE finance_entries SET cancelled_at=? WHERE id=? AND tenant_id=? AND branch_id=? AND cancelled_at IS NULL',
          result.cancelledAt,id,tenant,branch),
        audit(tenant,scope,key,result)
      ]);
      return result;
    },
    async financeSummary(tenant,branch){
      await branchExists(tenant,branch);
      // Aggregated in one query, including records beyond any UI page limit.
      const rows=await all(`SELECT e.kind,
        COALESCE(SUM(e.amount_cents-COALESCE(fs.paid,0)),0) AS openCents,
        COALESCE(SUM(COALESCE(fs.paid,0)),0) AS settledCents,
        COALESCE(SUM(CASE WHEN e.due_date<? THEN e.amount_cents-COALESCE(fs.paid,0) ELSE 0 END),0) AS overdueCents
        FROM finance_entries e
        LEFT JOIN (SELECT fs.entry_id,SUM(fs.amount_cents-COALESCE(r.amount_cents,0)) AS paid
          FROM finance_settlements fs LEFT JOIN finance_settlement_reversals r ON r.settlement_id=fs.id
          GROUP BY fs.entry_id) fs
          ON fs.entry_id=e.id
        WHERE e.tenant_id=? AND e.branch_id=? AND e.cancelled_at IS NULL
        GROUP BY e.kind`,new Date().toISOString().slice(0,10),tenant,branch);
      const result={payableOpenCents:0,receivableOpenCents:0,payableSettledCents:0,
        receivableSettledCents:0,overduePayableCents:0,overdueReceivableCents:0};
      for(const row of rows){
        const prefix=row.kind==='PAYABLE'?'payable':'receivable';
        result[prefix+'OpenCents']=row.openCents;
        result[prefix+'SettledCents']=row.settledCents;
        result[row.kind==='PAYABLE'?'overduePayableCents':'overdueReceivableCents']=row.overdueCents;
      }
      return result;
    },
    async saveInventoryMinimum(tenant,branch,user,body,header){
      await branchExists(tenant,branch);
      if(!await first("SELECT 1 AS ready FROM sqlite_master WHERE type='table' AND name='inventory_minimum_levels'"))
        throw error(503,'A atualização de estoque mínimo ainda não foi aplicada no banco desta instalação.');
      const productId=body?.productId;
      if(typeof productId!=='string'||!productId||productId.length>128)
        throw error(400,'Informe o produto.');
      const record=await product(tenant,productId);
      if(!record.track_stock)throw error(409,'Produto sem controle de estoque.');
      const minimum=body?.minimumQuantity;
      if(minimum!==null && (typeof minimum!=='number'||!Number.isFinite(minimum)||
         minimum<0||minimum>100000||Math.abs(minimum*1000-Math.round(minimum*1000))>1e-7))
        throw error(400,'Mínimo deve ser nulo ou quantidade entre 0 e 100000 com três casas decimais.');
      const scope='inventory.minimum:'+branch+':'+productId;
      const key=requiredMutation(body,header);
      const prior=await applied(tenant,scope,key);if(prior)return prior;
      const result={productId,branchId:branch,minimumQuantity:minimum,
        status:minimum===null?'NOT_CONFIGURED':'CONFIGURED'};
      const statements=minimum===null
        ?[q('DELETE FROM inventory_minimum_levels WHERE tenant_id=? AND branch_id=? AND product_id=?',
            tenant,branch,productId)]
        :[q(`INSERT INTO inventory_minimum_levels
            (tenant_id,branch_id,product_id,minimum_milli,updated_by,updated_at)
            VALUES(?,?,?,?,?,?)
            ON CONFLICT(tenant_id,branch_id,product_id) DO UPDATE SET
              minimum_milli=excluded.minimum_milli,updated_by=excluded.updated_by,
              updated_at=excluded.updated_at`,
            tenant,branch,productId,Math.round(minimum*1000),user,stamp())];
      statements.push(audit(tenant,scope,key,result));
      await batch(statements);
      return result;
    },
    async homeIndicators(tenant,branch,{asOf=stamp().slice(0,10)}={}){
      period({from:asOf,to:asOf});
      const [report,open,coverage]=await Promise.all([
        this.reports(tenant,branch,{from:asOf,to:asOf}),
        first("SELECT COUNT(*) AS n FROM cash_sessions WHERE tenant_id=? AND branch_id=? AND status='OPEN'",tenant,branch),
        this.reportStockCoverage(tenant,branch,{asOf,days:30})
      ]);
      return {asOf,salesCount:report.sales.count,
        netSalesCents:report.sales.totalCents,
        refundedCents:report.sales.refundedCents,
        cashOpen:Boolean(open?.n),activeCashTerminals:Number(open?.n||0),
        outOfStockCount:coverage.zeroOrReservedOut,
        belowMinimumCount:coverage.belowMinimum,
        atMinimumCount:coverage.atMinimum,
        minimumUnconfiguredCount:coverage.unknownMinimum,
        trackedProducts:coverage.products.length,
        stockCoverageUnknown:coverage.coverageUnknown,
        source:'CANONICAL_SALES_CASH_STOCK'};
    },
    async reports(tenant,branch,{from,to}={}){
      await branchExists(tenant,branch);
      const {a,b}=period({from,to});
      // Never remove a completed sale from history after refund; recognize its
      // original amount on the completion date and the negative on the return date.
      const gross=await first("SELECT COUNT(*) AS count,COALESCE(SUM(total_cents),0) AS grossCents,COALESCE(SUM(discount_cents),0) AS discountsCents FROM sales WHERE tenant_id=? AND branch_id=? AND completed_at BETWEEN ? AND ? AND status IN('COMPLETED','CANCELLED')",tenant,branch,a,b);
      const refunds=await first("SELECT COUNT(*) AS count,COALESCE(SUM(amount_cents),0) AS totalCents FROM sale_returns WHERE tenant_id=? AND branch_id=? AND created_at BETWEEN ? AND ?",tenant,branch,a,b);
      const sales={count:gross.count,totalCents:gross.grossCents-refunds.totalCents,
        grossCents:gross.grossCents,refundedCents:refunds.totalCents,refundCount:refunds.count,
        discountsCents:gross.discountsCents};
      const originals=await all(`SELECT p.method,SUM(CASE WHEN p.method='CASH'
        THEN p.amount_cents-s.change_cents ELSE p.amount_cents END) AS amountCents
        FROM sale_payments p JOIN sales s ON s.id=p.sale_id AND s.tenant_id=p.tenant_id AND s.branch_id=p.branch_id
        WHERE s.tenant_id=? AND s.branch_id=? AND s.status IN('COMPLETED','CANCELLED')
          AND s.completed_at BETWEEN ? AND ?
        GROUP BY p.method`,tenant,branch,a,b);
      const refundsByMethod=await all(`SELECT method,SUM(amount_cents) AS amountCents FROM sale_refund_movements
        WHERE tenant_id=? AND branch_id=? AND created_at BETWEEN ? AND ? AND method<>'STORE_CREDIT'
        GROUP BY method`,tenant,branch,a,b);
      const methods=new Map();
      for(const row of originals)methods.set(row.method,(methods.get(row.method)||0)+row.amountCents);
      for(const row of refundsByMethod)methods.set(row.method,(methods.get(row.method)||0)-row.amountCents);
      const payments=[...methods].map(([method,amountCents])=>({method,amountCents}))
        .sort((x,y)=>x.method.localeCompare(y.method));
      const originalsByProduct=await all(`SELECT i.product_id AS productId,MAX(i.product_name) AS name,
        SUM(i.quantity_milli) AS milli,COUNT(DISTINCT i.sale_id) AS salesCount,
        SUM(i.quantity_milli*i.unit_price_cents)/1000 AS grossCents
        FROM sale_items i JOIN sales s ON s.id=i.sale_id AND s.tenant_id=i.tenant_id AND s.branch_id=i.branch_id
        WHERE i.tenant_id=? AND i.branch_id=? AND s.status IN('COMPLETED','CANCELLED')
          AND s.completed_at BETWEEN ? AND ?
        GROUP BY i.product_id`,tenant,branch,a,b);
      const refundedByProduct=await all(`SELECT i.product_id AS productId,MAX(i.product_name) AS name,
        SUM(ri.quantity_milli) AS milli,SUM(ri.net_cents) AS returnedCents
        FROM sale_return_items ri JOIN sale_returns r ON r.id=ri.return_id AND r.tenant_id=ri.tenant_id
           AND r.branch_id=ri.branch_id
        JOIN sale_items i ON i.id=ri.sale_item_id AND i.tenant_id=ri.tenant_id AND i.branch_id=ri.branch_id
        WHERE r.tenant_id=? AND r.branch_id=? AND r.created_at BETWEEN ? AND ?
        GROUP BY i.product_id`,tenant,branch,a,b);
      const products=new Map();
      for(const item of originalsByProduct)products.set(item.productId,{
        productId:item.productId,name:item.name,quantity:item.milli/1000,
        grossCents:item.grossCents,refundedCents:0,salesCount:item.salesCount
      });
      for(const item of refundedByProduct){
        const old=products.get(item.productId)||{
          productId:item.productId,name:item.name,quantity:0,grossCents:0,
          refundedCents:0,salesCount:0};
        old.quantity-=item.milli/1000;
        old.refundedCents+=item.returnedCents;
        products.set(item.productId,old);
      }
      const inventory=await this.stock(tenant,branch,100);
      const cash=await this.cashSessions(tenant,branch,{limit:50});
      const finance=await this.financeSummary(tenant,branch);
      return {period:{from:from||null,to:to||null},sales,methodTotals:payments,
        products:[...products.values()].sort((x,y)=>y.grossCents-x.grossCents).slice(0,50),
        inventory,cash,finance};
    },
    async dailySalesTrend(tenant,branch,{from,to}={}){
      await branchExists(tenant,branch);
      if(!from||!to)throw error(400,'Informe período para tendência.');
      const {a,b}=period({from,to});
      const start=Date.parse(from+'T00:00:00.000Z'),end=Date.parse(to+'T00:00:00.000Z');
      const days=Math.round((end-start)/86400000)+1;
      if(!Number.isSafeInteger(days)||days<1||days>90)
        throw error(400,'A tendência permite de 1 a 90 dias por consulta.');
      const [sales,returns]=await Promise.all([
        all(`SELECT substr(completed_at,1,10) AS day,
          COUNT(*) AS count,COALESCE(SUM(total_cents),0) AS grossCents
          FROM sales WHERE tenant_id=? AND branch_id=? AND
          status IN('COMPLETED','CANCELLED') AND completed_at BETWEEN ? AND ?
          GROUP BY substr(completed_at,1,10)`,tenant,branch,a,b),
        all(`SELECT substr(created_at,1,10) AS day,
          COALESCE(SUM(amount_cents),0) AS refundedCents
          FROM sale_returns WHERE tenant_id=? AND branch_id=? AND created_at BETWEEN ? AND ?
          GROUP BY substr(created_at,1,10)`,tenant,branch,a,b)
      ]);
      const byDay=new Map();
      for(const row of sales)byDay.set(row.day,{count:Number(row.count),grossCents:Number(row.grossCents),refundedCents:0});
      for(const row of returns){
        const record=byDay.get(row.day)||{count:0,grossCents:0,refundedCents:0};
        record.refundedCents=Number(row.refundedCents);byDay.set(row.day,record);
      }
      const points=Array.from({length:days},(_,index)=>{
        const date=new Date(start+index*86400000).toISOString().slice(0,10);
        const value=byDay.get(date)||{count:0,grossCents:0,refundedCents:0};
        return {date,...value,netCents:value.grossCents-value.refundedCents};
      });
      return {period:{from,to},source:'CANONICAL_COMPLETIONS_AND_RETURNS',points};
    },
    async compareReports(tenant,branch,{from,to,compareFrom,compareTo}={}){
      if(!from||!to||!compareFrom||!compareTo)
        throw error(400,'Informe as duas datas inicial e final de cada período.');
      const current=await this.reports(tenant,branch,{from,to});
      const previous=await this.reports(tenant,branch,{from:compareFrom,to:compareTo});
      const difference=current.sales.totalCents-previous.sales.totalCents;
      return {current:{period:current.period,sales:current.sales},
        previous:{period:previous.period,sales:previous.sales},
        delta:{totalCents:difference,
          percentage:previous.sales.totalCents===0?null:
            Math.round(difference/Math.abs(previous.sales.totalCents)*10000)/100,
          count:current.sales.count-previous.sales.count,
          refundedCents:current.sales.refundedCents-previous.sales.refundedCents}};
    },
    async salesCsv(tenant,branch,{from,to}={}){
      const {a,b}=period({from,to});
      await branchExists(tenant,branch);
      // Append refund and status columns without removing legacy export columns.
      // netCents is a cumulative position as of export time, not a second sale.
      const rows=await all(`SELECT s.sale_number AS saleNumber,s.completed_at AS completedAt,
        s.total_cents AS totalCents,s.discount_cents AS discountCents,s.operator_id AS operatorId,
        s.status,COALESCE((SELECT SUM(r.amount_cents) FROM sale_returns r
          WHERE r.tenant_id=s.tenant_id AND r.branch_id=s.branch_id AND r.sale_id=s.id),0) AS refundedCents
        FROM sales s WHERE s.tenant_id=? AND s.branch_id=? AND s.status IN('COMPLETED','CANCELLED')
        AND s.completed_at BETWEEN ? AND ? ORDER BY s.completed_at,s.id LIMIT 3001`,tenant,branch,a,b);
      if(rows.length>3000)throw error(413,'Mais de 3000 vendas. Divida o período para exportar sem truncamento.');
      const cell=value=>'"'+String(value??'').replace(/"/g,'""').replace(/^[=+@-]/,"'")+'"';
      return '\uFEFF'+'Venda;Data;Total (R$);Desconto (R$);Operador;Status;Reembolsado (R$);Liquido acumulado (R$)\r\n'+
        rows.map(x=>[x.saleNumber,x.completedAt,(x.totalCents/100).toFixed(2).replace('.',','),
          (x.discountCents/100).toFixed(2).replace('.',','),x.operatorId,x.status,
          (x.refundedCents/100).toFixed(2).replace('.',','),((x.totalCents-x.refundedCents)/100).toFixed(2).replace('.',',')]
          .map(cell).join(';')).join('\r\n');
    },
    async openSale(tenant,branch,user,body,header){
      await branchExists(tenant,branch);
      const key=requiredMutation(body,header),scope='sale.open:'+branch;
      const prior=await applied(tenant,scope,key);if(prior)return prior;
      const id=randomId(),created=stamp(),saleNumber='W-'+id.slice(0,8).toUpperCase();
      const terminalId=canonicalTerminalId(body?.terminalId);
      const sellerId=body?.sellerId||user;
      const seller=await first('SELECT user_id FROM tenant_memberships WHERE tenant_id=? AND user_id=? AND active=1',tenant,sellerId);
      if(!seller)throw error(404,'Vendedor não encontrado neste estabelecimento.');
      const wholesaleId=body?.wholesaleOrderId||null;
      let order=null,quoted=[];
      if(wholesaleId){
        order=await first('SELECT id,customer_id,status,sale_id FROM wholesale_orders WHERE tenant_id=? AND branch_id=? AND id=?',tenant,branch,wholesaleId);
        if(!order)throw error(404,'Cotação não encontrada.');
        if(order.status!=='CONFIRMED'||order.sale_id)throw error(409,'Cotação já vinculada a uma venda ou não confirmada.');
        quoted=await all(`SELECT w.product_id AS productId,w.quantity_milli AS milli,w.unit_price_cents AS unitPriceCents,
          p.name,p.sku FROM wholesale_order_items w JOIN products p ON p.tenant_id=w.tenant_id AND p.id=w.product_id
          WHERE w.tenant_id=? AND w.branch_id=? AND w.order_id=? ORDER BY w.rowid`,tenant,branch,wholesaleId);
        if(!quoted.length)throw error(409,'Cotação sem itens.');
      }
      const quotedTotals=calculateSaleTotals({items:quoted.map(x=>({unitPriceCents:x.unitPriceCents,quantity:x.milli/1000}))});
      const result={id,tenantId:tenant,branchId:branch,terminalId,saleNumber,operatorId:user,sellerId,customerId:order?.customer_id||null,status:'OPEN',
        items:quoted.map(x=>({productId:x.productId,productName:x.name,sku:x.sku,quantity:x.milli/1000,unitPriceCents:x.unitPriceCents,totalCents:Math.round(x.unitPriceCents*x.milli/1000)})),
        payments:[],subtotalCents:quotedTotals.subtotalCents,discountCents:0,totalCents:quotedTotals.totalCents,changeCents:0,completedAt:null};
      // One sale authority: a quote is a price snapshot, not a second sale.
      // INSERT..SELECT prevents concurrent checkouts from claiming the same quote twice.
      const statements=[wholesaleId
        ?q(`INSERT INTO sales(id,tenant_id,branch_id,operator_id,seller_id,customer_id,sale_number,status,created_at,terminal_id)
          SELECT ?,tenant_id,branch_id,?,?,customer_id,?,'OPEN',?,?
          FROM wholesale_orders WHERE tenant_id=? AND branch_id=? AND id=? AND status='CONFIRMED' AND sale_id IS NULL`,
          id,user,sellerId,saleNumber,created,terminalId,tenant,branch,wholesaleId)
        :q('INSERT INTO sales(id,tenant_id,branch_id,operator_id,seller_id,sale_number,status,created_at,terminal_id) VALUES(?,?,?,?,?,?,?,?,?)',
          id,tenant,branch,user,sellerId,saleNumber,'OPEN',created,terminalId)];
      for(const line of quoted)statements.push(q(`INSERT INTO sale_items(id,tenant_id,branch_id,sale_id,product_id,product_name,sku,quantity_milli,unit_price_cents,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`,randomId(),tenant,branch,id,line.productId,line.name,line.sku,line.milli,line.unitPriceCents,created));
      if(wholesaleId)statements.push(q('UPDATE wholesale_orders SET sale_id=?,updated_at=? WHERE tenant_id=? AND branch_id=? AND id=? AND sale_id IS NULL',
        id,created,tenant,branch,wholesaleId));
      statements.push(audit(tenant,scope,key,result));
      await batch(statements);
      return result;
    },
    sale: snapshot,
    listSales:listing,
    async assignSaleCustomer(tenant,branch,id,customerId){
      const sale=await tenantSale(tenant,branch,id);requireOpen(sale);
      if(customerId){
        const customer=await first('SELECT id FROM customers WHERE tenant_id=? AND id=? AND active=1',tenant,customerId);
        if(!customer)throw error(404,'Cliente não encontrado neste estabelecimento.');
      }
      await run("UPDATE sales SET customer_id=? WHERE tenant_id=? AND branch_id=? AND id=? AND status='OPEN'",customerId||null,tenant,branch,id);
      return snapshot(tenant,branch,id);
    },
    async assignSaleSeller(tenant,branch,id,sellerId){
      const sale=await tenantSale(tenant,branch,id);requireOpen(sale);
      const seller=await first('SELECT user_id FROM tenant_memberships WHERE tenant_id=? AND user_id=? AND active=1',tenant,sellerId);
      if(!seller)throw error(404,'Vendedor não encontrado neste estabelecimento.');
      await run("UPDATE sales SET seller_id=? WHERE tenant_id=? AND branch_id=? AND id=? AND status='OPEN'",sellerId,tenant,branch,id);
      return snapshot(tenant,branch,id);
    },
    async addItem(tenant,branch,id,body,header){
      const key=requiredMutation(body,header),scope='sale.add-item:'+id;
      const previous=await applied(tenant,scope,key);if(previous)return snapshot(tenant,branch,id);
      const sale=await tenantSale(tenant,branch,id);requireOpen(sale);
      const row=await product(tenant,body?.productId);
      const milli=quantityMilli(body?.quantity??1);
      if(!milli)throw error(400,'Quantidade inválida: até três casas decimais.');
      const existing=await first('SELECT id,quantity_milli AS milli,configuration_json AS configurationJson FROM sale_items WHERE sale_id=? AND product_id=?',id,row.id);
      if(existing?.configurationJson)throw error(409,'Item possui configuração específica; adicione pela escolha de variações e adicionais.');
      if(!existing&&(await all('SELECT id FROM sale_items WHERE sale_id=?',id)).length>=MAX_LINES)
        throw error(400,'Máximo de 80 produtos por venda.');
      const itemId=existing?.id||randomId();
      // A single transaction contains the addition and its deduplication record.
      // Data is re-read after commit for the canonical checkout shape.
      const safe={saleId:id,productId:row.id,quantity:milli/1000,
        ...(body.weightSource?{weightSource:body.weightSource,grams:body.grams}: {})};
      await batch([
        q(`INSERT INTO sale_items(id,tenant_id,branch_id,sale_id,product_id,product_name,sku,quantity_milli,unit_price_cents,created_at,catalog_unit_price_cents)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(sale_id,product_id) DO UPDATE SET quantity_milli=sale_items.quantity_milli+excluded.quantity_milli`,
          itemId,tenant,branch,id,row.id,row.name,row.sku,milli,row.sale_price_cents,stamp(),row.sale_price_cents),
        audit(tenant,scope,key,safe)
      ]);
      return snapshotAfterCartChange(tenant,branch,id);
    },
    async addConfiguredItem(tenant,branch,id,body,header){
      const key=requiredMutation(body,header),scope='sale.add-configured:'+id;
      const prior=await applied(tenant,scope,key);
      if(prior)return snapshot(tenant,branch,id);
      const sale=await tenantSale(tenant,branch,id);requireOpen(sale);
      const p=await product(tenant,body?.productId);
      const milli=quantityMilli(body?.quantity??1);
      if(!milli)throw error(400,'Quantidade inválida.');
      const note=body?.note??'';
      if(typeof note!=='string'||note.length>240||
         /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(note))
        throw error(400,'Observação inválida.');
      const quote=await checkoutConfig.quote(tenant,branch,p.id,body);
      const configurationJSON=JSON.stringify(quote.configurationSnapshot);
      const itemId=randomId();
      const existing=await first('SELECT id FROM sale_items WHERE tenant_id=? AND branch_id=? AND sale_id=? AND product_id=?',
        tenant,branch,id,p.id);
      if(!existing&&(await all('SELECT id FROM sale_items WHERE sale_id=?',id)).length>=MAX_LINES)
        throw error(400,'Máximo de 80 produtos por venda.');
      // A configuration belongs to the SAME canonical sale_item. The primary
      // uniqueness constraint permits one configuration per SKU in this phase.
      // An incompatible choice or altered price must fail atomically rather
      // than silently merging two different items into a single stock line.
      await batch([
        q(`INSERT INTO sale_items(id,tenant_id,branch_id,sale_id,product_id,
          product_name,sku,quantity_milli,unit_price_cents,created_at,
          catalog_unit_price_cents,note,configuration_json)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(sale_id,product_id) DO UPDATE SET quantity_milli=
            CASE WHEN sale_items.configuration_json=excluded.configuration_json
              AND sale_items.unit_price_cents=excluded.unit_price_cents
              AND sale_items.note=excluded.note
            THEN sale_items.quantity_milli+excluded.quantity_milli ELSE 0 END`,
          itemId,tenant,branch,id,p.id,p.name,p.sku,milli,quote.unitPriceCents,
          stamp(),p.sale_price_cents,note.trim(),configurationJSON),
        audit(tenant,scope,key,{saleId:id,productId:p.id,quantity:milli/1000,
          priceCents:quote.unitPriceCents,configuration:quote.configurationSnapshot})
      ]);
      return snapshotAfterCartChange(tenant,branch,id);
    },
    async changeConfiguredItemQuantity(tenant,branch,id,itemId,quantity){
      const sale=await tenantSale(tenant,branch,id);requireOpen(sale);
      const milli=quantityMilli(quantity);
      if(!milli)throw error(400,'Quantidade inválida.');
      const result=await run(`UPDATE sale_items SET quantity_milli=?
        WHERE sale_id=? AND tenant_id=? AND branch_id=? AND id=?
          AND configuration_json IS NOT NULL`,milli,id,tenant,branch,itemId);
      if(result.meta?.changes!==1)throw error(404,'Item configurado não encontrado.');
      return snapshotAfterCartChange(tenant,branch,id);
    },
    async removeConfiguredItem(tenant,branch,id,itemId){
      const sale=await tenantSale(tenant,branch,id);requireOpen(sale);
      const result=await run(`DELETE FROM sale_items WHERE sale_id=? AND tenant_id=? AND branch_id=?
        AND id=? AND configuration_json IS NOT NULL`,id,tenant,branch,itemId);
      if(result.meta?.changes!==1)throw error(404,'Item configurado não encontrado.');
      return snapshotAfterCartChange(tenant,branch,id);
    },
    async changeItemNote(tenant,branch,id,itemId,user,body,header){
      const key=requiredMutation(body,header),scope='sale.item-note:'+branch+':'+id+':'+itemId;
      const prior=await applied(tenant,scope,key);
      if(prior)return snapshot(tenant,branch,id);
      const sale=await tenantSale(tenant,branch,id);requireOpen(sale);
      const note=body?.note;
      if(typeof note!=='string'||note.length>240||
         /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(note))
        throw error(400,'Observação inválida: use até 240 caracteres.');
      const item=await first('SELECT id FROM sale_items WHERE tenant_id=? AND branch_id=? AND sale_id=? AND id=?',
        tenant,branch,id,itemId);
      if(!item)throw error(404,'Item não encontrado nesta venda.');
      const cleaned=note.trim();
      await batch([
        q('UPDATE sale_items SET note=? WHERE tenant_id=? AND branch_id=? AND sale_id=? AND id=?',
          cleaned,tenant,branch,id,itemId),
        audit(tenant,scope,key,{saleId:id,itemId,note:cleaned,operatorId:user})
      ]);
      return snapshot(tenant,branch,id);
    },
    async addWeightedItem(tenant,branch,id,body,header){
      const grams=body?.grams;
      if(!Number.isSafeInteger(grams)||grams<=0||grams>100000000)
        throw error(400,'Informe o peso em gramas inteiras.');
      const source=String(body?.source||'MANUAL').toUpperCase();
      if(!['MANUAL','SCALE','BARCODE'].includes(source))throw error(400,'Origem de pesagem inválida.');
      const row=await product(tenant,body?.productId);
      const unit=String(row.unit).toUpperCase();
      if(!['KG','G'].includes(unit))throw error(400,'O produto precisa estar cadastrado em KG ou G.');
      const quantity=unit==='G'?grams:grams/1000;
      return this.addItem(tenant,branch,id,{
        productId:row.id,quantity,grams,weightSource:source
      },header);
    },
    async removeWeightedItem(tenant,branch,id,itemId){
      const found=await first('SELECT product_id AS productId FROM sale_items WHERE id=? AND sale_id=? AND tenant_id=? AND branch_id=?',itemId,id,tenant,branch);
      if(!found)throw error(404,'Item pesado não encontrado.');
      return this.removeItem(tenant,branch,id,found.productId);
    },
    async overrideItemPrice(tenant,branch,id,itemId,user,body,header){
      const key=requiredMutation(body,header),scope='sale.price-override:'+branch+':'+id;
      const prior=await applied(tenant,scope,key);if(prior)return snapshot(tenant,branch,id);
      const sale=await tenantSale(tenant,branch,id);requireOpen(sale);
      const row=await first(`SELECT id,unit_price_cents AS currentPriceCents
        FROM sale_items WHERE id=? AND sale_id=? AND tenant_id=? AND branch_id=?`,
        itemId,id,tenant,branch);
      if(!row)throw error(404,'Item não encontrado na venda.');
      const price=requiredNumber(body?.unitPriceCents,'Preço unitário');
      const reason=text(body?.reason,240);
      if(reason.length<3)throw error(400,'Informe a justificativa da alteração de preço.');
      if(price===row.currentPriceCents)throw error(400,'O novo preço precisa ser diferente do anterior.');
      await batch([
        q(`INSERT INTO sale_item_price_overrides
          (id,tenant_id,branch_id,sale_id,sale_item_id,old_price_cents,
           new_price_cents,reason,actor_id,mutation_id,created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
          randomId(),tenant,branch,id,itemId,row.currentPriceCents,price,reason,user,key,stamp()),
        q(`UPDATE sale_items SET unit_price_cents=?
          WHERE id=? AND sale_id=? AND tenant_id=? AND branch_id=?`,
          price,itemId,id,tenant,branch),
        audit(tenant,scope,key,{saleId:id,itemId,unitPriceCents:price,reason})
      ]);
      return snapshotAfterCartChange(tenant,branch,id);
    },
    async changeItem(tenant,branch,id,productId,quantity){
      const sale=await tenantSale(tenant,branch,id);requireOpen(sale);
      const milli=quantityMilli(quantity);
      if(!milli)throw error(400,'Quantidade inválida: até três casas decimais.');
      const result=await run('UPDATE sale_items SET quantity_milli=? WHERE sale_id=? AND tenant_id=? AND branch_id=? AND product_id=?',
        milli,id,tenant,branch,productId);
      if(!result.meta?.changes)throw error(404,'Item não encontrado.');
      return snapshotAfterCartChange(tenant,branch,id);
    },
    async removeItem(tenant,branch,id,productId){
      const sale=await tenantSale(tenant,branch,id);requireOpen(sale);
      const result=await run('DELETE FROM sale_items WHERE sale_id=? AND tenant_id=? AND branch_id=? AND product_id=?',
        id,tenant,branch,productId);
      if(!result.meta?.changes)throw error(404,'Item não encontrado.');
      return snapshotAfterCartChange(tenant,branch,id);
    },
    async discount(tenant,branch,id,discountCents){
      const sale=await tenantSale(tenant,branch,id);requireOpen(sale);
      const value=requiredNumber(discountCents,'Desconto');
      // The pinned desktop calculates MIN(requested discount, live subtotal).
      // Persist the applied value, not the larger request: a later cart change
      // must not resurrect a discount that was never authorized against its total.
      // The subquery rounds each positive item in cents just like pricing.js.
      const result=await run(`UPDATE sales SET discount_cents=MIN(?,COALESCE((
          SELECT SUM(ROUND(unit_price_cents*quantity_milli/1000.0)) FROM sale_items
          WHERE sale_id=sales.id AND tenant_id=sales.tenant_id AND branch_id=sales.branch_id
        ),0))
        WHERE id=? AND tenant_id=? AND branch_id=? AND status='OPEN'`,
        value,id,tenant,branch);
      if(result.meta?.changes!==1)throw error(409,'A venda mudou de estado. Atualize antes de aplicar o desconto.');
      return snapshot(tenant,branch,id);
    },
    async transition(tenant,branch,id,to){
      const sale=await tenantSale(tenant,branch,id);
      const allowed=(sale.status==='OPEN'&&['SUSPENDED','CANCELLED'].includes(to))||(sale.status==='SUSPENDED'&&to==='OPEN');
      if(!allowed)throw error(409,'A venda mudou de estado; atualize antes de continuar.');
      const result=await run('UPDATE sales SET status=? WHERE id=? AND tenant_id=? AND branch_id=? AND status=?',
        to,id,tenant,branch,sale.status);
      if(result.meta?.changes!==1)throw error(409,'A venda mudou de estado; atualize antes de continuar.');
      return snapshot(tenant,branch,id);
    },
    async allSaleReturns(tenant,branch){
      await branchExists(tenant,branch);
      return all("SELECT r.id,r.sale_id AS saleId,s.sale_number AS saleNumber,r.reason,r.kind,r.amount_cents AS totalCents,r.created_at AS createdAt,CASE WHEN r.kind='CANCEL' THEN 'CANCELLED' ELSE 'COMPLETED' END AS status FROM sale_returns r JOIN sales s ON s.tenant_id=r.tenant_id AND s.branch_id=r.branch_id AND s.id=r.sale_id WHERE r.tenant_id=? AND r.branch_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 200",tenant,branch);
    },
    async quoteSaleReturn(tenant,branch,id,body){return saleReversals.quote(tenant,branch,id,body,'RETURN');},
    async saleReturns(tenant,branch,id){return saleReversals.list(tenant,branch,id);},
    async returnSale(tenant,branch,id,user,body,key){return saleReversals.reverse(tenant,branch,id,user,body,key,'RETURN');},
    async cancelCompletedSale(tenant,branch,id,user,body,key){return saleReversals.reverse(tenant,branch,id,user,body,key,'CANCEL');},
    async complete(tenant,branch,id,user,body,header){
      const key=requiredMutation(body,header),scope='sale.complete:'+id;
      const prior=await applied(tenant,scope,key);if(prior)return prior;
      const sale=await tenantSale(tenant,branch,id);requireOpen(sale);
      const rows=await all('SELECT * FROM sale_items WHERE sale_id=? ORDER BY created_at,id',id);
      if(!rows.length)throw error(400,'Adicione ao menos um produto.');
      const mapped=rows.map(row=>({unitPriceCents:row.unit_price_cents,quantity:row.quantity_milli/1000}));
      const totals=calculateSaleTotals({items:mapped,discountCents:sale.discount_cents});
      const payments=body?.payments;
      if(!Array.isArray(payments)||!payments.length||payments.length>6)throw error(400,'Informe a forma de pagamento.');
      const normalized=payments.map(p=>{
        const method=normalizeMethod(p?.method);
        if(!allowedPayments.has(method)||!integer(p?.amountCents)||p.amountCents<=0)
          throw error(400,'Forma ou valor de pagamento inválido.');
        return {method,amountCents:p.amountCents};
      });
      // Cash movements are one per method; coalesce duplicate methods, preserving total.
      const grouped=new Map();
      for(const p of normalized)grouped.set(p.method,(grouped.get(p.method)||0)+p.amountCents);
      const groupedPayments=[...grouped].map(([method,amountCents])=>({method,amountCents}));
      const creditCents=grouped.get('STORE_CREDIT')||0;
       let customer=null,usedCreditCents=0;
       if(creditCents){
         if(!sale.customer_id)throw error(409,'Selecione um cliente para usar o crediário.');
         customer=await first('SELECT id,name,credit_limit_cents AS creditLimitCents FROM customers WHERE tenant_id=? AND id=? AND active=1',tenant,sale.customer_id);
         if(!customer)throw error(404,'Cliente não encontrado neste estabelecimento.');
         const usage=await first('SELECT COALESCE(SUM(amount_cents),0) AS used FROM customer_credit_ledger WHERE tenant_id=? AND customer_id=?',tenant,customer.id);
         usedCreditCents=usage.used;
       }
       let payment;
       try{payment=resolvePayment({totalCents:totals.totalCents,payments:groupedPayments,creditMethods:['STORE_CREDIT'],availableCreditCents:customer?Math.max(0,customer.creditLimitCents-usedCreditCents):0,customerName:customer?.name});}
       catch(e){throw error(409,e.message);}
      if(payment.status!=='paid')throw error(409,'Pagamento incompleto. Revise os valores antes de finalizar.');
      const cash=await this.cash(tenant,branch,sale.terminal_id||'DEFAULT');
      if(!cash)throw error(409,'Abra o caixa deste terminal antes de finalizar a venda.');
      const completedAt=stamp();
      const result={
        id,saleNumber:sale.sale_number,status:'COMPLETED',
        subtotalCents:totals.subtotalCents,discountCents:totals.discountCents,
        totalCents:totals.totalCents,changeCents:payment.changeDueCents,
        branchId:branch,terminalId:sale.terminal_id||'DEFAULT',completedAt,
        items:rows.map(x=>({productId:x.product_id,quantity:x.quantity_milli/1000,unitPriceCents:x.unit_price_cents})),
        payments:groupedPayments
      };
      const statements=[
        q(`UPDATE sales SET status='COMPLETED',subtotal_cents=?,discount_cents=?,
          total_cents=?,change_cents=?,completed_at=?,cash_session_id=?
          WHERE id=? AND tenant_id=? AND branch_id=? AND status='OPEN'`,
          totals.subtotalCents,totals.discountCents,totals.totalCents,payment.changeDueCents,
          completedAt,cash.id,id,tenant,branch)
      ];
      // Allocate all stock demands through the same immutable sale ledger.
      // Multiple kits may consume the same component: aggregate once per
      // sale/product to respect the existing UNIQUE stock movement contract.
      const debits=new Map(),lotCache=new Map(),lotAllocations=[];
      for(const line of rows){
        const p=await product(tenant,line.product_id);
        const kit=await all(`SELECT b.component_id AS productId,b.quantity_milli AS quantityMilli,
          p.last_cost_cents AS unitCostCents FROM product_bundle_components b
          JOIN products p ON p.id=b.component_id AND p.tenant_id=b.tenant_id
          WHERE b.tenant_id=? AND b.kit_id=? ORDER BY b.component_id`,tenant,line.product_id);
        if(p.track_stock&&kit.length)throw error(409,'Produto com estoque próprio não pode ser kit.');
        const allocations=kit.length?kit.map(c=>{
          const numerator=line.quantity_milli*c.quantityMilli;
          if(!Number.isSafeInteger(numerator)||numerator%1000!==0)
            throw error(409,'Composição do kit não suporta esta quantidade fracionada.');
          return {productId:c.productId,milli:numerator/1000,cost:c.unitCostCents};
        }):p.track_stock?[{productId:p.id,milli:line.quantity_milli,cost:p.last_cost_cents||0}]:[];
        for(const a of allocations){
          if(a.milli<=0)throw error(409,'Componente fracionário abaixo da precisão de estoque.');
          debits.set(a.productId,(debits.get(a.productId)||0)+a.milli);
          const picked=await lotLedger.consume(tenant,branch,a.productId,a.milli,lotCache);
          if(picked.length)lotAllocations.push({productId:a.productId,itemId:line.id,picked});
          statements.push(q(`INSERT INTO sale_stock_allocations
            (id,tenant_id,branch_id,sale_id,sale_item_id,component_product_id,quantity_milli,unit_cost_cents,created_at)
            VALUES(?,?,?,?,?,?,?,?,?)`,randomId(),tenant,branch,id,line.id,a.productId,a.milli,a.cost,completedAt));
        }
      }
      const movementIds=new Map();
      for(const [productId,milli] of debits){
        const movementId=randomId();
        movementIds.set(productId,movementId);
        statements.push(q('INSERT INTO inventory_movements(id,tenant_id,branch_id,product_id,delta_milli,type,sale_id,mutation_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)',
          movementId,tenant,branch,productId,-milli,'sale',id,key,completedAt));
      }
      for(const allocation of lotAllocations){
        statements.push(...lotLedger.statements(tenant,branch,allocation.productId,
          movementIds.get(allocation.productId),allocation.picked,-1,completedAt,allocation.itemId));
      }
      for(const p of groupedPayments){
        if(p.method==='STORE_CREDIT'){
          statements.push(q(`INSERT INTO customer_credit_ledger(id,tenant_id,branch_id,customer_id,sale_id,type,amount_cents,reference_key,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)`,
            randomId(),tenant,branch,customer.id,id,'CHARGE',p.amountCents,'sale:'+id,completedAt));
          continue;
        }
        statements.push(q('INSERT INTO sale_payments(id,tenant_id,branch_id,sale_id,method,amount_cents,created_at) VALUES(?,?,?,?,?,?,?)',
          randomId(),tenant,branch,id,p.method,p.amountCents,completedAt));
        // The tendered cash and change are reported separately; only net cash
        // enters the drawer. A zero net amount must not generate a movement.
        const drawerCents=p.method==='CASH'?p.amountCents-payment.changeDueCents:p.amountCents;
        if(drawerCents>0)statements.push(q('INSERT INTO cash_movements(id,tenant_id,branch_id,cash_session_id,sale_id,method,amount_cents,created_at) VALUES(?,?,?,?,?,?,?,?)',
          randomId(),tenant,branch,cash.id,id,p.method,drawerCents,completedAt));
      }
      // Commission rules are read from the single tenant registry and snapshotted
      // in an immutable financial ledger in the same transaction as sale completion.
      const sellerId=sale.seller_id||sale.operator_id;
      const discounted=allocateSaleDiscount(rows.map(r=>({id:r.id,productId:r.product_id,unitPriceCents:r.unit_price_cents,quantity:r.quantity_milli/1000})),totals.discountCents);
      for(const line of discounted){
        const rule=await first(`SELECT commission_bps AS bps FROM seller_commission_rules
          WHERE tenant_id=? AND seller_id=? AND active=1 AND (product_id=? OR product_id IS NULL)
          ORDER BY CASE WHEN product_id=? THEN 0 ELSE 1 END LIMIT 1`,tenant,sellerId,line.productId,line.productId);
        const commissionCents=Math.round(line.netTotalCents*(rule?.bps||0)/10000);
        if(commissionCents>0)statements.push(q(`INSERT INTO seller_commission_ledger(id,tenant_id,branch_id,seller_id,sale_id,sale_item_id,kind,amount_cents,reference_key,occurred_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)`,randomId(),tenant,branch,sellerId,id,line.id,'EARNED',commissionCents,'sale:'+id+':item:'+line.id,completedAt));
      }
      const wholesaleOrder=await first('SELECT id FROM wholesale_orders WHERE tenant_id=? AND branch_id=? AND sale_id=? AND status=?',tenant,branch,id,'CONFIRMED');
      if(wholesaleOrder)statements.push(q("UPDATE wholesale_orders SET status='FULFILLED',updated_at=? WHERE tenant_id=? AND branch_id=? AND sale_id=? AND status='CONFIRMED'",completedAt,tenant,branch,id));
      // Stock is decremented only in the same D1 batch; no secondary EventBus
      // inventory subscriber is registered, therefore one sale has one effect.
      statements.push(q('INSERT INTO domain_events(id,tenant_id,branch_id,aggregate_type,aggregate_id,type,payload_json,mutation_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)',
        randomId(),tenant,branch,'sale',id,'sale.completed',JSON.stringify({
          items:result.items,totalCents:result.totalCents,
          discountCents:result.discountCents,payments:result.payments
        }),key,completedAt));
      statements.push(audit(tenant,scope,key,result));
      await batch(statements);
      return result;
    }
  };
}
export function commerceError(errorValue){
  return {status:Number.isInteger(errorValue?.status)?errorValue.status:500,
    message:errorValue?.status?errorValue.message:'Erro interno. Operação não confirmada.'};
}
