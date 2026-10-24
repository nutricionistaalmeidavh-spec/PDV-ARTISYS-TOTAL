// R4 additive tenant+branch facade. Operational records are never a second cash/stock ledger.
import {planShares,parseWeightedEAN13} from './r4-saas-rules.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});

const keyValid=key=>typeof key==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(key);
const label=(value,max=100)=>typeof value==='string'?value.trim().slice(0,max):'';
const integer=(v,min,max,caption)=>{
 if(!Number.isSafeInteger(v)||v<min||v>max)throw fail(400,caption+' inválido.');
 return v;
};
const options=(values,kind,required)=>{
 if(!Array.isArray(values)||values.length>(kind==='FLAVOR'?30:20)||required&&!values.length)throw fail(400,'Opções '+kind+' inválidas.');
 const seen=new Set();
 return values.map(row=>{
   const code=label(row?.code,32).toUpperCase(),name=label(row?.name,100),priceCents=integer(row?.priceCents,0,1_000_000_000,'Preço');
   if(!/^[A-Z0-9_-]{1,32}$/.test(code)||!name||seen.has(code))throw fail(400,'Código ou nome de opção inválido/repetido.');
   seen.add(code);return {code,name,priceCents,kind};
 });
};

export function createR4ExtendedService(db,{idFactory,clock}={}){
 const id=idFactory||(()=>crypto.randomUUID());
 const stamp=clock||(()=>new Date().toISOString());
 const q=(sql,...args)=>db.prepare(sql).bind(...args);
 const first=(sql,...args)=>q(sql,...args).first();
 const all=async(sql,...args)=>(await q(sql,...args).all()).results;
 async function branch(t,b){
   if(!b||!(await first('SELECT id FROM branches WHERE tenant_id=? AND id=? AND active=1',t,b)))
     throw fail(404,'Filial não encontrada.');
 }
 async function product(t,id){
   const row=await first('SELECT id,name,sku,unit,sale_price_cents,track_stock,last_cost_cents FROM products WHERE tenant_id=? AND id=? AND active=1',t,id);
   if(!row)throw fail(404,'Produto não encontrado neste estabelecimento.');
   return row;
 }
 async function mutation(t,scope,key,build){
   if(!keyValid(key))throw fail(400,'Identificador da operação obrigatório.');
   const old=await first('SELECT result_json FROM commerce_mutations WHERE tenant_id=? AND scope=? AND mutation_id=?',t,scope,key);
   if(old)return JSON.parse(old.result_json);
   const {statements,result}=await build();
   try{await db.batch([...statements,q('INSERT INTO commerce_mutations(tenant_id,scope,mutation_id,result_json,occurred_at) VALUES(?,?,?,?,?)',
     t,scope,key,JSON.stringify(result),stamp())]);}
   catch(e){
     if(/CONSTRAINT|UNIQUE|FOREIGN KEY|locked|database is locked|CHECK|IMMUTABLE/i.test(String(e?.message)))
       throw fail(409,'Operação concorrente ou conflito de dados. Atualize a tela.');
     throw e;
   }
   return result;
 }
 const result={
   async stations(t,b){await branch(t,b);
     return all('SELECT id,name,printer_name AS printerName,print_enabled AS printEnabled,active,sort_order AS sortOrder FROM r4_kitchen_stations WHERE tenant_id=? AND branch_id=? ORDER BY sort_order,name',t,b);
   },
   async saveStation(t,b,body,key){
     await branch(t,b);
     const stationId=label(body.id,100)||id(),name=label(body.name,100),printer=label(body.printerName,120)||null;
     const sort=integer(body.sortOrder??0,-10000,10000,'Ordenação'),enabled=body.printEnabled===true?1:0,active=body.active!==false?1:0;
     if(!name)throw fail(400,'Informe nome da estação.');
     if(enabled&&!printer)throw fail(400,'Informe a fila de impressão para habilitar impressão.');
     if(!active&&(await first("SELECT id FROM r4_product_kitchen_routes WHERE tenant_id=? AND branch_id=? AND station_id=? AND mode='PRODUCTION' LIMIT 1",t,b,stationId)))
       throw fail(409,'Retire as rotas ativas antes de desativar a estação.');
     return mutation(t,'r4.station:'+b+':'+stationId,key,async()=>{
       const time=stamp();
       return {result:{id:stationId,name,printerName:printer,printEnabled:!!enabled,active:!!active,sortOrder:sort},
         statements:[q(`INSERT INTO r4_kitchen_stations(id,tenant_id,branch_id,name,printer_name,print_enabled,active,sort_order,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(tenant_id,branch_id,id) DO UPDATE SET name=excluded.name,printer_name=excluded.printer_name,
           print_enabled=excluded.print_enabled,active=excluded.active,sort_order=excluded.sort_order,updated_at=excluded.updated_at`,
         stationId,t,b,name,printer,enabled,active,sort,time,time)]};
     });
   },
   async routes(t,b){
     await branch(t,b);
     return all(`SELECT r.product_id AS productId,p.name AS productName,r.mode,r.station_id AS stationId,
       s.name AS stationName,s.printer_name AS printerName FROM r4_product_kitchen_routes r
       JOIN products p ON p.tenant_id=r.tenant_id AND p.id=r.product_id
       LEFT JOIN r4_kitchen_stations s ON s.tenant_id=r.tenant_id AND s.branch_id=r.branch_id AND s.id=r.station_id
       WHERE r.tenant_id=? AND r.branch_id=? ORDER BY p.name`,t,b);
   },
   async setRoute(t,b,body,key){
     await branch(t,b);
     const p=await product(t,body.productId);
     const mode=label(body.mode).toUpperCase();
     if(!['DIRECT','PRODUCTION'].includes(mode))throw fail(400,'Destino do produto inválido.');
     const stationId=mode==='PRODUCTION'?label(body.stationId,100):null;
     if(mode==='PRODUCTION'&&!stationId)throw fail(400,'Selecione uma estação.');
     if(stationId&&!(await first('SELECT id FROM r4_kitchen_stations WHERE tenant_id=? AND branch_id=? AND id=? AND active=1',t,b,stationId)))
       throw fail(404,'Estação inativa ou inexistente.');
     return mutation(t,'r4.route:'+b+':'+p.id,key,async()=>{
       const row={productId:p.id,productName:p.name,mode,stationId};
       return {result:row,statements:[q(`INSERT INTO r4_product_kitchen_routes(tenant_id,branch_id,product_id,mode,station_id,updated_at)
       VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,branch_id,product_id) DO UPDATE
       SET mode=excluded.mode,station_id=excluded.station_id,updated_at=excluded.updated_at`,t,b,p.id,mode,stationId,stamp())]};
     });
   },
   async tickets(t,b){
     await branch(t,b);
     const rows=await all(`SELECT k.id,k.order_id AS orderId,k.station_id AS stationId,k.status,
       o.fulfillment,s.name AS stationName,s.printer_name AS printerName,s.print_enabled AS printEnabled,
       o.table_session_id AS tableSessionId,k.created_at AS createdAt
       FROM r4_station_tickets k JOIN restaurant_orders o ON o.tenant_id=k.tenant_id AND o.branch_id=k.branch_id AND o.id=k.order_id
       JOIN r4_kitchen_stations s ON s.tenant_id=k.tenant_id AND s.branch_id=k.branch_id AND s.id=k.station_id
       WHERE k.tenant_id=? AND k.branch_id=? ORDER BY k.created_at,k.id LIMIT 250`,t,b);
     return Promise.all(rows.map(async row=>{
       const items=await all(`SELECT i.product_id AS productId,i.product_name AS productName,
          i.quantity_milli / 1000.0 AS quantity,i.configuration_json AS configurationJson,
          i.origin FROM r4_station_ticket_items i
          WHERE i.tenant_id=? AND i.branch_id=? AND i.station_ticket_id=?
          ORDER BY i.item_index`,t,b,row.id);
       return {...row,items:items.map(({configurationJson,...item})=>({
         ...item,configuration:configurationJson?JSON.parse(configurationJson):null
       }))};
     }));
   },
   async updateTicket(t,b,ticketId,status,key){
     await branch(t,b);
     if(!['PREPARING','READY'].includes(status))throw fail(400,'Estado de produção inválido.');
     if(!keyValid(key))throw fail(400,'Chave de operação obrigatória.');
     const scope='r4.ticket:'+b+':'+ticketId+':'+status;
     const prior=await first('SELECT result_json FROM commerce_mutations WHERE tenant_id=? AND scope=? AND mutation_id=?',t,scope,key);
     if(prior)return JSON.parse(prior.result_json);
     const current=await first('SELECT id,order_id AS orderId,status FROM r4_station_tickets WHERE tenant_id=? AND branch_id=? AND id=?',t,b,ticketId);
     if(!current)throw fail(404,'Ticket não encontrado.');
     if((current.status==='NEW'&&status!=='PREPARING')||
        (current.status==='PREPARING'&&status!=='READY')||!['NEW','PREPARING'].includes(current.status))
       throw fail(409,'Transição de produção inválida.');
     const time=stamp(),result={id:ticketId,orderId:current.orderId,status};
     // SQL changes() makes the same CAS transaction the authority for both the
     // operator's success and the downstream shared KDS update.
     const proof=`EXISTS(SELECT 1 FROM commerce_mutations WHERE tenant_id=? AND scope=? AND mutation_id=?)`;
     try{
       await db.batch([
         q('UPDATE r4_station_tickets SET status=?,updated_at=? WHERE tenant_id=? AND branch_id=? AND id=? AND status=?',
           status,time,t,b,ticketId,current.status),
         q(`INSERT INTO commerce_mutations(tenant_id,scope,mutation_id,result_json,occurred_at)
            SELECT ?,?,?,?,? WHERE changes()=1`,t,scope,key,JSON.stringify(result),time),
         q(`UPDATE restaurant_kitchen_tickets SET status=
            CASE WHEN NOT EXISTS(SELECT 1 FROM r4_station_tickets x WHERE x.tenant_id=? AND x.branch_id=?
              AND x.order_id=? AND x.status<>'READY') THEN 'READY' ELSE 'PREPARING' END,
            updated_at=? WHERE tenant_id=? AND branch_id=? AND order_id=?
            AND status IN('NEW','PREPARING') AND ${proof}`,
           t,b,current.orderId,time,t,b,current.orderId,t,scope,key),
         q(`UPDATE restaurant_orders SET status='READY',updated_at=?
            WHERE tenant_id=? AND branch_id=? AND id=? AND status='OPEN'
            AND EXISTS(SELECT 1 FROM restaurant_kitchen_tickets k WHERE k.tenant_id=? AND k.branch_id=?
              AND k.order_id=? AND k.status='READY') AND ${proof}`,
           time,t,b,current.orderId,t,b,current.orderId,t,scope,key)
       ]);
     }catch(e){
       if(/UNIQUE|CONSTRAINT|locked/i.test(String(e?.message)))throw fail(409,'Outra operação alterou o ticket.');
       throw e;
     }
     const won=await first('SELECT result_json FROM commerce_mutations WHERE tenant_id=? AND scope=? AND mutation_id=?',t,scope,key);
     if(!won)throw fail(409,'Outra pessoa atualizou o ticket. Atualize o KDS.');
     return JSON.parse(won.result_json);
   },

   async transferItems(t,b,user,sourceSessionId,body,key){
     await branch(t,b);
     const target=label(body.targetSessionId,128);
     const [sourceRow,targetRow]=await Promise.all([
       first("SELECT status FROM restaurant_table_sessions WHERE tenant_id=? AND branch_id=? AND id=?",t,b,sourceSessionId),
       first("SELECT status FROM restaurant_table_sessions WHERE tenant_id=? AND branch_id=? AND id=?",t,b,target)
     ]);
     if(!sourceRow||!targetRow)throw fail(404,'Comanda de origem ou destino inexistente.');
     if(target===sourceSessionId||sourceRow.status!=='OPEN'||targetRow.status!=='OPEN')throw fail(409,'Transfira somente entre duas comandas abertas.');
     const existingPlan=await first('SELECT table_session_id FROM r4_split_plans WHERE tenant_id=? AND branch_id=? AND table_session_id IN(?,?) LIMIT 1',t,b,sourceSessionId,target);
     if(existingPlan)throw fail(409,'Cancele o plano de divisão de contas antes de transferir itens.');
     if(!Array.isArray(body.items)||!body.items.length||body.items.length>40)throw fail(400,'Itens inválidos.');
     const entries=[],seen=new Set();
     for(const input of body.items){
       const itemId=label(input.orderItemId,128);
       if(!itemId||seen.has(itemId))throw fail(400,'Item repetido.');
       seen.add(itemId);
       const milli=integer(Math.round(Number(input.quantity)*1000),1,100000000,'Quantidade');
       if(!Number.isFinite(Number(input.quantity))||Math.abs(Number(input.quantity)*1000-milli)>0.000001)
         throw fail(400,'Quantidade precisa usar até três casas decimais.');
       const item=await first(`SELECT oi.quantity_milli AS quantityMilli,o.status
          FROM restaurant_order_items oi JOIN restaurant_orders o ON o.id=oi.order_id
            AND o.tenant_id=oi.tenant_id AND o.branch_id=oi.branch_id
          WHERE oi.tenant_id=? AND oi.branch_id=? AND oi.id=? AND o.table_session_id=?`,t,b,itemId,sourceSessionId);
       if(!item||item.status!=='DELIVERED')throw fail(409,'Só transfira itens entregues desta comanda.');
       const used=await first('SELECT COALESCE(SUM(quantity_milli),0) AS used FROM r4_item_transfers WHERE tenant_id=? AND branch_id=? AND order_item_id=?',t,b,itemId);
       if(used.used+milli>item.quantityMilli)throw fail(409,'Quantidade disponível insuficiente para transferência.');
       entries.push({orderItemId:itemId,quantity:milli/1000,milli});
     }
     return mutation(t,'r4.items.transfer:'+b+':'+sourceSessionId,key,async()=>{
       const at=stamp();
       return {result:{sourceSessionId,targetSessionId:target,items:entries.map(({milli,...x})=>x)},
         statements:entries.map(x=>q(`INSERT INTO r4_item_transfers
           (id,tenant_id,branch_id,order_item_id,source_session_id,target_session_id,quantity_milli,created_by,created_at)
           VALUES(?,?,?,?,?,?,?,?,?)`,id(),t,b,x.orderItemId,sourceSessionId,target,x.milli,user,at))};
     });
   },
   async sessionPosition(t,b,sessionId){
     await branch(t,b);
     const s=await first('SELECT id,status FROM restaurant_table_sessions WHERE tenant_id=? AND branch_id=? AND id=?',t,b,sessionId);
     if(!s)throw fail(404,'Comanda não encontrada.');
     const active=await first("SELECT COUNT(*) AS n FROM restaurant_orders WHERE tenant_id=? AND branch_id=? AND table_session_id=? AND status IN('OPEN','READY')",t,b,sessionId);
     if(active.n)throw fail(409,'Todos os pedidos precisam ser entregues antes da divisão.');
     const base=await all(`SELECT oi.id,oi.unit_price_cents AS unitPriceCents,
       oi.quantity_milli-COALESCE((SELECT SUM(tr.quantity_milli) FROM r4_item_transfers tr WHERE tr.tenant_id=oi.tenant_id
         AND tr.branch_id=oi.branch_id AND tr.order_item_id=oi.id),0) AS milli
       FROM restaurant_order_items oi JOIN restaurant_orders o ON o.id=oi.order_id AND o.tenant_id=oi.tenant_id AND o.branch_id=oi.branch_id
       WHERE oi.tenant_id=? AND oi.branch_id=? AND o.table_session_id=? AND o.status='DELIVERED'
       UNION ALL
       SELECT oi.id,oi.unit_price_cents AS unitPriceCents,tr.quantity_milli AS milli
       FROM r4_item_transfers tr JOIN restaurant_order_items oi ON oi.id=tr.order_item_id
       JOIN restaurant_orders o ON o.id=oi.order_id AND o.tenant_id=oi.tenant_id AND o.branch_id=oi.branch_id
       WHERE tr.tenant_id=? AND tr.branch_id=? AND tr.target_session_id=? AND o.status='DELIVERED'`,
       t,b,sessionId,t,b,sessionId);
     const items=base.filter(x=>x.milli>0);
     const byItem=new Map();
     for(const item of items){
       const previous=byItem.get(item.id)||{id:item.id,quantityMilli:0,unitPriceCents:item.unitPriceCents,totalCents:0};
       previous.quantityMilli+=item.milli;
       previous.totalCents+=Math.round(item.unitPriceCents*item.milli/1000);
       byItem.set(item.id,previous);
     }
     const lineItems=[...byItem.values()];
     const baseCents=lineItems.reduce((sum,x)=>sum+x.totalCents,0);
     return {sessionId,status:s.status,itemsCount:lineItems.length,baseCents,items:lineItems};
   },
   async split(t,b,sessionId){
     const position=await this.sessionPosition(t,b,sessionId);
     const plan=await first('SELECT parts,service_charge_bps AS serviceChargeBps,service_charge_product_id AS serviceChargeProductId,shares_json AS sharesJson,item_allocations_json AS allocationsJson FROM r4_split_plans WHERE tenant_id=? AND branch_id=? AND table_session_id=?',t,b,sessionId);
     if(!plan)return null;
     const serviceChargeCents=Math.round(position.baseCents*plan.serviceChargeBps/10000);
     const totalCents=position.baseCents+serviceChargeCents;
     const shares=planShares(totalCents,plan.parts,plan.sharesJson?JSON.parse(plan.sharesJson):null);
     return {sessionId,parts:plan.parts,baseCents:position.baseCents,serviceChargeBps:plan.serviceChargeBps,
       serviceChargeProductId:plan.serviceChargeProductId,serviceChargeCents,totalCents,
       shares,allocations:plan.allocationsJson?JSON.parse(plan.allocationsJson):[]};
   },
   async saveSplit(t,b,sessionId,body,key){
     const position=await this.sessionPosition(t,b,sessionId);
     if(position.status!=='OPEN'||position.baseCents<1)throw fail(409,'Somente comanda aberta com itens entregues pode ser dividida.');
     if(await first('SELECT 1 FROM r4_table_prepayments WHERE tenant_id=? AND branch_id=? AND table_session_id=?',t,b,sessionId))
       throw fail(409,'Esta comanda já recebeu antecipação. Finalize os recebimentos sem alterar a divisão.');
     const parts=integer(body.parts,2,50,'Número de partes');
     const bps=integer(body.serviceChargeBps??0,0,3000,'Percentual de serviço');
     const feeId=bps?label(body.serviceChargeProductId,128):null;
     if(bps){
       const fee=await product(t,feeId);
       if(fee.track_stock||fee.sku!=='SERVICE_CHARGE')throw fail(400,'Cadastre explicitamente produto não estocável com SKU SERVICE_CHARGE.');
     }
     return mutation(t,'r4.split:'+b+':'+sessionId,key,async()=>{
       const serviceChargeCents=Math.round(position.baseCents*bps/10000);
       const totalCents=position.baseCents+serviceChargeCents;
       let shares,allocations=null;
       if(body.allocations!==undefined){
         if(body.shares!==undefined)throw fail(400,'Escolha divisão por itens ou valores, não ambos.');
         if(!Array.isArray(body.allocations)||body.allocations.length!==position.items.length||body.allocations.length>80)
           throw fail(400,'Atribua todos os itens da comanda uma única vez.');
         const byId=new Map(position.items.map(item=>[item.id,item]));
         const selected=new Set(),subtotals=Array(parts).fill(0);
         allocations=body.allocations.map(entry=>{
           const item=byId.get(entry?.itemId),payerIndex=entry?.payerIndex;
           if(!item||selected.has(item.id)||!Number.isSafeInteger(payerIndex)||payerIndex<1||payerIndex>parts)
             throw fail(400,'Item ou pagador de rateio inválido/repetido.');
           selected.add(item.id);
           subtotals[payerIndex-1]+=item.totalCents;
           return {itemId:item.id,payerIndex,totalCents:item.totalCents};
         });
         if(subtotals.some(value=>value<=0))throw fail(400,'Cada pagador precisa ter ao menos um item atribuído.');
         const fees=subtotals.map(value=>Math.floor(serviceChargeCents*value/position.baseCents));
         for(let remainder=serviceChargeCents-fees.reduce((a,b)=>a+b,0),i=0;remainder>0;remainder--,i++)
           fees[i%parts]++;
         shares=subtotals.map((value,i)=>value+fees[i]);
       }else{
         try{shares=planShares(totalCents,parts,body.shares??null);}catch(e){throw fail(400,e.message);}
       }
       try{shares=planShares(totalCents,parts,shares);}catch(e){throw fail(400,e.message);}
       return {result:{sessionId,parts,baseCents:position.baseCents,serviceChargeBps:bps,serviceChargeProductId:feeId,
         serviceChargeCents,totalCents,shares,allocations:allocations||[]},
         statements:[q(`INSERT INTO r4_split_plans(tenant_id,branch_id,table_session_id,parts,service_charge_bps,service_charge_product_id,shares_json,item_allocations_json,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,branch_id,table_session_id) DO UPDATE SET
           parts=excluded.parts,service_charge_bps=excluded.service_charge_bps,
           service_charge_product_id=excluded.service_charge_product_id,shares_json=excluded.shares_json,
           item_allocations_json=excluded.item_allocations_json,updated_at=excluded.updated_at`,
           t,b,sessionId,parts,bps,feeId,JSON.stringify(shares),allocations?JSON.stringify(allocations):null,stamp())]};
     });
   },

   async printJobs(t,b){
     await branch(t,b);
     const rows=await all(`SELECT j.id,j.station_ticket_id AS stationTicketId,j.printer_name AS printerName,
       j.status,j.attempt_count AS attempts,j.leased_until AS leasedUntil,
       j.created_at AS createdAt,j.updated_at AS updatedAt,j.payload_json AS payload
       FROM r4_kitchen_print_jobs j WHERE j.tenant_id=? AND j.branch_id=?
       ORDER BY j.created_at DESC,j.id DESC LIMIT 250`,t,b);
     return rows.map(({payload,...row})=>({...row,payload:JSON.parse(payload)}));
   },
   async claimPrint(t,b,jobId,key){
     await branch(t,b);
     if(!keyValid(key))throw fail(400,'Identificador da operação obrigatório.');
     const scope='r4.print.claim:'+b+':'+jobId;
     const prior=await first('SELECT result_json FROM commerce_mutations WHERE tenant_id=? AND scope=? AND mutation_id=?',t,scope,key);
     if(prior)return JSON.parse(prior.result_json);
     const row=await first('SELECT status,attempt_count AS attempts,leased_until AS until FROM r4_kitchen_print_jobs WHERE tenant_id=? AND branch_id=? AND id=?',t,b,jobId);
     if(!row)throw fail(404,'Ticket de impressão não encontrado.');
     const current=stamp();
     if(row.attempts>=8||!(['PENDING','FAILED'].includes(row.status)||(row.status==='LEASED'&&row.until<=current)))
       throw fail(409,'Ticket já em impressão ou finalizado.');
     const leaseToken=id(),leasedUntil=new Date(Date.now()+120000).toISOString(),result={id:jobId,status:'LEASED',leaseToken,leasedUntil,attempts:row.attempts+1};
     await db.batch([
       q(`UPDATE r4_kitchen_print_jobs SET status='LEASED',lease_token=?,leased_until=?,
           attempt_count=attempt_count+1,last_error=NULL,updated_at=?
           WHERE tenant_id=? AND branch_id=? AND id=? AND attempt_count<8
             AND (status IN('PENDING','FAILED') OR (status='LEASED' AND leased_until<=?))`,
         leaseToken,leasedUntil,current,t,b,jobId,current),
       q(`INSERT INTO commerce_mutations(tenant_id,scope,mutation_id,result_json,occurred_at)
          SELECT ?,?,?,?,? WHERE changes()=1`,t,scope,key,JSON.stringify(result),current)
     ]);
     const won=await first('SELECT result_json FROM commerce_mutations WHERE tenant_id=? AND scope=? AND mutation_id=?',t,scope,key);
     if(!won)throw fail(409,'Outro terminal assumiu a impressão. Atualize o painel.');
     return JSON.parse(won.result_json);
   },
   async acknowledgePrint(t,b,jobId,body,key){
     await branch(t,b);
     const scope='r4.print.ack:'+b+':'+jobId;
     if(!keyValid(key))throw fail(400,'Identificador da operação obrigatório.');
     const prior=await first('SELECT result_json FROM commerce_mutations WHERE tenant_id=? AND scope=? AND mutation_id=?',t,scope,key);
     if(prior)return JSON.parse(prior.result_json);
     const token=label(body.leaseToken,128),status=label(body.status).toUpperCase();
     const lastError=status==='FAILED'?label(body.error,200)||'Falha de impressão local.':null;
     if(!/^[a-f0-9-]{36}$/i.test(token)||!['PRINTED','FAILED'].includes(status))throw fail(400,'Confirmação de impressão inválida.');
     const row=await first('SELECT status,lease_token AS token,leased_until AS until FROM r4_kitchen_print_jobs WHERE tenant_id=? AND branch_id=? AND id=?',t,b,jobId);
     if(!row)throw fail(404,'Ticket de impressão não encontrado.');
     const current=stamp();
     if(row.status!=='LEASED'||row.token!==token||row.until<current)throw fail(409,'Reserva de impressão expirada ou inválida.');
     const result={id:jobId,status};
     await db.batch([
       q(`UPDATE r4_kitchen_print_jobs SET status=?,lease_token=NULL,leased_until=NULL,last_error=?,updated_at=?
          WHERE tenant_id=? AND branch_id=? AND id=? AND status='LEASED'
          AND lease_token=? AND leased_until>=?`,status,lastError,current,t,b,jobId,token,current),
       q(`INSERT INTO commerce_mutations(tenant_id,scope,mutation_id,result_json,occurred_at)
         SELECT ?,?,?,?,? WHERE changes()=1`,t,scope,key,JSON.stringify(result),current)
     ]);
     const won=await first('SELECT result_json FROM commerce_mutations WHERE tenant_id=? AND scope=? AND mutation_id=?',t,scope,key);
     if(!won)throw fail(409,'O ticket foi confirmado por outro terminal.');
     return JSON.parse(won.result_json);
   },
   async pizzaProfiles(t,b){
     await branch(t,b);
     return all('SELECT product_id AS productId,pricing_policy AS policy,pricing_mode AS pricingMode,max_flavors AS maxFlavors FROM r4_pizza_profiles WHERE tenant_id=? AND branch_id=? ORDER BY product_id',t,b);
   },
   async pizzaProfile(t,b,productId){
     await branch(t,b);await product(t,productId);
     const profile=await first('SELECT product_id AS productId,pricing_policy AS policy,pricing_mode AS pricingMode,max_flavors AS maxFlavors FROM r4_pizza_profiles WHERE tenant_id=? AND branch_id=? AND product_id=?',t,b,productId);
     if(!profile)return null;
     const entries=await all('SELECT kind,code,name,price_cents AS priceCents FROM r4_pizza_options WHERE tenant_id=? AND branch_id=? AND product_id=? ORDER BY kind,code',t,b,productId);
     const addons=await all('SELECT code,name,price_cents AS priceCents FROM r4_pizza_addons WHERE tenant_id=? AND branch_id=? AND product_id=? ORDER BY code',t,b,productId);
     return {...profile,sizes:entries.filter(x=>x.kind==='SIZE'),flavors:entries.filter(x=>x.kind==='FLAVOR'),crusts:entries.filter(x=>x.kind==='CRUST'),addons};
   },
   async savePizzaProfile(t,b,body,key){
     await branch(t,b);const p=await product(t,body.productId);
     const policy=label(body.policy).toUpperCase();
     if(!['HIGHEST_FLAVOR','PROPORTIONAL_AVERAGE'].includes(policy))throw fail(400,'Política de preço inválida.');
     const pricingMode=label(body.pricingMode||'ABSOLUTE_OPTIONS').toUpperCase();
     if(!['ABSOLUTE_OPTIONS','DESKTOP_DELTAS'].includes(pricingMode))throw fail(400,'Modo de preço inválido.');
     const maxFlavors=integer(body.maxFlavors??4,1,8,'Limite de sabores');
     const sizes=options(body.sizes,'SIZE',true),flavors=options(body.flavors,'FLAVOR',true),crusts=options(body.crusts??[],'CRUST',false);
     const addons=options(body.addons??[],'ADDON',false);
     return mutation(t,'r4.pizza.profile:'+b+':'+p.id,key,async()=>{
       const entries=[...sizes,...flavors,...crusts];
       return {result:{productId:p.id,policy,pricingMode,maxFlavors,sizes,flavors,crusts,addons},statements:[
         q(`INSERT INTO r4_pizza_profiles(tenant_id,branch_id,product_id,pricing_policy,pricing_mode,max_flavors,updated_at)
          VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant_id,branch_id,product_id) DO UPDATE SET
          pricing_policy=excluded.pricing_policy,pricing_mode=excluded.pricing_mode,max_flavors=excluded.max_flavors,updated_at=excluded.updated_at`,
          t,b,p.id,policy,pricingMode,maxFlavors,stamp()),
         q('DELETE FROM r4_pizza_options WHERE tenant_id=? AND branch_id=? AND product_id=?',t,b,p.id),
         q('DELETE FROM r4_pizza_addons WHERE tenant_id=? AND branch_id=? AND product_id=?',t,b,p.id),
         ...addons.map(x=>q('INSERT INTO r4_pizza_addons(tenant_id,branch_id,product_id,code,name,price_cents) VALUES(?,?,?,?,?,?)',t,b,p.id,x.code,x.name,x.priceCents)),
         ...entries.map(x=>q('INSERT INTO r4_pizza_options(tenant_id,branch_id,product_id,kind,code,name,price_cents) VALUES(?,?,?,?,?,?,?)',
          t,b,p.id,x.kind,x.code,x.name,x.priceCents))]};
     });
   },
   async quotePizza(t,b,body){
     await branch(t,b);const p=await this.pizzaProfile(t,b,body.productId);
     if(!p)throw fail(404,'Produto sem perfil de pizza.');
     const size=p.sizes.find(x=>x.code===body.sizeCode);
     if(!size)throw fail(400,'Tamanho inválido.');
     const codes=body.flavorCodes;
     if(!Array.isArray(codes)||!codes.length||codes.length>p.maxFlavors||new Set(codes).size!==codes.length)
       throw fail(400,'Escolha de sabores inválida.');
     const flavors=codes.map(code=>p.flavors.find(x=>x.code===code));
     if(flavors.some(x=>!x))throw fail(400,'Sabor inválido.');
     const crust=body.crustCode?p.crusts.find(x=>x.code===body.crustCode):null;
     if(body.crustCode&&!crust)throw fail(400,'Borda inválida.');
     const addonCodes=body.addonCodes??[];
     if(!Array.isArray(addonCodes)||addonCodes.length>12||new Set(addonCodes).size!==addonCodes.length)
       throw fail(400,'Adicionais repetidos ou inválidos.');
     const addons=addonCodes.map(code=>p.addons.find(x=>x.code===code));
     if(addons.some(x=>!x))throw fail(400,'Adicional inválido.');
     const flavorCents=p.policy==='HIGHEST_FLAVOR'?Math.max(...flavors.map(x=>x.priceCents)):
       Math.round(flavors.reduce((sum,x)=>sum+x.priceCents,0)/flavors.length);
     const base=p.pricingMode==='DESKTOP_DELTAS'?(await product(t,p.productId)).sale_price_cents:0;
     const addonsCents=addons.reduce((sum,x)=>sum+x.priceCents,0);
     const price=(p.pricingMode==='DESKTOP_DELTAS'?base+size.priceCents+flavorCents+(crust?.priceCents||0):
       Math.max(size.priceCents,flavorCents)+(crust?.priceCents||0))+addonsCents;
     const unitPriceCents=integer(price,0,1_000_000_000,'Preço final');
     return {productId:p.productId,policy:p.policy,pricingMode:p.pricingMode,unitPriceCents,configuration:{
       pricingMode:p.pricingMode,
       size:{code:size.code,name:size.name},flavors:flavors.map(x=>({code:x.code,name:x.name})),
       crust:crust?{code:crust.code,name:crust.name}:null,
       addons:addons.map(x=>({code:x.code,name:x.name,priceCents:x.priceCents}))}};
   },
   async quoteWeightLabel(t,b,body){
     await branch(t,b);
     let label;
     try{label=parseWeightedEAN13(body.barcode);}catch(e){throw fail(400,e.message);}
     const p=await first('SELECT id FROM products WHERE tenant_id=? AND sku=? AND active=1',t,label.plu);
     if(!p)throw fail(404,'Produto da etiqueta não encontrado no catálogo da loja.');
     const quote=await this.quoteWeight(t,b,{productId:p.id,grams:label.grams});
     return {...quote,barcode:label.barcode,plu:label.plu,source:'EAN13_WEIGHT_LABEL'};
   },
   async quoteWeight(t,b,body){
     await branch(t,b);const p=await product(t,body.productId);
     if(p.unit?.toUpperCase()!=='KG')throw fail(400,'Produto precisa utilizar unidade KG.');
     const grams=integer(body.grams,1,100000000,'Peso em gramas');
     const totalCents=integer(Math.round(p.sale_price_cents*grams/1000),0,1_000_000_000,'Total');
     return {productId:p.id,productName:p.name,grams,quantity:grams/1000,unitPriceCents:p.sale_price_cents,totalCents};
   },
   async segments(t,b){
     await branch(t,b);
     const chosen=await first('SELECT segment_id AS segmentId FROM r4_segment_preferences WHERE tenant_id=? AND branch_id=?',t,b);
     return {selectedId:chosen?.segmentId||null,segments:[
       {id:'RESTAURANT',label:'Restaurante',recommended:['FOOD'],optional:['WHOLESALE']},
       {id:'PIZZERIA',label:'Pizzaria',recommended:['FOOD'],optional:['WHOLESALE']},
       {id:'DELIVERY',label:'Delivery e retirada',recommended:['FOOD'],optional:[]},
       {id:'BAKERY',label:'Padaria e confeitaria',recommended:['FOOD'],optional:['WHOLESALE']},
       {id:'MARKET',label:'Mercado e mercearia',recommended:[],optional:['FOOD','WHOLESALE']},
       {id:'GENERAL',label:'Comércio geral',recommended:[],optional:['FOOD','WHOLESALE']}
     ],note:'As sugestões não ativam permissões nem módulos. O operador escolhe cada módulo nas configurações.'};
   },
   async selectSegment(t,b,body,key){
     await branch(t,b);
     const code=label(body.segmentId).toUpperCase();
     if(!['RESTAURANT','PIZZERIA','DELIVERY','BAKERY','MARKET','GENERAL'].includes(code))throw fail(400,'Segmento inválido.');
     return mutation(t,'r4.segment:'+b,key,async()=>({result:{segmentId:code},statements:[
       q(`INSERT INTO r4_segment_preferences(tenant_id,branch_id,segment_id,updated_at)
        VALUES(?,?,?,?) ON CONFLICT(tenant_id,branch_id) DO UPDATE SET segment_id=excluded.segment_id,updated_at=excluded.updated_at`,t,b,code,stamp())
     ]}));
   },
   async optionRecipe(t,b,productId,kind,code){
     await branch(t,b);await product(t,productId);
     const k=label(kind).toUpperCase(),c=label(code,32);
     if(!['SIZE','FLAVOR','CRUST','ADDON'].includes(k)||!c)throw fail(400,'Opção da ficha inválida.');
     const row=await first('SELECT MAX(version) AS version FROM r4_recipe_option_versions WHERE tenant_id=? AND branch_id=? AND product_id=? AND option_kind=? AND option_code=?',t,b,productId,k,c);
     if(!row?.version)return null;
     const ingredients=await all('SELECT ingredient_id AS ingredientId,quantity_milli / 1000.0 AS quantity FROM r4_recipe_option_ingredients WHERE tenant_id=? AND branch_id=? AND product_id=? AND option_kind=? AND option_code=? AND version=?',t,b,productId,k,c,row.version);
     return {productId,kind:k,code:c,version:row.version,ingredients};
   },
   async saveOptionRecipe(t,b,productId,body,key){
     await branch(t,b);
     const p=await product(t,productId);
     if(p.track_stock)throw fail(409,'Pizza composta precisa ter estoque próprio desativado.');
     const kind=label(body.kind).toUpperCase(),code=label(body.code,32);
     const profile=await this.pizzaProfile(t,b,productId);
     const options={SIZE:profile?.sizes,FLAVOR:profile?.flavors,CRUST:profile?.crusts,ADDON:profile?.addons};
     if(!Object.hasOwn(options,kind)||!options[kind]?.some(x=>x.code===code))
       throw fail(400,'Selecione uma opção cadastrada no cardápio.');
     if(!Array.isArray(body.ingredients)||!body.ingredients.length||body.ingredients.length>40)
       throw fail(400,'Informe ingredientes da opção.');
     const ingredients=[],seen=new Set();
     for(const row of body.ingredients){
       const ingredient=await product(t,row.ingredientId);
       if(ingredient.id===productId||!ingredient.track_stock||seen.has(ingredient.id))throw fail(400,'Ingrediente repetido ou sem controle de estoque.');
       const milli=integer(Math.round(Number(row.quantity)*1000),1,100000000,'Quantidade de ingrediente');
       if(Math.abs(Number(row.quantity)*1000-milli)>0.000001)throw fail(400,'Quantidade de insumo deve ter até três casas.');
       seen.add(ingredient.id);ingredients.push({ingredientId:ingredient.id,quantity:milli/1000,milli});
     }
     return mutation(t,'r4.recipe.option:'+b+':'+productId+':'+kind+':'+code,key,async()=>{
       const current=await first('SELECT MAX(version) AS version FROM r4_recipe_option_versions WHERE tenant_id=? AND branch_id=? AND product_id=? AND option_kind=? AND option_code=?',t,b,productId,kind,code);
       const version=(current?.version||0)+1;
       return {result:{productId,kind,code,version,ingredients:ingredients.map(({milli,...x})=>x)},statements:[
         q('INSERT INTO r4_recipe_option_versions(tenant_id,branch_id,product_id,option_kind,option_code,version,created_at) VALUES(?,?,?,?,?,?,?)',t,b,productId,kind,code,version,stamp()),
         ...ingredients.map(x=>q('INSERT INTO r4_recipe_option_ingredients(tenant_id,branch_id,product_id,option_kind,option_code,version,ingredient_id,quantity_milli) VALUES(?,?,?,?,?,?,?,?)',t,b,productId,kind,code,version,x.ingredientId,x.milli))
       ]};
     });
   },
   async recipe(t,b,productId){
     await branch(t,b);const prepared=await product(t,productId);
     const row=await first('SELECT MAX(version) AS version FROM r4_recipe_versions WHERE tenant_id=? AND branch_id=? AND product_id=?',t,b,productId);
     if(!row?.version)return null;
     const items=await all(`SELECT r.ingredient_id AS ingredientId,p.name AS ingredientName,p.unit,
        p.last_cost_cents AS costCents,r.quantity_milli / 1000.0 AS quantity,
        COALESCE(s.balance_milli,0)/1000.0 AS balance
        FROM r4_recipe_ingredients r JOIN products p ON p.id=r.ingredient_id AND p.tenant_id=r.tenant_id
        LEFT JOIN stock_positions s ON s.tenant_id=r.tenant_id AND s.branch_id=r.branch_id AND s.product_id=r.ingredient_id
        WHERE r.tenant_id=? AND r.branch_id=? AND r.product_id=? AND r.version=? ORDER BY p.name`,
        t,b,productId,row.version);
     let details=null,componentDetails=[];
     try{
       details=await first(`SELECT yield_quantity AS yieldQuantity,yield_unit AS yieldUnit,
         portion_quantity AS portionQuantity,prep_time_minutes AS prepTimeMinutes,
         preparation_notes AS preparationNotes,notes FROM r4_recipe_details
         WHERE tenant_id=? AND branch_id=? AND product_id=? AND version=?`,t,b,productId,row.version);
       if(details)componentDetails=await all(`SELECT ingredient_id AS productId,quantity,unit,
         conversion_factor AS conversionFactor,loss_percent AS lossPercent FROM r4_recipe_component_details
         WHERE tenant_id=? AND branch_id=? AND product_id=? AND version=?`,t,b,productId,row.version);
     }catch(e){if(!/no such table: r4_recipe_(?:component_)?details/i.test(String(e?.message)))throw e;}
     const meta=details||{yieldQuantity:1,yieldUnit:prepared.unit||'UN',portionQuantity:1,prepTimeMinutes:0,preparationNotes:'',notes:''};
     const portions=meta.yieldQuantity/meta.portionQuantity;
     const components=items.map(item=>{
       const saved=componentDetails.find(c=>c.productId===item.ingredientId);
       const c={productId:item.ingredientId,productName:item.ingredientName,quantity:item.quantity,unit:item.unit,conversionFactor:1,lossPercent:0,...saved,costCents:item.costCents||0,balance:item.balance};
       c.requiredPerUnit=c.quantity*c.conversionFactor*(1+c.lossPercent/100)/portions;
       c.totalCostCents=Math.round(c.costCents*c.quantity*c.conversionFactor*(1+c.lossPercent/100));
       return c;
     });
     const theoreticalCostCents=components.reduce((n,c)=>n+c.totalCostCents,0),costPerPortionCents=Math.round(theoreticalCostCents/portions);
     const capacity=components.length?Math.max(0,Math.min(...components.map(c=>Math.floor((c.balance+1e-9)/c.requiredPerUnit)))):0;
     return {productId,version:row.version,...meta,components,theoreticalCostCents,costPerPortionCents,capacity,
       cmvPercent:prepared.sale_price_cents>0?costPerPortionCents/prepared.sale_price_cents*100:null,
       grossMarginCents:prepared.sale_price_cents-costPerPortionCents,
       ingredients:components.map(c=>({ingredientId:c.productId,ingredientName:c.productName,quantity:c.requiredPerUnit}))};
   },
   async saveRecipe(t,b,productId,body,key){
     await branch(t,b);const p=await product(t,productId);
     if(p.track_stock)throw fail(409,'Produto com receita deve ter estoque próprio desativado para evitar débito duplo.');
     const input=body.components??body.ingredients;
     if(!Array.isArray(input)||!input.length||input.length>40)throw fail(400,'Ingredientes inválidos.');
     const positive=(value,title,max=100000000)=>{const n=Number(value);if(!Number.isFinite(n)||n<=0||n>max)throw fail(400,title+' inválido.');return n;};
     const unit=value=>{const v=label(value,8).toUpperCase();if(!['UN','KG','G','L','ML','M','M2','M3','CX','PCT'].includes(v))throw fail(400,'Unidade da ficha inválida.');return v;};
     const yieldQuantity=positive(body.yieldQuantity??1,'Rendimento'),portionQuantity=positive(body.portionQuantity??1,'Porção');
     if(portionQuantity>yieldQuantity)throw fail(400,'A porção não pode superar o rendimento da receita.');
     const meta={yieldQuantity,yieldUnit:unit(body.yieldUnit||p.unit||'UN'),portionQuantity,
       prepTimeMinutes:integer(Number(body.prepTimeMinutes??0),0,100000,'Tempo de preparo'),
       preparationNotes:label(body.preparationNotes,10000),notes:label(body.notes,10000)};
     const portions=yieldQuantity/portionQuantity,ingredients=[],seen=new Set();
     for(const row of input){
       const ingredient=await product(t,row.productId??row.ingredientId);
       if(ingredient.id===p.id||seen.has(ingredient.id)||!ingredient.track_stock)throw fail(400,'Ingrediente repetido ou sem estoque.');
       const quantity=positive(row.quantity,'Quantidade de insumo');
       if(Math.abs(quantity*1000-Math.round(quantity*1000))>0.000001)throw fail(400,'Use até três casas decimais na quantidade.');
       const conversionFactor=positive(row.conversionFactor??1,'Fator de conversão',1000000),lossPercent=Number(row.lossPercent??0);
       if(!Number.isFinite(lossPercent)||lossPercent<0||lossPercent>=100)throw fail(400,'Perda deve estar entre 0 e menos de 100%.');
       const batchConsumption=quantity*conversionFactor*(1+lossPercent/100);
       if(!Number.isFinite(batchConsumption)||!Number.isSafeInteger(Math.round(batchConsumption*(ingredient.last_cost_cents||0))))throw fail(400,'Custo da receita fora dos limites.');
       const perPortion=batchConsumption/portions;
       if(!Number.isFinite(perPortion)||perPortion>100000)throw fail(400,'Consumo da porção fora dos limites.');
       const milli=Math.max(1,Math.round(perPortion*1000));
       const component={ingredientId:ingredient.id,quantity,unit:unit(row.unit||ingredient.unit),conversionFactor,lossPercent,milli};
       seen.add(ingredient.id);ingredients.push(component);
     }
     const hasDetails=Boolean(await first("SELECT name FROM sqlite_master WHERE type='table' AND name='r4_recipe_details'"));
     const rich=body.components!==undefined||['yieldQuantity','yieldUnit','portionQuantity','prepTimeMinutes','preparationNotes','notes'].some(k=>body[k]!==undefined)||input.some(x=>x.conversionFactor!==undefined||x.lossPercent!==undefined);
     if(rich&&!hasDetails)throw fail(503,'Atualize as migrações do servidor para salvar a ficha técnica completa.');
     return mutation(t,'r4.recipe:'+b+':'+productId,key,async()=>{
       const prior=await first('SELECT MAX(version) AS version FROM r4_recipe_versions WHERE tenant_id=? AND branch_id=? AND product_id=?',t,b,productId);
       const version=(prior?.version||0)+1;
       const statements=[q('INSERT INTO r4_recipe_versions(tenant_id,branch_id,product_id,version,created_at) VALUES(?,?,?,?,?)',t,b,productId,version,stamp()),
         ...ingredients.map(x=>q('INSERT INTO r4_recipe_ingredients(tenant_id,branch_id,product_id,version,ingredient_id,quantity_milli) VALUES(?,?,?,?,?,?)',t,b,productId,version,x.ingredientId,x.milli))];
       if(hasDetails){
         statements.push(q(`INSERT INTO r4_recipe_details(tenant_id,branch_id,product_id,version,yield_quantity,yield_unit,portion_quantity,prep_time_minutes,preparation_notes,notes)
          VALUES(?,?,?,?,?,?,?,?,?,?)`,t,b,productId,version,meta.yieldQuantity,meta.yieldUnit,meta.portionQuantity,meta.prepTimeMinutes,meta.preparationNotes,meta.notes));
         statements.push(...ingredients.map(x=>q(`INSERT INTO r4_recipe_component_details(tenant_id,branch_id,product_id,version,ingredient_id,quantity,unit,conversion_factor,loss_percent)
          VALUES(?,?,?,?,?,?,?,?,?)`,t,b,productId,version,x.ingredientId,x.quantity,x.unit,x.conversionFactor,x.lossPercent)));
       }
       return {result:{productId,version,...meta,components:ingredients.map(({milli,ingredientId,...x})=>({productId:ingredientId,...x})),
         ingredients:ingredients.map(x=>({ingredientId:x.ingredientId,quantity:x.quantity*x.conversionFactor*(1+x.lossPercent/100)/portions}))},statements};
     });
   }
 };
 return result;
}
