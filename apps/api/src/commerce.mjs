// D1 persistence adapter for the one PDV domain. Arithmetic, stock rounding and
// payment rules are imported unchanged from packages/core; this is NOT a second core.
import salePricing from '../../../packages/core/js/domains/sales/pricing.js';
import paymentRules from '../../../packages/core/js/domains/payments/payment-rules.js';
import inventoryRules from '../../../packages/core/js/domains/inventory/inventory-rules.js';

const {calculateSaleTotals}=salePricing;
const {resolvePayment,normalizeMethod}=paymentRules;
const {roundQuantity}=inventoryRules;
const MAX_LINES=80;
const nowISO=()=>new Date().toISOString();
const randomId=()=>crypto.randomUUID();
const error=(status,message)=>Object.assign(new Error(message),{status});
const allowedPayments=new Set(['CASH','PIX','DEBIT_CARD','CREDIT_CARD','OTHER']);
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
  if(/SALE_NOT_OPEN|FINAL_SALE_IMMUTABLE/i.test(message))return error(409,'Esta venda mudou de estado. Atualize antes de continuar.');
  if(/UNIQUE constraint failed|constraint failed/i.test(message))return error(409,'Registro já alterado. Atualize os dados e tente novamente.');
  return e;
}

function formatSale(sale,items=[],payments=[]){
  return {
    id:sale.id,tenantId:sale.tenant_id,branchId:sale.branch_id,
    saleNumber:sale.sale_number,operatorId:sale.operator_id,
    status:sale.status,subtotalCents:sale.subtotal_cents,
    discountCents:sale.discount_cents,totalCents:sale.total_cents,
    changeCents:sale.change_cents,completedAt:sale.completed_at,
    items:items.map(row=>({
      id:row.id,productId:row.product_id,productName:row.product_name,
      sku:row.sku,quantity:row.quantity_milli/1000,
      unitPriceCents:row.unit_price_cents,
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
    const items=await all('SELECT * FROM sale_items WHERE sale_id=? ORDER BY created_at,id',sale.id);
    const payments=await all('SELECT * FROM sale_payments WHERE sale_id=? ORDER BY created_at,id',sale.id);
    return formatSale(sale,items,payments);
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
      const id=randomId(),created=stamp();
      const result={id,name,sku,salePriceCents:price,unit:'UN',trackStock:body?.trackStock!==false,active:true};
      await batch([
        q('INSERT INTO products(id,tenant_id,sku,name,sale_price_cents,unit,track_stock,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
          id,tenant,sku,name,price,'UN',result.trackStock?1:0,created,created),
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
      return first(`SELECT c.id,c.status,c.opening_cents AS openingCents,c.opened_at AS openedAt,
        c.operator_id AS operatorId FROM cash_sessions c
        WHERE c.tenant_id=? AND c.branch_id=? AND c.status='OPEN' LIMIT 1`,tenant,branch);
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
    async openSale(tenant,branch,user,body,header){
      await branchExists(tenant,branch);
      const key=requiredMutation(body,header),scope='sale.open:'+branch;
      const prior=await applied(tenant,scope,key);if(prior)return prior;
      const id=randomId(),created=stamp();
      const saleNumber='W-'+id.slice(0,8).toUpperCase();
      const result={id,tenantId:tenant,branchId:branch,saleNumber,operatorId:user,status:'OPEN',
        items:[],payments:[],subtotalCents:0,discountCents:0,totalCents:0,changeCents:0,completedAt:null};
      await batch([
        q('INSERT INTO sales(id,tenant_id,branch_id,operator_id,sale_number,status,created_at) VALUES(?,?,?,?,?,?,?)',
          id,tenant,branch,user,saleNumber,'OPEN',created),
        audit(tenant,scope,key,result)
      ]);
      return result;
    },
    sale: snapshot,
    listSales:listing,
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
      const safe={saleId:id,productId:row.id,quantity:milli/1000};
      await batch([
        q(`INSERT INTO sale_items(id,tenant_id,branch_id,sale_id,product_id,product_name,sku,quantity_milli,unit_price_cents,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(sale_id,product_id) DO UPDATE SET quantity_milli=sale_items.quantity_milli+excluded.quantity_milli`,
          itemId,tenant,branch,id,row.id,row.name,row.sku,milli,row.sale_price_cents,stamp()),
        audit(tenant,scope,key,safe)
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
      const payment=resolvePayment({totalCents:totals.totalCents,payments:groupedPayments,creditMethods:[]});
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
        statements.push(q('INSERT INTO sale_payments(id,tenant_id,branch_id,sale_id,method,amount_cents,created_at) VALUES(?,?,?,?,?,?,?)',
          randomId(),tenant,branch,id,p.method,p.amountCents,completedAt));
        // The tendered cash and change are reported separately; only net cash
        // enters the drawer. A zero net amount must not generate a movement.
        const drawerCents=p.method==='CASH'?p.amountCents-payment.changeDueCents:p.amountCents;
        if(drawerCents>0)statements.push(q('INSERT INTO cash_movements(id,tenant_id,branch_id,cash_session_id,sale_id,method,amount_cents,created_at) VALUES(?,?,?,?,?,?,?,?)',
          randomId(),tenant,branch,cash.id,id,p.method,drawerCents,completedAt));
      }
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
