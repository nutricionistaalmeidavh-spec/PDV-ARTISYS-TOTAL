// Additive persistence adapter for compensations. Uses the same canonical sale
// pricing, inventory ledger and cash rules injected by commerce.mjs.
export function createSaleReturnAdapter(helpers){
  const {q,first,all,batch,applied,audit,stamp,tenantSale,requiredMutation,quantityMilli,
    normalizeMethod,allocateSaleDiscount,getCash,error,text,randomId}=helpers;
  const refundMethods=new Set(['CASH','PIX','DEBIT_CARD','CREDIT_CARD','OTHER','STORE_CREDIT']);
  return {
    async list(tenant,branch,id){
      await tenantSale(tenant,branch,id);
      const rows=await all('SELECT * FROM sale_returns WHERE tenant_id=? AND branch_id=? AND sale_id=? ORDER BY created_at,id',tenant,branch,id);
      return Promise.all(rows.map(async r=>({
        id:r.id,kind:r.kind,reason:r.reason,amountCents:r.amount_cents,operatorId:r.operator_id,createdAt:r.created_at,
        items:await all('SELECT sale_item_id AS saleItemId,quantity_milli/1000.0 AS quantity,net_cents AS netCents FROM sale_return_items WHERE return_id=? ORDER BY id',r.id),
        refunds:await all('SELECT method,amount_cents AS amountCents,cash_session_id AS cashSessionId FROM sale_refund_movements WHERE return_id=? ORDER BY method',r.id)
      })));
    },
    async reverse(tenant,branch,id,user,body,keyHeader,mode='RETURN'){
      const key=requiredMutation(body,keyHeader),scope='sale.return:'+branch+':'+id+':'+mode;
      const prior=await applied(tenant,scope,key);if(prior)return prior;
      const sale=await tenantSale(tenant,branch,id);
      if(sale.status!=='COMPLETED')throw error(409,'Somente vendas concluídas podem ser devolvidas ou canceladas.');
      const reason=text(body?.reason,240);
      if(reason.length<3)throw error(400,'Informe motivo operacional para a devolução.');
      const original=await all('SELECT * FROM sale_items WHERE tenant_id=? AND branch_id=? AND sale_id=? ORDER BY created_at,id',tenant,branch,id);
      const priorItems=await all(`SELECT ri.sale_item_id AS saleItemId,COALESCE(SUM(ri.quantity_milli),0) AS returnedMilli
        FROM sale_return_items ri WHERE ri.tenant_id=? AND ri.branch_id=? AND ri.sale_id=?
        GROUP BY ri.sale_item_id`,tenant,branch,id);
      const returned=new Map(priorItems.map(x=>[x.saleItemId,x.returnedMilli]));
      const wanted=mode==='CANCEL'
        ?original.map(item=>({saleItemId:item.id,quantityMilli:item.quantity_milli-(returned.get(item.id)||0)}))
          .filter(item=>item.quantityMilli>0)
        :Array.isArray(body?.items)?body.items.map(item=>({saleItemId:item?.saleItemId,quantityMilli:quantityMilli(item?.quantity)})):[];
      if(wanted.length<1||wanted.length>80)throw error(409,'Não há itens disponíveis para devolução.');
      if(new Set(wanted.map(x=>x.saleItemId)).size!==wanted.length||wanted.some(x=>!x.quantityMilli))
        throw error(400,'Itens ou quantidades inválidos ou duplicados.');
      const discountItems=allocateSaleDiscount(original.map(row=>({
        id:row.id,productId:row.product_id,unitPriceCents:row.unit_price_cents,quantity:row.quantity_milli/1000
      })),sale.discount_cents);
      const discounted=new Map(discountItems.map(row=>[row.id,row]));
      const computed=[];
      for(const requested of wanted){
        const source=original.find(row=>row.id===requested.saleItemId);
        if(!source)throw error(404,'Item não pertence à venda.');
        const prev=returned.get(source.id)||0;
        if(requested.quantityMilli>source.quantity_milli-prev)throw error(409,'Quantidade devolvida excede quantidade vendida.');
        const price=discounted.get(source.id);
        const netCents=Math.round(price.netTotalCents*(prev+requested.quantityMilli)/source.quantity_milli)
          -Math.round(price.netTotalCents*prev/source.quantity_milli);
        computed.push({...requested,source,netCents});
      }
      const totalCents=computed.reduce((sum,x)=>sum+x.netCents,0);
      const fullReturn=original.every(row=>{
        const delta=computed.find(x=>x.saleItemId===row.id)?.quantityMilli||0;
        return (returned.get(row.id)||0)+delta===row.quantity_milli;
      });
      if(mode==='CANCEL'&&!fullReturn)throw error(409,'O cancelamento exige devolução integral dos itens.');
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
        refundSession=await getCash(tenant,branch);
        if(!refundSession||cashRefund.amountCents>refundSession.expectedCashCents)
          throw error(409,'Abra um caixa com saldo suficiente para a devolução em dinheiro.');
      }
      const createdAt=stamp(),returnId=randomId(),result={
        id:returnId,saleId:id,kind:mode,reason,amountCents:totalCents,
        items:computed.map(x=>({saleItemId:x.saleItemId,quantity:x.quantityMilli/1000,netCents:x.netCents})),
        refunds:grouped,status:mode==='CANCEL'?'CANCELLED':'COMPLETED',createdAt
      };
      const statements=[
        q(`INSERT INTO sale_returns(id,tenant_id,branch_id,sale_id,kind,reason,amount_cents,
          original_cash_session_id,operator_id,mutation_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
          returnId,tenant,branch,id,mode,reason,totalCents,sale.cash_session_id,user,key,createdAt)
      ];
      for(const line of computed){
        statements.push(q(`INSERT INTO sale_return_items(id,tenant_id,branch_id,return_id,sale_id,sale_item_id,quantity_milli,net_cents)
          VALUES(?,?,?,?,?,?,?,?)`,randomId(),tenant,branch,returnId,id,line.saleItemId,line.quantityMilli,line.netCents));
        const stockMovement=await first("SELECT id FROM inventory_movements WHERE tenant_id=? AND branch_id=? AND sale_id=? AND product_id=? AND type='sale'",tenant,branch,id,line.source.product_id);
        if(stockMovement)statements.push(q(`INSERT INTO inventory_movements(id,tenant_id,branch_id,product_id,delta_milli,type,sale_id,mutation_id,occurred_at,reason)
          VALUES(?,?,?,?,?,'return',NULL,?,?,?)`,randomId(),tenant,branch,line.source.product_id,line.quantityMilli,
          key,createdAt,'Devolução '+returnId+': '+reason));
        const earned=await first(`SELECT COALESCE(SUM(amount_cents),0) AS cents,MAX(seller_id) AS sellerId
          FROM seller_commission_ledger WHERE tenant_id=? AND branch_id=? AND sale_id=? AND sale_item_id=? AND kind='EARNED'`,
          tenant,branch,id,line.saleItemId);
        if(earned?.cents>0){
          const was=await first("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM seller_commission_ledger WHERE tenant_id=? AND branch_id=? AND sale_id=? AND sale_item_id=? AND kind='REVERSED'",tenant,branch,id,line.saleItemId);
          const already=returned.get(line.saleItemId)||0;
          const desired=Math.round(earned.cents*(already+line.quantityMilli)/line.source.quantity_milli);
          const reverse=Math.min(earned.cents+was.cents,desired+was.cents);
          if(reverse>0)statements.push(q(`INSERT INTO seller_commission_ledger(id,tenant_id,branch_id,seller_id,sale_id,sale_item_id,kind,amount_cents,reference_key,occurred_at)
            VALUES(?,?,?,?,?,?,'REVERSED',?,?,?)`,randomId(),tenant,branch,earned.sellerId,id,line.saleItemId,-reverse,
            'return:'+returnId+':item:'+line.saleItemId,createdAt));
        }
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
