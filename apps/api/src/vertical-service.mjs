// Cloudflare D1 / local SQLite adapter for the canonical PDV tenant domain.
// Documents never debit stock or create a second sale; checkout remains the sole sale authority.
import canonicalPricing from '../../../packages/core/js/domains/sales/pricing.js';
import inventoryRules from '../../../packages/core/js/domains/inventory/inventory-rules.js';
const {calculateSaleTotals}=canonicalPricing;
const {roundQuantity}=inventoryRules;
const err=(status,message)=>Object.assign(new Error(message),{status});
const uuid=()=>crypto.randomUUID();
const now=()=>new Date().toISOString();
const clean=(x,max=150)=>typeof x==='string'?x.trim().slice(0,max):'';
const cents=(x,label='Valor')=>{
 if(!Number.isSafeInteger(x)||x<0||x>1_000_000_000)throw err(400,label+' inválido.');
 return x;
};
const qty=(x)=>{
 if(typeof x!=='number'||!Number.isFinite(x)||x<=0||x>100000)throw err(400,'Quantidade inválida.');
 const rounded=roundQuantity(x);
 if(Math.abs(rounded-x)>0.00000001)throw err(400,'Use até 3 casas decimais.');
 return Math.round(rounded*1000);
};
const keyOK=key=>typeof key==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(key);

export function createVerticalService(db){
 const q=(sql,...args)=>db.prepare(sql).bind(...args);
 const first=(sql,...args)=>q(sql,...args).first();
 const all=async(sql,...args)=>(await q(sql,...args).all()).results;
 async function branchExists(t,b){
   if(!b||!(await first('SELECT id FROM branches WHERE tenant_id=? AND id=? AND active=1',t,b)))
     throw err(404,'Filial não encontrada.');
 }
 async function mutate(t,scope,key,create){
   if(!keyOK(key))throw err(400,'Identificador da operação obrigatório.');
   const prior=await first('SELECT result_json FROM commerce_mutations WHERE tenant_id=? AND scope=? AND mutation_id=?',t,scope,key);
   if(prior)return JSON.parse(prior.result_json);
   const {statements,result}=await create();
   const batch=[...statements,q('INSERT INTO commerce_mutations(tenant_id,scope,mutation_id,result_json,occurred_at) VALUES(?,?,?,?,?)',
     t,scope,key,JSON.stringify(result),now())];
   try{await db.batch(batch);}catch(e){
     if(/constraint|UNIQUE|FOREIGN KEY|CASH|IMMUTABLE/i.test(String(e?.message)))throw err(409,'Conflito com dados atuais. Atualize e tente novamente.');
     throw e;
   }
   return result;
 }
 const contactFields=row=>({id:row.id,name:row.name,document:row.document||'',phone:row.phone||'',email:row.email||'',address:row.address||'',
   active:!!row.active,...('credit_limit_cents' in row?{creditLimitCents:row.credit_limit_cents}:{})});
 async function contact(t,kind,id){
   const row=await first('SELECT * FROM '+kind+' WHERE tenant_id=? AND id=?',t,id);
   if(!row)throw err(404,'Cadastro não encontrado.');
   return row;
 }
 async function customer(t,id){return contact(t,'customers',id);}
 async function product(t,id){
   const p=await first('SELECT * FROM products WHERE tenant_id=? AND id=? AND active=1',t,id);
   if(!p)throw err(404,'Produto não encontrado.');
   return p;
 }
 async function seller(t,id){
   const user=await first('SELECT u.id,u.display_name AS name FROM users u JOIN tenant_memberships m ON m.user_id=u.id WHERE u.id=? AND m.tenant_id=? AND u.active=1 AND m.active=1',id,t);
   if(!user)throw err(404,'Vendedor não encontrado neste estabelecimento.');
   return user;
 }
 async function orderItems(t,b,items){
   if(!Array.isArray(items)||items.length<1||items.length>80)throw err(400,'Informe de 1 a 80 itens.');
   const keys=new Set(),result=[];
   for(const item of items){
     if(keys.has(item.productId))throw err(400,'Produto repetido. Agrupe a quantidade.');
     keys.add(item.productId);
     const p=await product(t,item.productId),milli=qty(item.quantity);
     result.push({productId:p.id,name:p.name,quantity:milli/1000,milli,unitPriceCents:p.sale_price_cents});
   }
   return result;
 }
 function isSafeStatus(value,values){if(!values.includes(value))throw err(400,'Status inválido.');}
 async function checkSession(t,b,id){
   const s=await first('SELECT * FROM restaurant_table_sessions WHERE tenant_id=? AND branch_id=? AND id=?',t,b,id);
   if(!s)throw err(404,'Comanda não encontrada.');
   return s;
 }
 async function loadWholesale(t,b,id){
   const row=await first('SELECT * FROM wholesale_orders WHERE tenant_id=? AND branch_id=? AND id=?',t,b,id);
   if(!row)throw err(404,'Pedido de atacado não encontrado.');
   const items=await all('SELECT product_id AS productId,quantity_milli / 1000.0 AS quantity,unit_price_cents AS unitPriceCents,tier_id AS tierId FROM wholesale_order_items WHERE tenant_id=? AND branch_id=? AND order_id=? ORDER BY rowid',t,b,id);
   return {id:row.id,customerId:row.customer_id,status:row.status,totalCents:row.total_cents,fulfillmentType:row.fulfillment,items,createdAt:row.created_at};
 }
 async function price(t,b,productId,quantity){
   const productRow=await product(t,productId),milli=qty(quantity);
   const tier=await first('SELECT id,min_quantity_milli,unit_price_cents FROM wholesale_tiers WHERE tenant_id=? AND branch_id=? AND product_id=? AND active=1 AND min_quantity_milli<=? ORDER BY min_quantity_milli DESC LIMIT 1',t,b,productId,milli);
   return {productId,productName:productRow.name,quantity:milli/1000,unitPriceCents:tier?.unit_price_cents??productRow.sale_price_cents,
     baseUnitPriceCents:productRow.sale_price_cents,tierId:tier?.id||null,minQuantity:(tier?.min_quantity_milli||0)/1000};
 }
 return {
   async contacts(t,b,kind){await branchExists(t,b);return (await all('SELECT * FROM '+kind+' WHERE tenant_id=? ORDER BY active DESC,name LIMIT 300',t)).map(contactFields);},
   async upsertContact(t,b,kind,body,key){
     await branchExists(t,b);
     const name=clean(body.name,120);if(name.length<2)throw err(400,'Informe nome com pelo menos 2 caracteres.');
     const requestedId=clean(body.id,100);
     const id=requestedId||uuid(),scope=requestedId?kind+'.update:'+requestedId:kind+'.create';
     const prev=body.id?await contact(t,kind,id):null;
     const doc=clean(body.document,32)||null,email=clean(body.email,120)||null;
     const phone=clean(body.phone,40)||null,address=clean(body.address,300)||null;
     const limit=kind==='customers'?cents(body.creditLimitCents??prev?.credit_limit_cents??0,'Limite de crédito'):null;
     return mutate(t,scope,key,async()=>{
       const stamp=now();
       const sql=kind==='customers'
         ?'INSERT INTO customers(id,tenant_id,name,document,phone,email,address,credit_limit_cents,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,document=excluded.document,phone=excluded.phone,email=excluded.email,address=excluded.address,credit_limit_cents=excluded.credit_limit_cents,active=excluded.active,updated_at=excluded.updated_at'
         :'INSERT INTO suppliers(id,tenant_id,name,document,phone,email,address,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,document=excluded.document,phone=excluded.phone,email=excluded.email,address=excluded.address,active=excluded.active,updated_at=excluded.updated_at';
       const row={id,name,document:doc||'',email:email||'',phone:phone||'',address:address||'',active:body.active!==false};
       const params=kind==='customers'?[id,t,name,doc,phone,email,address,limit,row.active?1:0,prev?.created_at||stamp,stamp]
         :[id,t,name,doc,phone,email,address,row.active?1:0,prev?.created_at||stamp,stamp];
       return {statements:[q(sql,...params)],result:{...row,...(kind==='customers'?{creditLimitCents:limit}:{})}};
     });
   },
   async sellers(t,b){await branchExists(t,b);return all('SELECT u.id,u.display_name AS name,m.profile_key AS profileKey FROM tenant_memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.active=1 AND u.active=1 ORDER BY u.display_name',t);},
   async tables(t,b){await branchExists(t,b);return all(`SELECT r.id,r.label,r.seats,r.active,s.id AS sessionId,s.status AS sessionStatus,s.party_size AS partySize
     FROM restaurant_tables r LEFT JOIN restaurant_table_sessions s ON s.tenant_id=r.tenant_id AND s.branch_id=r.branch_id AND s.table_id=r.id AND s.status IN('OPEN','CHECKOUT')
     WHERE r.tenant_id=? AND r.branch_id=? ORDER BY r.label`,t,b);},
   async saveTable(t,b,body,key){
     await branchExists(t,b);const label=clean(body.label,80),seats=body.seats??4;
     if(!label||!Number.isInteger(seats)||seats<0||seats>1000)throw err(400,'Identificação ou lugares inválidos.');
     const id=clean(body.id,100)||uuid();
     return mutate(t,'restaurant.table:'+id,key,async()=>{
       const stamp=now();
       return {statements:[q(`INSERT INTO restaurant_tables(id,tenant_id,branch_id,label,seats,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET label=excluded.label,seats=excluded.seats,updated_at=excluded.updated_at WHERE tenant_id=excluded.tenant_id AND branch_id=excluded.branch_id`,id,t,b,label,seats,stamp,stamp)],
         result:{id,label,seats,active:true}};
     });
   },
   async openTable(t,b,user,id,body,key){
     await branchExists(t,b);const row=await first('SELECT id FROM restaurant_tables WHERE tenant_id=? AND branch_id=? AND id=? AND active=1',t,b,id);
     if(!row)throw err(404,'Mesa não encontrada.');
     const partySize=body.partySize??1;
     if(!Number.isInteger(partySize)||partySize<1||partySize>1000)throw err(400,'Quantidade de pessoas inválida.');
     if(body.customerId)await customer(t,body.customerId);
     return mutate(t,'restaurant.open:'+b+':'+id,key,async()=>{
       const result={id:uuid(),tableId:id,status:'OPEN',partySize,customerId:body.customerId||null,openedBy:user,openedAt:now()};
       return {statements:[q('INSERT INTO restaurant_table_sessions(id,tenant_id,branch_id,table_id,status,party_size,customer_id,opened_by,opened_at) VALUES(?,?,?,?,?,?,?,?,?)',
         result.id,t,b,id,'OPEN',partySize,result.customerId,user,result.openedAt)],result};
     });
   },
   async tableSession(t,b,id){await branchExists(t,b);return checkSession(t,b,id);},
   async closeTable(t,b,id,key){
     await branchExists(t,b);const s=await checkSession(t,b,id);
     if(s.status==='CLOSED')throw err(409,'Comanda já fechada.');
     const active=await first(`SELECT COUNT(*) AS n FROM restaurant_orders WHERE tenant_id=? AND branch_id=? AND table_session_id=? AND status NOT IN('CANCELLED','DELIVERED')`,t,b,id);
     if(active.n)throw err(409,'Finalize ou cancele todos os pedidos antes de fechar a mesa.');
     return mutate(t,'restaurant.close:'+id,key,async()=>{
       const result={id,status:'CLOSED'};
       return {statements:[q("UPDATE restaurant_table_sessions SET status='CLOSED',closed_at=? WHERE tenant_id=? AND branch_id=? AND id=? AND status IN('OPEN','CHECKOUT')",now(),t,b,id)],result};
     });
   },
   async foodOrders(t,b,fulfillment=''){await branchExists(t,b);
     const rows=await all(`SELECT * FROM restaurant_orders WHERE tenant_id=? AND branch_id=? AND (?='' OR fulfillment=?) ORDER BY created_at DESC LIMIT 100`,t,b,fulfillment,fulfillment);
     return Promise.all(rows.map(async row=>({...row,items:await all('SELECT product_id AS productId,product_name AS name,quantity_milli / 1000.0 AS quantity,unit_price_cents AS unitPriceCents FROM restaurant_order_items WHERE tenant_id=? AND branch_id=? AND order_id=?',t,b,row.id)})));
   },
   async createFoodOrder(t,b,user,body,key){
     await branchExists(t,b);
     const fulfillment=body.fulfillment||'TABLE';isSafeStatus(fulfillment,['TABLE','DELIVERY','PICKUP']);
     const sid=body.tableSessionId||null;
     if(fulfillment==='TABLE'){
       const s=await checkSession(t,b,sid);
       if(s.status!=='OPEN')throw err(409,'Mesa indisponível.');
     }else if(sid)throw err(400,'Pedidos sem mesa não podem vincular comanda.');
     if(fulfillment==='DELIVERY'&&!clean(body.address,300))throw err(400,'Informe endereço de entrega.');
     if(body.customerId)await customer(t,body.customerId);
     const lines=await orderItems(t,b,body.items);
     const totals=calculateSaleTotals({items:lines});
     return mutate(t,'restaurant.order:'+b,key,async()=>{
       const id=uuid(),stamp=now(),result={id,status:'OPEN',fulfillment,tableSessionId:sid,totalCents:totals.totalCents,items:lines};
       const statements=[q(`INSERT INTO restaurant_orders(id,tenant_id,branch_id,table_session_id,customer_id,fulfillment,status,address,contact,note,total_cents,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
         id,t,b,sid,body.customerId||null,fulfillment,'OPEN',clean(body.address,300)||null,clean(body.contact,120)||null,clean(body.note,500)||null,totals.totalCents,user,stamp,stamp)];
       for(const l of lines)statements.push(q('INSERT INTO restaurant_order_items(id,tenant_id,branch_id,order_id,product_id,product_name,quantity_milli,unit_price_cents) VALUES(?,?,?,?,?,?,?,?)',uuid(),t,b,id,l.productId,l.name,l.milli,l.unitPriceCents));
       statements.push(q('INSERT INTO restaurant_kitchen_tickets(id,tenant_id,branch_id,order_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',uuid(),t,b,id,'NEW',stamp,stamp));
       return {statements,result};
     });
   },
   async kitchen(t,b){await branchExists(t,b);return all(`SELECT k.id,k.order_id AS orderId,k.status,o.fulfillment,o.total_cents AS totalCents,o.table_session_id AS tableSessionId,k.created_at AS createdAt FROM restaurant_kitchen_tickets k JOIN restaurant_orders o ON o.id=k.order_id AND o.tenant_id=k.tenant_id AND o.branch_id=k.branch_id WHERE k.tenant_id=? AND k.branch_id=? AND k.status<>'CANCELLED' ORDER BY k.created_at,k.id LIMIT 100`,t,b);},
   async updateKitchen(t,b,id,body,key){
     await branchExists(t,b);const status=body.status;isSafeStatus(status,['PREPARING','READY']);
     const current=await first('SELECT status FROM restaurant_kitchen_tickets WHERE tenant_id=? AND branch_id=? AND id=?',t,b,id);
     if(!current)throw err(404,'Ticket não encontrado.');
     if((current.status==='NEW'&&status!=='PREPARING')||(current.status==='PREPARING'&&status!=='READY')||current.status==='READY')throw err(409,'Transição da cozinha inválida.');
     return mutate(t,'restaurant.kitchen:'+id+':'+status,key,async()=>{
       const result={id,status};
       return {statements:[q('UPDATE restaurant_kitchen_tickets SET status=?,updated_at=? WHERE tenant_id=? AND branch_id=? AND id=? AND status=?',status,now(),t,b,id,current.status)],result};
     });
   },
   async wholesaleTiers(t,b){await branchExists(t,b);return all('SELECT id,product_id AS productId,min_quantity_milli / 1000.0 AS minQuantity,unit_price_cents AS unitPriceCents,active FROM wholesale_tiers WHERE tenant_id=? AND branch_id=? ORDER BY product_id,min_quantity_milli',t,b);},
   async saveWholesaleTier(t,b,body,key){
     await branchExists(t,b);await product(t,body.productId);const milli=qty(body.minQuantity),price=cents(body.unitPriceCents,'Preço');
     return mutate(t,'wholesale.tier:'+body.productId+':'+milli,key,async()=>{
       const id=uuid(),stamp=now(),result={id,productId:body.productId,minQuantity:milli/1000,unitPriceCents:price,active:true};
       return {statements:[q(`INSERT INTO wholesale_tiers(id,tenant_id,branch_id,product_id,min_quantity_milli,unit_price_cents,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
         ON CONFLICT(tenant_id,branch_id,product_id,min_quantity_milli) DO UPDATE SET unit_price_cents=excluded.unit_price_cents,active=1,updated_at=excluded.updated_at`,id,t,b,body.productId,milli,price,stamp,stamp)],result};
     });
   },
   async wholesalePrice(t,b,productId,quantity){await branchExists(t,b);return price(t,b,productId,quantity);},
   async wholesaleOrders(t,b){await branchExists(t,b);return all('SELECT id,customer_id AS customerId,status,total_cents AS totalCents,created_at AS createdAt FROM wholesale_orders WHERE tenant_id=? AND branch_id=? ORDER BY created_at DESC LIMIT 100',t,b);},
   wholesaleOrder:loadWholesale,
   async wholesaleQuote(t,b,user,body,key){
     await branchExists(t,b);const cust=await customer(t,body.customerId);
     if(!cust.active)throw err(409,'Cliente inativo.');
     if(!Array.isArray(body.items)||!body.items.length||body.items.length>80)throw err(400,'Informe os itens.');
     const seen=new Set(),lines=[];
     for(const item of body.items){
       if(seen.has(item.productId))throw err(400,'Agrupe produtos repetidos.');
       seen.add(item.productId);
       lines.push(await price(t,b,item.productId,item.quantity));
     }
     const totals=calculateSaleTotals({items:lines});
     const policy=await first('SELECT minimum_order_cents FROM wholesale_customer_policies WHERE tenant_id=? AND customer_id=? AND active=1',t,cust.id);
     if(totals.totalCents<(policy?.minimum_order_cents||0))throw err(409,'Pedido abaixo do valor mínimo do cliente.');
     const fulfill=body.fulfillmentType||'PICKUP';isSafeStatus(fulfill,['PICKUP','DELIVERY']);
     return mutate(t,'wholesale.quote:'+b,key,async()=>{
       const id=uuid(),stamp=now();
       const result={id,customerId:cust.id,status:'QUOTE',totalCents:totals.totalCents,fulfillmentType:fulfill,items:lines};
       const statements=[q('INSERT INTO wholesale_orders(id,tenant_id,branch_id,customer_id,status,total_cents,fulfillment,expected_at,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
         id,t,b,cust.id,'QUOTE',totals.totalCents,fulfill,clean(body.expectedAt,40)||null,user,stamp,stamp)];
       for(const line of lines)statements.push(q('INSERT INTO wholesale_order_items(id,tenant_id,branch_id,order_id,product_id,quantity_milli,unit_price_cents,tier_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',uuid(),t,b,id,line.productId,qty(line.quantity),line.unitPriceCents,line.tierId,stamp));
       return {statements,result};
     });
   },
   async wholesaleTransition(t,b,id,target,key){
     await branchExists(t,b);const row=await loadWholesale(t,b,id);
     const next={QUOTE:['CONFIRMED','CANCELLED'],CONFIRMED:['CANCELLED'],CANCELLED:[],FULFILLED:[]};
     if(!next[row.status].includes(target))throw err(409,'Transição de pedido inválida.');
     return mutate(t,'wholesale.status:'+id+':'+target,key,async()=>({statements:[q('UPDATE wholesale_orders SET status=?,updated_at=? WHERE tenant_id=? AND branch_id=? AND id=? AND status=?',target,now(),t,b,id,row.status)],result:{...row,status:target}}));
   },
   async commissionRules(t,b){await branchExists(t,b);return all('SELECT id,seller_id AS sellerId,product_id AS productId,commission_bps AS commissionBps,active FROM seller_commission_rules WHERE tenant_id=? ORDER BY seller_id,product_id',t);},
   async saveCommissionRule(t,b,body,key){
     await branchExists(t,b);await seller(t,body.sellerId);
     if(body.productId)await product(t,body.productId);
     const basis=Number(body.commissionBps);
     if(!Number.isInteger(basis)||basis<0||basis>10000)throw err(400,'Percentual inválido.');
     const productId=body.productId||null;
     const prev=await first('SELECT id FROM seller_commission_rules WHERE tenant_id=? AND seller_id=? AND product_id IS ?',t,body.sellerId,productId);
     return mutate(t,'commission.rule:'+body.sellerId+':'+(productId||'GLOBAL'),key,async()=>{
       const id=prev?.id||uuid(),stamp=now(),result={id,sellerId:body.sellerId,productId,commissionBps:basis,active:true};
       const sql=prev
         ?'UPDATE seller_commission_rules SET commission_bps=?,active=1,updated_at=? WHERE tenant_id=? AND id=?'
         :'INSERT INTO seller_commission_rules(id,tenant_id,seller_id,product_id,commission_bps,created_at,updated_at) VALUES(?,?,?,?,?,?,?)';
       return {statements:[prev?q(sql,basis,stamp,t,id):q(sql,id,t,body.sellerId,productId,basis,stamp,stamp)],result};
     });
   },
   async commissions(t,b){await branchExists(t,b);return all(`SELECT l.seller_id AS sellerId,u.display_name AS sellerName,COALESCE(SUM(l.amount_cents),0) AS balanceCents FROM seller_commission_ledger l JOIN users u ON u.id=l.seller_id WHERE l.tenant_id=? AND l.branch_id=? GROUP BY l.seller_id,u.display_name ORDER BY sellerName`,t,b);},
   async credit(t,b,customerId){await branchExists(t,b);const c=await customer(t,customerId);
     const ledger=await all('SELECT id,type,amount_cents AS amountCents,sale_id AS saleId,occurred_at AS occurredAt FROM customer_credit_ledger WHERE tenant_id=? AND branch_id=? AND customer_id=? ORDER BY occurred_at DESC LIMIT 100',t,b,customerId);
     const total=await first('SELECT COALESCE(SUM(amount_cents),0) AS total FROM customer_credit_ledger WHERE tenant_id=? AND customer_id=?',t,customerId);
     return {customerId,creditLimitCents:c.credit_limit_cents,balanceCents:total.total,availableCents:Math.max(0,c.credit_limit_cents-total.total),ledger};
   }
 };
}
