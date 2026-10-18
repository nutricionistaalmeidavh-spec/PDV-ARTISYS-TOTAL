import {pricedSaleLines} from './sale-configured-lines.mjs';
// Additive persistence adapter for compensations. Uses the same canonical sale
// pricing, inventory ledger and cash rules injected by commerce.mjs.
export function createSaleReturnAdapter(helpers){
  const {q,first,all,batch,applied,audit,stamp,tenantSale,requiredMutation,quantityMilli,
    normalizeMethod,allocateSaleDiscount,getCash,error,text,randomId,lotLedger}=helpers;
  const refundMethods=new Set(['CASH','PIX','DEBIT_CARD','CREDIT_CARD','OTHER','STORE_CREDIT']);
  async function prepare(tenant,branch,id,body,mode){
    const sale=await tenantSale(tenant,branch,id);
    if(sale.status!=='COMPLETED')
      throw error(409,'Somente vendas concluídas podem ser devolvidas ou canceladas.');
    const reason=text(body?.reason,240);
    if(reason.length<3)throw error(400,'Informe motivo operacional para a devolução.');
    const original=await all(`SELECT * FROM sale_items
      WHERE tenant_id=? AND branch_id=? AND sale_id=? ORDER BY created_at,id`,tenant,branch,id);
    const priced=await pricedSaleLines(all,tenant,branch,id,original);
    const priorItems=await all(`SELECT ri.sale_item_id AS saleItemId,
      COALESCE(SUM(ri.quantity_milli),0) AS returnedMilli
      FROM sale_return_items ri WHERE ri.tenant_id=? AND ri.branch_id=? AND ri.sale_id=?
      GROUP BY ri.sale_item_id`,tenant,branch,id);
    const returned=new Map(priorItems.map(x=>[x.saleItemId,x.returnedMilli]));
    const priorConfigured=await all(`SELECT configured_line_id AS configuredLineId,
      COALESCE(SUM(quantity_milli),0) AS returnedMilli
      FROM sale_configured_return_lines
      WHERE tenant_id=? AND branch_id=? AND sale_id=?
      GROUP BY configured_line_id`,tenant,branch,id);
    const returnedConfigured=new Map(priorConfigured.map(x=>[x.configuredLineId,x.returnedMilli]));
    const available=row=>row.quantity_milli-
      (row.parent_item_id?(returnedConfigured.get(row.id)||0):(returned.get(row.id)||0));
    const wanted=mode==='CANCEL'
      ?priced.map(item=>({saleItemId:item.id,quantityMilli:available(item)}))
        .filter(item=>item.quantityMilli>0)
      :Array.isArray(body?.items)?body.items.map(item=>({
        saleItemId:item?.saleItemId,quantityMilli:quantityMilli(item?.quantity)
      })):[];
    if(wanted.length<1||wanted.length>80)throw error(409,'Não há itens disponíveis para devolução.');
    if(new Set(wanted.map(x=>x.saleItemId)).size!==wanted.length||
      wanted.some(x=>!x.quantityMilli))
      throw error(400,'Itens ou quantidades inválidos ou duplicados.');
    const discounts=allocateSaleDiscount(priced.map(row=>({
      id:row.id,productId:row.product_id,
      unitPriceCents:row.unit_price_cents,quantity:row.quantity_milli/1000
    })),sale.discount_cents);
    const discounted=new Map(discounts.map(row=>[row.id,row]));
    const details=[];
    for(const request of wanted){
      const source=priced.find(row=>row.id===request.saleItemId);
      if(!source)throw error(404,'Item não pertence à venda.');
      const prev=source.parent_item_id?(returnedConfigured.get(source.id)||0):(returned.get(source.id)||0);
      if(request.quantityMilli>source.quantity_milli-prev)
        throw error(409,'Quantidade devolvida excede quantidade vendida.');
      const price=discounted.get(source.id);
      const netCents=Math.round(price.netTotalCents*(prev+request.quantityMilli)/source.quantity_milli)
        -Math.round(price.netTotalCents*prev/source.quantity_milli);
      details.push({saleItemId:source.parent_item_id||source.id,
        configuredLineId:source.parent_item_id?source.id:null,
        quantityMilli:request.quantityMilli,netCents});
    }
    const grouping=new Map();
    for(const detail of details){
      const source=original.find(row=>row.id===detail.saleItemId);
      let parent=grouping.get(detail.saleItemId);
      if(!parent){parent={saleItemId:detail.saleItemId,source,quantityMilli:0,netCents:0};
        grouping.set(detail.saleItemId,parent);}
      parent.quantityMilli+=detail.quantityMilli;
      parent.netCents+=detail.netCents;
    }
    const computed=[...grouping.values()];
    const totalCents=details.reduce((sum,row)=>sum+row.netCents,0);
    const fullReturn=original.every(row=>{
      const delta=grouping.get(row.id)?.quantityMilli||0;
      return (returned.get(row.id)||0)+delta===row.quantity_milli;
    });
    if(mode==='CANCEL'&&!fullReturn)
      throw error(409,'O cancelamento exige devolução integral dos itens.');
    return {sale,reason,original,priced,returned,computed,details,totalCents};
  }
  return {
    async quote(tenant,branch,id,body,mode='RETURN'){
      const {sale,reason,details,totalCents}=await prepare(tenant,branch,id,body,mode);
      return {saleId:id,status:sale.status,reason,amountCents:totalCents,
        items:details.map(row=>({saleItemId:row.configuredLineId||row.saleItemId,
          parentItemId:row.saleItemId,quantity:row.quantityMilli/1000,netCents:row.netCents}))};
    },
    async list(tenant,branch,id){
      await tenantSale(tenant,branch,id);
      const rows=await all('SELECT * FROM sale_returns WHERE tenant_id=? AND branch_id=? AND sale_id=? ORDER BY created_at,id',tenant,branch,id);
      return Promise.all(rows.map(async r=>({
        id:r.id,kind:r.kind,reason:r.reason,amountCents:r.amount_cents,operatorId:r.operator_id,createdAt:r.created_at,
        items:await (async()=>{
          const canonical=await all('SELECT sale_item_id AS saleItemId,quantity_milli/1000.0 AS quantity,net_cents AS netCents FROM sale_return_items WHERE return_id=? ORDER BY id',r.id);
          const choices=await all('SELECT configured_line_id AS saleItemId,sale_item_id AS parentItemId,quantity_milli/1000.0 AS quantity,net_cents AS netCents FROM sale_configured_return_lines WHERE return_id=? ORDER BY id',r.id);
          const parents=new Set(choices.map(row=>row.parentItemId));
          return canonical.filter(row=>!parents.has(row.saleItemId)).concat(choices);
        })(),
        refunds:await all('SELECT method,amount_cents AS amountCents,cash_session_id AS cashSessionId FROM sale_refund_movements WHERE return_id=? ORDER BY method',r.id)
      })));
    },
    async reverse(tenant,branch,id,user,body,keyHeader,mode='RETURN'){
      const key=requiredMutation(body,keyHeader),scope='sale.return:'+branch+':'+id+':'+mode;
      const prior=await applied(tenant,scope,key);if(prior)return prior;
      const {sale,reason,original,priced,returned,computed,details,totalCents}=
        await prepare(tenant,branch,id,body,mode);
      // Explicit refund allocation only; never generate funds to unrelated tenders.
      const refunds=body?.refunds;
      if(!Array.isArray(refunds)||refunds.length>6||(totalCents>0&&refunds.length===0))
        throw error(400,'Informe o reembolso por forma de pagamento.');
      const names=new Set(),grouped=[];
      for(const p of refunds){
        const method=normalizeMethod(p?.method);
        if(!refundMethods.has(method)||!Number.isSafeInteger(p?.amountCents)||p.amountCents<=0||names.has(method))
          throw error(400,'Reembolso inválido ou método duplicado.');
        names.add(method);grouped.push({method,amountCents:p.amountCents});
      }
      if(grouped.reduce((sum,p)=>sum+p.amountCents,0)!==totalCents)
        throw error(409,'O reembolso deve coincidir com o valor líquido dos itens devolvidos.');
      const originalPayments=await all('SELECT method,amount_cents AS amountCents FROM sale_payments WHERE sale_id=? AND tenant_id=? AND branch_id=?',id,tenant,branch);
      const charge=await first("SELECT amount_cents AS amountCents FROM customer_credit_ledger WHERE sale_id=? AND tenant_id=? AND branch_id=? AND type='CHARGE'",id,tenant,branch);
      const tender=new Map(originalPayments.map(p=>[p.method,p.method==='CASH'?p.amountCents-sale.change_cents:p.amountCents]));
      if(charge)tender.set('STORE_CREDIT',charge.amountCents);
      const previouslyRefunded=await all('SELECT method,COALESCE(SUM(amount_cents),0) AS amountCents FROM sale_refund_movements WHERE tenant_id=? AND branch_id=? AND sale_id=? GROUP BY method',tenant,branch,id);
      for(const p of previouslyRefunded)tender.set(p.method,(tender.get(p.method)||0)-p.amountCents);
      for(const p of grouped){
        if(p.amountCents>(tender.get(p.method)||0))throw error(409,'Reembolso excede o pagamento original ainda disponível.');
      }
      const creditRefund=grouped.find(p=>p.method==='STORE_CREDIT');
      if(creditRefund){
        const owed=await first('SELECT COALESCE(SUM(amount_cents),0) AS total FROM customer_credit_ledger WHERE tenant_id=? AND customer_id=?',tenant,sale.customer_id);
        if(!owed||owed.total<creditRefund.amountCents)
          throw error(409,'Crédito já recebido; concilie os recebimentos antes de estornar a dívida.');
      }
      const cashRefund=grouped.find(p=>p.method==='CASH');
      let refundSession=null;
      if(cashRefund){
        refundSession=await getCash(tenant,branch,body?.terminalId||sale.terminal_id||'DEFAULT');
        if(!refundSession||cashRefund.amountCents>refundSession.expectedCashCents)
          throw error(409,'Abra um caixa com saldo suficiente para a devolução em dinheiro.');
      }
      const createdAt=stamp(),returnId=randomId(),result={
        id:returnId,saleId:id,kind:mode,reason,amountCents:totalCents,
        items:details.map(x=>({saleItemId:x.configuredLineId||x.saleItemId,
          parentItemId:x.saleItemId,quantity:x.quantityMilli/1000,netCents:x.netCents})),
        refunds:grouped,status:mode==='CANCEL'?'CANCELLED':'COMPLETED',createdAt
      };
      const stockRestores=new Map(),lotRestores=new Map();
      const statements=[
        q(`INSERT INTO sale_returns(id,tenant_id,branch_id,sale_id,kind,reason,amount_cents,
          original_cash_session_id,operator_id,mutation_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
          returnId,tenant,branch,id,mode,reason,totalCents,sale.cash_session_id,user,key,createdAt)
      ];
      for(const detail of details){
        if(!detail.configuredLineId)continue;
        statements.push(q(`INSERT INTO sale_configured_return_lines
          (id,tenant_id,branch_id,return_id,sale_id,sale_item_id,configured_line_id,
           quantity_milli,net_cents,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
          randomId(),tenant,branch,returnId,id,detail.saleItemId,detail.configuredLineId,
          detail.quantityMilli,detail.netCents,createdAt));
      }
      const pricedDiscounted=allocateSaleDiscount(priced.map(row=>({
        id:row.id,productId:row.product_id,unitPriceCents:row.unit_price_cents,
        quantity:row.quantity_milli/1000
      })),sale.discount_cents);
      const netByLine=new Map(pricedDiscounted.map(row=>[row.id,row.netTotalCents]));
      for(const line of computed){
        statements.push(q(`INSERT INTO sale_return_items(id,tenant_id,branch_id,return_id,sale_id,sale_item_id,quantity_milli,net_cents)
          VALUES(?,?,?,?,?,?,?,?)`,randomId(),tenant,branch,returnId,id,line.saleItemId,line.quantityMilli,line.netCents));
        const allocated=await all(`SELECT component_product_id AS productId,quantity_milli AS originalMilli
          FROM sale_stock_allocations WHERE tenant_id=? AND branch_id=? AND sale_id=? AND sale_item_id=?`,
          tenant,branch,id,line.saleItemId);
        if(allocated.length){
          for(const component of allocated){
            const prev=returned.get(line.saleItemId)||0,denominator=line.source.quantity_milli;
            const delta=Math.round(component.originalMilli*(prev+line.quantityMilli)/denominator)
              -Math.round(component.originalMilli*prev/denominator);
            if(delta>0)stockRestores.set(component.productId,(stockRestores.get(component.productId)||0)+delta);
          }
        }else{
          // Backwards compatibility for completed sales preceding migration 0009.
          const direct=await first("SELECT id FROM inventory_movements WHERE tenant_id=? AND branch_id=? AND sale_id=? AND product_id=? AND type='sale'",tenant,branch,id,line.source.product_id);
          if(direct)stockRestores.set(line.source.product_id,(stockRestores.get(line.source.product_id)||0)+line.quantityMilli);
        }
        // Restore precisely the sale's original lot allocations, proportionally
        // to this item's cumulative returned quantity (no duplicate refund lots).
        const originalLots=await all(`SELECT e.product_id AS productId,
          e.lot_receipt_id AS lotId, -SUM(e.delta_milli) AS soldMilli
          FROM inventory_lot_entries e JOIN inventory_movements m ON m.id=e.movement_id
          WHERE e.tenant_id=? AND e.branch_id=? AND e.sale_item_id=?
            AND m.sale_id=? AND m.type='sale' AND e.delta_milli<0
          GROUP BY e.product_id,e.lot_receipt_id`,
          tenant,branch,line.saleItemId,id);
        for(const lot of originalLots){
          const already=returned.get(line.saleItemId)||0;
          const target=Math.round(lot.soldMilli*(already+line.quantityMilli)/line.source.quantity_milli);
          const prior=Math.round(lot.soldMilli*already/line.source.quantity_milli);
          const quantity=target-prior;
          if(quantity<=0)continue;
          const key=lot.productId+'\\u0000'+lot.lotId;
          const last=lotRestores.get(key);
          lotRestores.set(key,{productId:lot.productId,lotId:lot.lotId,quantityMilli:quantity+(last?.quantityMilli||0)});
        }
        const earned=await first(`SELECT COALESCE(SUM(amount_cents),0) AS cents,MAX(seller_id) AS sellerId
          FROM seller_commission_ledger WHERE tenant_id=? AND branch_id=? AND sale_id=? AND sale_item_id=? AND kind='EARNED'`,
          tenant,branch,id,line.saleItemId);
        if(earned?.cents>0){
          const was=await first("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM seller_commission_ledger WHERE tenant_id=? AND branch_id=? AND sale_id=? AND sale_item_id=? AND kind='REVERSED'",tenant,branch,id,line.saleItemId);
          const configured=priced.some(row=>row.parent_item_id===line.saleItemId);
          let desired;
          if(configured){
            const wholeNet=priced.filter(row=>row.parent_item_id===line.saleItemId)
              .reduce((sum,row)=>sum+(netByLine.get(row.id)||0),0);
            const earlier=await first(`SELECT COALESCE(SUM(net_cents),0) AS cents
              FROM sale_return_items WHERE tenant_id=? AND branch_id=?
                AND sale_id=? AND sale_item_id=?`,tenant,branch,id,line.saleItemId);
            desired=wholeNet?Math.round(earned.cents*(earlier.cents+line.netCents)/wholeNet):0;
          }else{
            const already=returned.get(line.saleItemId)||0;
            desired=Math.round(earned.cents*(already+line.quantityMilli)/line.source.quantity_milli);
          }
          const reverse=Math.min(earned.cents+was.cents,desired+was.cents);
          if(reverse>0)statements.push(q(`INSERT INTO seller_commission_ledger(id,tenant_id,branch_id,seller_id,sale_id,sale_item_id,kind,amount_cents,reference_key,occurred_at)
            VALUES(?,?,?,?,?,?,'REVERSED',?,?,?)`,randomId(),tenant,branch,earned.sellerId,id,line.saleItemId,-reverse,
            'return:'+returnId+':item:'+line.saleItemId,createdAt));
        }
      }
      for(const [productId,quantityMilli] of stockRestores){
        const movementId=randomId();
        statements.push(q(`INSERT INTO inventory_movements(id,tenant_id,branch_id,product_id,delta_milli,type,sale_id,mutation_id,occurred_at,reason)
          VALUES(?,?,?,?,?,'return',NULL,?,?,?)`,movementId,tenant,branch,productId,quantityMilli,
          key,createdAt,'Devolução '+returnId+': '+reason));
        const chosen=[...lotRestores.values()].filter(row=>row.productId===productId)
          .map(row=>({lotId:row.lotId,quantityMilli:row.quantityMilli}));
        statements.push(...lotLedger.statements(tenant,branch,productId,movementId,chosen,1,createdAt));
        statements.push(lotLedger.check(tenant,branch,productId,movementId,createdAt));
      }
      for(const p of grouped){
        const refundId=randomId();
        statements.push(q(`INSERT INTO sale_refund_movements(id,tenant_id,branch_id,return_id,sale_id,method,amount_cents,
          cash_session_id,original_cash_session_id,operator_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
          refundId,tenant,branch,returnId,id,p.method,p.amountCents,
          p.method==='CASH'?refundSession.id:null,sale.cash_session_id,user,createdAt));
        if(p.method==='STORE_CREDIT')statements.push(q(`INSERT INTO customer_credit_ledger(id,tenant_id,branch_id,customer_id,sale_id,type,amount_cents,reference_key,occurred_at)
          VALUES(?,?,?,?,?,'REVERSAL',?,?,?)`,randomId(),tenant,branch,sale.customer_id,id,-p.amountCents,'sale-return:'+returnId,createdAt));
      }
      if(mode==='CANCEL')statements.push(q("UPDATE sales SET status='CANCELLED' WHERE id=? AND tenant_id=? AND branch_id=? AND status='COMPLETED'",id,tenant,branch));
      statements.push(q('INSERT INTO domain_events(id,tenant_id,branch_id,aggregate_type,aggregate_id,type,payload_json,mutation_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)',
        randomId(),tenant,branch,'sale_return',returnId,mode==='CANCEL'?'sale.cancelled':'sale.returned',JSON.stringify(result),key,createdAt));
      statements.push(audit(tenant,scope,key,result));
      await batch(statements);
      return result;
    }
  };
}
