// D1 persistence adapter for the one PDV domain. Arithmetic, stock rounding and
// payment rules are imported unchanged from packages/core; this is NOT a second core.
import salePricing from '../../../packages/core/js/domains/sales/pricing.js';
import paymentRules from '../../../packages/core/js/domains/payments/payment-rules.js';
import inventoryRules from '../../../packages/core/js/domains/inventory/inventory-rules.js';
import cashRules from '../../../packages/core/js/domains/cash/cash-rules.js';

const {calculateSaleTotals,allocateSaleDiscount}=salePricing;
const {resolvePayment,normalizeMethod}=paymentRules;
const {roundQuantity}=inventoryRules;
const {calculateCashClosing}=cashRules;
const MAX_LINES=80;
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
  if(/CHECK constraint failed: stock_positions|CHECK constraint failed:.*balance_milli|INSUFFICIENT_STOCK/i.test(message))return error(409,'Estoque insuficiente. Atualize a disponibilidade e tente novamente.');
  if(/CASH_SESSION_NOT_OPEN/i.test(message))return error(409,'O caixa foi fechado. Abra outro antes de finalizar.');
  if(/CASH_INSUFFICIENT/i.test(message))return error(409,'Saldo físico insuficiente para a sangria.');
  if(/CASH_CLOSING_STALE/i.test(message))return error(409,'O saldo do caixa mudou. Atualize e confira novamente.');
  if(/CREDIT_LIMIT_EXCEEDED/i.test(message))return error(409,'Limite de crédito insuficiente. Atualize a ficha do cliente.');
  if(/FINANCE_OVERPAY_OR_CANCELLED/i.test(message))return error(409,'A conta mudou de situação ou o pagamento excede o saldo.');
  if(/SALE_NOT_OPEN|FINAL_SALE_IMMUTABLE/i.test(message))return error(409,'Esta venda mudou de estado. Atualize antes de continuar.');
  if(/UNIQUE constraint failed|constraint failed/i.test(message))return error(409,'Registro já alterado. Atualize os dados e tente novamente.');
  return e;
}

function formatSale(sale,items=[],payments=[]){
  return {
    id:sale.id,tenantId:sale.tenant_id,branchId:sale.branch_id,
    saleNumber:sale.sale_number,operatorId:sale.operator_id,
    status:sale.status,customerId:sale.customer_id||null,sellerId:sale.seller_id||sale.operator_id,subtotalCents:sale.subtotal_cents,
    discountCents:sale.discount_cents,totalCents:sale.total_cents,
    changeCents:sale.change_cents,completedAt:sale.completed_at,
    items:items.map(row=>({
      id:row.id,productId:row.product_id,productName:row.product_name,
      sku:row.sku,quantity:row.quantity_milli/1000,
      unitPriceCents:row.unit_price_cents,
      catalogUnitPriceCents:row.catalog_unit_price_cents??row.unit_price_cents,
      priceOverrideReason:row.price_override_reason||null,
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
    return formatSale(sale,items,[...payments,...credit]);
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
    return [...sales,...adjustments,...credits].sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))||String(a.id).localeCompare(String(b.id)));
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
      COALESCE(SUM(f.amount_cents),0) AS settledCents
      FROM finance_entries e LEFT JOIN finance_settlements f ON f.entry_id=e.id
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
  return {
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
        ORDER BY occurred_at DESC,id DESC LIMIT ? OFFSET ?`,...args,limit,offset);
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
      await batch([
        q(`INSERT INTO inventory_movements
          (id,tenant_id,branch_id,product_id,delta_milli,type,sale_id,mutation_id,occurred_at,reason)
          VALUES(?,?,?,?,?,?,?,?,?,?)`,
          result.movementId,tenant,branch,p.id,delta,'adjustment',null,key,stamp(),reason),
        audit(tenant,scope,key,result)
      ]);
      return result;
    },
    async products(tenant,branch,{includeInactive=false,limit=100}={}){
      await branchExists(tenant,branch);
      const cap=Math.min(100,Math.max(1,Math.trunc(Number(limit)||100)));
      const rows=await all(`SELECT p.id,p.sku,p.name,p.sale_price_cents AS salePriceCents,p.unit,
        p.track_stock AS trackStock,p.active,COALESCE(s.balance_milli,0) AS balanceMilli
        FROM products p LEFT JOIN stock_positions s ON s.tenant_id=p.tenant_id
        AND s.product_id=p.id AND s.branch_id=?
        WHERE p.tenant_id=? AND (?=1 OR p.active=1)
        ORDER BY p.name,p.id LIMIT ?`,branch,tenant,includeInactive?1:0,cap);
      return rows.map(x=>({...x,trackStock:Boolean(x.trackStock),active:Boolean(x.active),balance:x.balanceMilli/1000,menuEnabled:true,categoryId:null,barcode:x.sku}));
    },
    async createProduct(tenant,user,body,header){
      const key=requiredMutation(body,header),scope='product.create';
      const prior=await applied(tenant,scope,key);if(prior)return prior;
      const name=text(body?.name,120),sku=text(body?.sku,64).toUpperCase();
      if(!name||name.length<2||!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(sku))throw error(400,'Informe nome e SKU válido.');
      const price=requiredNumber(body?.salePriceCents,'Preço');
      const unit=String(body?.unit||'UN').trim().toUpperCase();
      if(!new Set(['UN','KG','G','L','M','M2','M3','CX','PCT']).has(unit))throw error(400,'Unidade de produto inválida.');
      const id=randomId(),created=stamp();
      const result={id,name,sku,salePriceCents:price,unit,trackStock:body?.trackStock!==false,active:true};
      await batch([
        q('INSERT INTO products(id,tenant_id,sku,name,sale_price_cents,unit,track_stock,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
          id,tenant,sku,name,price,unit,result.trackStock?1:0,created,created),
        audit(tenant,scope,key,result)
      ]);
      return result;
    },
    async updateProduct(tenant,branch,id,body,header){
      await branchExists(tenant,branch);
      const key=requiredMutation(body,header),scope='product.update:'+id;
      const previous=await applied(tenant,scope,key);if(previous)return previous;
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
      const result={id,name,sku,unit,salePriceCents:price,
        trackStock:Boolean(old.track_stock),active,updatedAt:stamp()};
      await batch([
        q('UPDATE products SET name=?,sku=?,sale_price_cents=?,unit=?,active=?,updated_at=? WHERE id=? AND tenant_id=?',
          name,sku,price,unit,active?1:0,result.updatedAt,id,tenant),
        audit(tenant,scope,key,result)
      ]);
      return result;
    },
    async receipt(tenant,branch,body,header){
      await branchExists(tenant,branch);
      const key=requiredMutation(body,header),scope='inventory.receipt:'+branch;
      const prior=await applied(tenant,scope,key);if(prior)return prior;
      const row=await product(tenant,body?.productId);
      if(!row.track_stock)throw error(409,'Este produto não controla estoque físico.');
      const milli=quantityMilli(body?.quantity);
      if(!milli)throw error(400,'Informe quantidade positiva com até três casas decimais.');
      const kind=body?.type==='opening'?'opening':'purchase';
      const result={movementId:randomId(),productId:row.id,branchId:branch,quantity:milli/1000,type:kind};
      await batch([
        q('INSERT INTO inventory_movements(id,tenant_id,branch_id,product_id,delta_milli,type,sale_id,mutation_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)',
          result.movementId,tenant,branch,row.id,milli,kind,null,key,stamp()),
        audit(tenant,scope,key,result)
      ]);
      return result;
    },
    async stock(tenant,branch,limit=100){
      await branchExists(tenant,branch);
      return all(`SELECT p.id AS productId,p.name,p.sku,COALESCE(s.balance_milli,0)/1000.0 AS quantity
        FROM products p LEFT JOIN stock_positions s ON s.tenant_id=p.tenant_id AND s.product_id=p.id AND s.branch_id=?
        WHERE p.tenant_id=? AND p.track_stock=1 AND p.active=1 ORDER BY p.name LIMIT ?`,branch,tenant,Math.min(100,Math.max(1,Number(limit)||100)));
    },
    async cash(tenant,branch){
      await branchExists(tenant,branch);
      const row=await first(`SELECT * FROM cash_sessions c WHERE c.tenant_id=? AND c.branch_id=?
        AND c.status='OPEN' LIMIT 1`,tenant,branch);
      if(!row)return null;
      const {closing}=await cashClosing(tenant,branch,row,0);
      return {id:row.id,status:row.status,operatorId:row.operator_id,
        openingCents:row.opening_cents,initialCashCents:row.opening_cents,
        openedAt:row.opened_at,expectedCashCents:closing.expectedCashCents,
        branchId:branch};
    },
    async openCash(tenant,branch,user,body,header){
      await branchExists(tenant,branch);
      const key=requiredMutation(body,header),scope='cash.open:'+branch;
      const prior=await applied(tenant,scope,key);if(prior)return prior;
      const opening=requiredNumber(body?.openingCents??body?.initialCashCents,'Valor inicial');
      const result={id:randomId(),status:'OPEN',openingCents:opening,branchId:branch,openedAt:stamp(),operatorId:user};
      await batch([
        q('INSERT INTO cash_sessions(id,tenant_id,branch_id,operator_id,status,opening_cents,opened_at) VALUES(?,?,?,?,?,?,?)',
          result.id,tenant,branch,user,'OPEN',opening,result.openedAt),
        audit(tenant,scope,key,result)
      ]);
      return result;
    },

    async cashSessions(tenant,branch,{limit=40}={}){
      await branchExists(tenant,branch);
      const rows=await all(`SELECT * FROM cash_sessions WHERE tenant_id=? AND branch_id=?
        ORDER BY opened_at DESC,id DESC LIMIT ?`,tenant,branch,Math.min(50,Math.max(1,Number(limit)||40)));
      return Promise.all(rows.map(async row=>{
        const {closing}=await cashClosing(tenant,branch,row,row.counted_cash_cents||0);
        return {id:row.id,operatorId:row.operator_id,status:row.status,
          openedAt:row.opened_at,closedAt:row.closed_at,
          openingCents:row.opening_cents,initialCashCents:row.opening_cents,
          expectedCashCents:row.expected_cash_cents??closing.expectedCashCents,
          countedCashCents:row.counted_cash_cents,divergenceCents:row.divergence_cents,
          branchId:branch};
      }));
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
          COALESCE(SUM(f.amount_cents),0) AS settledCents
        FROM finance_entries e LEFT JOIN finance_settlements f ON f.entry_id=e.id
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
        LEFT JOIN (SELECT entry_id,SUM(amount_cents) AS paid FROM finance_settlements GROUP BY entry_id) fs
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
    async reports(tenant,branch,{from,to}={}){
      await branchExists(tenant,branch);
      const {a,b}=period({from,to});
      const sales=await first(`SELECT COUNT(*) AS count,COALESCE(SUM(total_cents),0) AS totalCents,
        COALESCE(SUM(discount_cents),0) AS discountsCents FROM sales
        WHERE tenant_id=? AND branch_id=? AND status='COMPLETED' AND completed_at>=? AND completed_at<=?`,
        tenant,branch,a,b);
      const payments=await all(`SELECT p.method,COALESCE(SUM(CASE WHEN p.method='CASH'
        THEN p.amount_cents-s.change_cents ELSE p.amount_cents END),0) AS amountCents
        FROM sale_payments p JOIN sales s ON s.id=p.sale_id
        WHERE s.tenant_id=? AND s.branch_id=? AND s.status='COMPLETED' AND s.completed_at>=? AND s.completed_at<=?
        GROUP BY p.method ORDER BY p.method`,tenant,branch,a,b);
      const products=await all(`SELECT si.product_id AS productId,si.product_name AS name,
        SUM(si.quantity_milli)/1000.0 AS quantity,COUNT(DISTINCT si.sale_id) AS salesCount,
        SUM(si.quantity_milli*si.unit_price_cents)/1000 AS grossCents
        FROM sale_items si JOIN sales s ON s.id=si.sale_id
        WHERE s.tenant_id=? AND s.branch_id=? AND s.status='COMPLETED' AND s.completed_at>=? AND s.completed_at<=?
        GROUP BY si.product_id,si.product_name ORDER BY grossCents DESC LIMIT 50`,tenant,branch,a,b);
      const inventory=await this.stock(tenant,branch,100);
      const cash=await this.cashSessions(tenant,branch,{limit:50});
      const finance=await this.financeSummary(tenant,branch);
      return {period:{from:from||null,to:to||null},sales,methodTotals:payments,
        products,inventory,cash,finance};
    },
    async salesCsv(tenant,branch,{from,to}={}){
      const {a,b}=period({from,to});
      await branchExists(tenant,branch);
      const rows=await all(`SELECT sale_number AS saleNumber,completed_at AS completedAt,
        total_cents AS totalCents,discount_cents AS discountCents,operator_id AS operatorId
        FROM sales WHERE tenant_id=? AND branch_id=? AND status='COMPLETED'
        AND completed_at>=? AND completed_at<=? ORDER BY completed_at,id LIMIT 3000`,tenant,branch,a,b);
      const cell=v=>'"'+String(v??'').replace(/"/g,'""').replace(/^[=+@-]/,'\u0027    async openSale(tenant,branch,user,body,header){')+'"';
      return '\uFEFF'+'Venda;Data;Total (R$);Desconto (R$);Operador\r\n'+
        rows.map(x=>[x.saleNumber,x.completedAt,(x.totalCents/100).toFixed(2).replace('.',','),(x.discountCents/100).toFixed(2).replace('.',','),x.operatorId]
          .map(cell).join(';')).join('\r\n');
    },
    async openSale(tenant,branch,user,body,header){
      await branchExists(tenant,branch);
      const key=requiredMutation(body,header),scope='sale.open:'+branch;
      const prior=await applied(tenant,scope,key);if(prior)return prior;
      const id=randomId(),created=stamp(),saleNumber='W-'+id.slice(0,8).toUpperCase();
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
      const result={id,tenantId:tenant,branchId:branch,saleNumber,operatorId:user,sellerId,customerId:order?.customer_id||null,status:'OPEN',
        items:quoted.map(x=>({productId:x.productId,productName:x.name,sku:x.sku,quantity:x.milli/1000,unitPriceCents:x.unitPriceCents,totalCents:Math.round(x.unitPriceCents*x.milli/1000)})),
        payments:[],subtotalCents:quotedTotals.subtotalCents,discountCents:0,totalCents:quotedTotals.totalCents,changeCents:0,completedAt:null};
      // One sale authority: a quote is a price snapshot, not a second sale.
      // INSERT..SELECT prevents concurrent checkouts from claiming the same quote twice.
      const statements=[wholesaleId
        ?q(`INSERT INTO sales(id,tenant_id,branch_id,operator_id,seller_id,customer_id,sale_number,status,created_at)
          SELECT ?,tenant_id,branch_id,?,?,customer_id,?,'OPEN',?
          FROM wholesale_orders WHERE tenant_id=? AND branch_id=? AND id=? AND status='CONFIRMED' AND sale_id IS NULL`,
          id,user,sellerId,saleNumber,created,tenant,branch,wholesaleId)
        :q('INSERT INTO sales(id,tenant_id,branch_id,operator_id,seller_id,sale_number,status,created_at) VALUES(?,?,?,?,?,?,?,?)',
          id,tenant,branch,user,sellerId,saleNumber,'OPEN',created)];
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
      const existing=await first('SELECT id,quantity_milli AS milli FROM sale_items WHERE sale_id=? AND product_id=?',id,row.id);
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
      return snapshot(tenant,branch,id);
    },
    async changeItem(tenant,branch,id,productId,quantity){
      const sale=await tenantSale(tenant,branch,id);requireOpen(sale);
      const milli=quantityMilli(quantity);
      if(!milli)throw error(400,'Quantidade inválida: até três casas decimais.');
      const result=await run('UPDATE sale_items SET quantity_milli=? WHERE sale_id=? AND tenant_id=? AND branch_id=? AND product_id=?',
        milli,id,tenant,branch,productId);
      if(!result.meta?.changes)throw error(404,'Item não encontrado.');
      return snapshot(tenant,branch,id);
    },
    async removeItem(tenant,branch,id,productId){
      const sale=await tenantSale(tenant,branch,id);requireOpen(sale);
      const result=await run('DELETE FROM sale_items WHERE sale_id=? AND tenant_id=? AND branch_id=? AND product_id=?',
        id,tenant,branch,productId);
      if(!result.meta?.changes)throw error(404,'Item não encontrado.');
      return snapshot(tenant,branch,id);
    },
    async discount(tenant,branch,id,discountCents){
      const sale=await tenantSale(tenant,branch,id);requireOpen(sale);
      const value=requiredNumber(discountCents,'Desconto');
      await run('UPDATE sales SET discount_cents=? WHERE id=? AND tenant_id=? AND branch_id=? AND status=?',
        value,id,tenant,branch,'OPEN');
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
      const cash=await this.cash(tenant,branch);
      if(!cash)throw error(409,'Abra o caixa antes de finalizar a venda.');
      const completedAt=stamp();
      const result={
        id,saleNumber:sale.sale_number,status:'COMPLETED',
        subtotalCents:totals.subtotalCents,discountCents:totals.discountCents,
        totalCents:totals.totalCents,changeCents:payment.changeDueCents,
        branchId:branch,completedAt,
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
      for(const line of rows){
        const p=await product(tenant,line.product_id);
        if(p.track_stock){
          statements.push(q('INSERT INTO inventory_movements(id,tenant_id,branch_id,product_id,delta_milli,type,sale_id,mutation_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)',
            randomId(),tenant,branch,line.product_id,-line.quantity_milli,'sale',id,key,completedAt));
        }
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
