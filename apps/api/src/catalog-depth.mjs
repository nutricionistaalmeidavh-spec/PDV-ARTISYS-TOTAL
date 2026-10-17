// Deep catalog metadata and stock reservations build on the existing products,
// stock_positions and inventory_movements authorities. No second inventory balance.
export function createCatalogDepthService(helpers){
 const {q,first,all,batch,applied,audit,stamp,branchExists,requiredMutation,
   quantityMilli,error,text,randomId}=helpers;
 return {
   async categories(tenant,branch){
     await branchExists(tenant,branch);
     return all('SELECT id,name FROM product_categories WHERE tenant_id=? ORDER BY name,id',tenant);
   },
   async createCategory(tenant,branch,user,body,header){
     await branchExists(tenant,branch);
     const key=requiredMutation(body,header),scope='catalog.category:'+branch;
     const prior=await applied(tenant,scope,key);if(prior)return prior;
     const name=text(body?.name,100);
     if(name.length<2)throw error(400,'Informe nome de categoria com pelo menos dois caracteres.');
     const result={id:randomId(),name};
     await batch([
       q('INSERT INTO product_categories(id,tenant_id,name,created_at) VALUES(?,?,?,?)',
         result.id,tenant,name,stamp()),
       audit(tenant,scope,key,result)
     ]);
     return result;
   },
   async bundle(tenant,branch,id){
     await branchExists(tenant,branch);
     const row=await first('SELECT id FROM products WHERE tenant_id=? AND id=?',tenant,id);
     if(!row)throw error(404,'Produto não encontrado neste estabelecimento.');
     return all(`SELECT b.component_id AS productId,p.name,b.quantity_milli/1000.0 AS quantity
       FROM product_bundle_components b JOIN products p ON p.id=b.component_id AND p.tenant_id=b.tenant_id
       WHERE b.tenant_id=? AND b.kit_id=? ORDER BY p.name,p.id`,tenant,id);
   },
   async setBundle(tenant,branch,id,user,body,header){
     await branchExists(tenant,branch);
     const key=requiredMutation(body,header),scope='catalog.bundle:'+id;
     const prior=await applied(tenant,scope,key);if(prior)return prior;
     const kit=await first('SELECT id,track_stock AS trackStock FROM products WHERE tenant_id=? AND id=? AND active=1',tenant,id);
     if(!kit)throw error(404,'Kit não encontrado.');
     if(kit.trackStock)throw error(409,'Kit deve ser um produto sem estoque próprio: o estoque pertence aos componentes.');
     const sold=await first("SELECT 1 AS n FROM sale_items i JOIN sales s ON s.id=i.sale_id WHERE i.tenant_id=? AND i.product_id=? AND s.status IN ('COMPLETED','CANCELLED') LIMIT 1",tenant,id);
     if(sold)throw error(409,'Composição de kit já vendido não pode mudar: preserve o histórico.');
     const components=body?.components;
     if(!Array.isArray(components)||components.length<1||components.length>40)throw error(400,'Informe entre 1 e 40 componentes.');
     const seen=new Set(),normalized=[];
     for(const c of components){
       const productId=String(c?.productId||''),milli=quantityMilli(c?.quantity);
       if(!productId||!milli||seen.has(productId)||productId===id)throw error(400,'Componente duplicado ou quantidade inválida.');
       const p=await first('SELECT id,track_stock AS trackStock FROM products WHERE tenant_id=? AND id=? AND active=1',tenant,productId);
       if(!p||!p.trackStock)throw error(409,'Componente de kit deve ser produto ativo, com estoque próprio e da mesma empresa.');
       normalized.push({productId,quantity:milli/1000,milli});seen.add(productId);
     }
     const result={kitId:id,components:normalized.map(({productId,quantity})=>({productId,quantity}))};
     const statements=[q('DELETE FROM product_bundle_components WHERE tenant_id=? AND kit_id=?',tenant,id)];
     for(const c of normalized)statements.push(q('INSERT INTO product_bundle_components(tenant_id,kit_id,component_id,quantity_milli) VALUES(?,?,?,?)',tenant,id,c.productId,c.milli));
     statements.push(audit(tenant,scope,key,result));
     await batch(statements);
     return result;
   },
   async reservations(tenant,branch,{productId=null}={}){
     await branchExists(tenant,branch);
     return all(`SELECT id,product_id AS productId,quantity_milli/1000.0 AS quantity,status,reason,
       operator_id AS operatorId,created_at AS createdAt,released_at AS releasedAt
       FROM inventory_reservations WHERE tenant_id=? AND branch_id=?
       AND (? IS NULL OR product_id=?) ORDER BY created_at DESC,id DESC LIMIT 200`,
       tenant,branch,productId,productId);
   },
   async reserveStock(tenant,branch,user,body,header){
     await branchExists(tenant,branch);
     const key=requiredMutation(body,header),scope='stock.reserve:'+branch;
     const prior=await applied(tenant,scope,key);if(prior)return prior;
     const productId=String(body?.productId||'');
     const p=await first('SELECT id,track_stock AS trackStock FROM products WHERE tenant_id=? AND id=? AND active=1',tenant,productId);
     if(!p||!p.trackStock)throw error(404,'Produto com estoque não encontrado.');
     const milli=quantityMilli(body?.quantity),reason=text(body?.reason,240);
     if(!milli||reason.length<3)throw error(400,'Informe quantidade e motivo da reserva.');
     const result={id:randomId(),productId,quantity:milli/1000,status:'ACTIVE',reason,createdAt:stamp()};
     await batch([
       q('INSERT INTO inventory_reservations(id,tenant_id,branch_id,product_id,quantity_milli,status,reason,operator_id,mutation_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
         result.id,tenant,branch,productId,milli,'ACTIVE',reason,user,key,result.createdAt),
       audit(tenant,scope,key,result)
     ]);
     return result;
   },
   async releaseReservation(tenant,branch,id,user,keyHeader){
     await branchExists(tenant,branch);
     const key=requiredMutation({},keyHeader),scope='stock.release:'+branch+':'+id;
     const prior=await applied(tenant,scope,key);if(prior)return prior;
     const old=await first('SELECT id,status FROM inventory_reservations WHERE tenant_id=? AND branch_id=? AND id=?',tenant,branch,id);
     if(!old)throw error(404,'Reserva não encontrada nesta filial.');
     if(old.status!=='ACTIVE')throw error(409,'Reserva já liberada.');
     const result={id,status:'RELEASED',releasedAt:stamp()};
     await batch([
       q("UPDATE inventory_reservations SET status='RELEASED',released_at=? WHERE id=? AND tenant_id=? AND branch_id=? AND status='ACTIVE'",result.releasedAt,id,tenant,branch),
       audit(tenant,scope,key,result)
     ]);
     return result;
   },
   async purchaseCosts(tenant,branch,{productId=null}={}){
     await branchExists(tenant,branch);
     return all(`SELECT id,product_id AS productId,movement_id AS movementId,
       unit_cost_cents AS unitCostCents,quantity_milli/1000.0 AS quantity,
       supplier_id AS supplierId,operator_id AS operatorId,created_at AS createdAt
       FROM purchase_cost_history WHERE tenant_id=? AND branch_id=?
       AND (? IS NULL OR product_id=?) ORDER BY created_at DESC,id DESC LIMIT 200`,
       tenant,branch,productId,productId);
   }
 };
}
