// R4 additive tenant+branch facade. Operational records are never a second cash/stock ledger.
const fail=(status,message)=>Object.assign(new Error(message),{status});
const stamp=()=>new Date().toISOString();
const id=()=>crypto.randomUUID();
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

export function createR4ExtendedService(db){
 const q=(sql,...args)=>db.prepare(sql).bind(...args);
 const first=(sql,...args)=>q(sql,...args).first();
 const all=async(sql,...args)=>(await q(sql,...args).all()).results;
 async function branch(t,b){
   if(!b||!(await first('SELECT id FROM branches WHERE tenant_id=? AND id=? AND active=1',t,b)))
     throw fail(404,'Filial não encontrada.');
 }
 async function product(t,id){
   const row=await first('SELECT id,name,sku,unit,sale_price_cents,track_stock FROM products WHERE tenant_id=? AND id=? AND active=1',t,id);
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
     return Promise.all(rows.map(async row=>({...row,items:await all(`SELECT oi.product_id AS productId,oi.product_name AS productName,
       oi.quantity_milli / 1000.0 AS quantity FROM restaurant_order_items oi
       JOIN r4_product_kitchen_routes r ON r.tenant_id=oi.tenant_id AND r.branch_id=oi.branch_id
         AND r.product_id=oi.product_id AND r.station_id=?
       WHERE oi.tenant_id=? AND oi.branch_id=? AND oi.order_id=?`,row.stationId,t,b,row.orderId)})));
   },
   async updateTicket(t,b,ticketId,status,key){
     await branch(t,b);
     if(!['PREPARING','READY'].includes(status))throw fail(400,'Estado de produção inválido.');
     const scope='r4.ticket:'+b+':'+ticketId+':'+status;
     if(keyValid(key)){
       const old=await first('SELECT result_json FROM commerce_mutations WHERE tenant_id=? AND scope=? AND mutation_id=?',t,scope,key);
       if(old)return JSON.parse(old.result_json);
     }
     const current=await first('SELECT id,order_id AS orderId,status FROM r4_station_tickets WHERE tenant_id=? AND branch_id=? AND id=?',t,b,ticketId);
     if(!current)throw fail(404,'Ticket não encontrado.');
     if((current.status==='NEW'&&status!=='PREPARING')||
        (current.status==='PREPARING'&&status!=='READY')||current.status==='READY'||current.status==='CANCELLED')
        throw fail(409,'Transição de produção inválida.');
     return mutation(t,scope,key,async()=>{
       const time=stamp(),out={id:ticketId,orderId:current.orderId,status};
       const statements=[q('UPDATE r4_station_tickets SET status=?,updated_at=? WHERE tenant_id=? AND branch_id=? AND id=? AND status=?',
         status,time,t,b,ticketId,current.status),
         q(`UPDATE restaurant_kitchen_tickets SET status=
           CASE WHEN NOT EXISTS (SELECT 1 FROM r4_station_tickets x WHERE x.tenant_id=? AND x.branch_id=?
               AND x.order_id=? AND x.status<>'READY') THEN 'READY' ELSE 'PREPARING' END, updated_at=?
             WHERE tenant_id=? AND branch_id=? AND order_id=? AND status IN('NEW','PREPARING')`,
           t,b,current.orderId,time,t,b,current.orderId),
         q(`UPDATE restaurant_orders SET status='READY',updated_at=? WHERE tenant_id=? AND branch_id=? AND id=? AND status='OPEN'
          AND EXISTS(SELECT 1 FROM restaurant_kitchen_tickets k WHERE k.tenant_id=? AND k.branch_id=? AND k.order_id=? AND k.status='READY')`,
           time,t,b,current.orderId,t,b,current.orderId)];
       return {result:out,statements};
     });
   },
   async pizzaProfiles(t,b){
     await branch(t,b);
     return all('SELECT product_id AS productId,pricing_policy AS policy,max_flavors AS maxFlavors FROM r4_pizza_profiles WHERE tenant_id=? AND branch_id=? ORDER BY product_id',t,b);
   },
   async pizzaProfile(t,b,productId){
     await branch(t,b);await product(t,productId);
     const profile=await first('SELECT product_id AS productId,pricing_policy AS policy,max_flavors AS maxFlavors FROM r4_pizza_profiles WHERE tenant_id=? AND branch_id=? AND product_id=?',t,b,productId);
     if(!profile)return null;
     const entries=await all('SELECT kind,code,name,price_cents AS priceCents FROM r4_pizza_options WHERE tenant_id=? AND branch_id=? AND product_id=? ORDER BY kind,code',t,b,productId);
     return {...profile,sizes:entries.filter(x=>x.kind==='SIZE'),flavors:entries.filter(x=>x.kind==='FLAVOR'),crusts:entries.filter(x=>x.kind==='CRUST')};
   },
   async savePizzaProfile(t,b,body,key){
     await branch(t,b);const p=await product(t,body.productId);
     const policy=label(body.policy).toUpperCase();
     if(!['HIGHEST_FLAVOR','PROPORTIONAL_AVERAGE'].includes(policy))throw fail(400,'Política de preço inválida.');
     const maxFlavors=integer(body.maxFlavors??4,1,8,'Limite de sabores');
     const sizes=options(body.sizes,'SIZE',true),flavors=options(body.flavors,'FLAVOR',true),crusts=options(body.crusts??[],'CRUST',false);
     return mutation(t,'r4.pizza.profile:'+b+':'+p.id,key,async()=>{
       const entries=[...sizes,...flavors,...crusts];
       return {result:{productId:p.id,policy,maxFlavors,sizes,flavors,crusts},statements:[
         q(`INSERT INTO r4_pizza_profiles(tenant_id,branch_id,product_id,pricing_policy,max_flavors,updated_at)
          VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,branch_id,product_id) DO UPDATE SET
          pricing_policy=excluded.pricing_policy,max_flavors=excluded.max_flavors,updated_at=excluded.updated_at`,
          t,b,p.id,policy,maxFlavors,stamp()),
         q('DELETE FROM r4_pizza_options WHERE tenant_id=? AND branch_id=? AND product_id=?',t,b,p.id),
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
     const flavorCents=p.policy==='HIGHEST_FLAVOR'?Math.max(...flavors.map(x=>x.priceCents)):
       Math.round(flavors.reduce((sum,x)=>sum+x.priceCents,0)/flavors.length);
     const unitPriceCents=integer(Math.max(size.priceCents,flavorCents)+(crust?.priceCents||0),0,1_000_000_000,'Preço final');
     return {productId:p.productId,policy:p.policy,unitPriceCents,configuration:{
       size:{code:size.code,name:size.name},flavors:flavors.map(x=>({code:x.code,name:x.name})),
       crust:crust?{code:crust.code,name:crust.name}:null}};
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
   async recipe(t,b,productId){
     await branch(t,b);await product(t,productId);
     const row=await first('SELECT MAX(version) AS version FROM r4_recipe_versions WHERE tenant_id=? AND branch_id=? AND product_id=?',t,b,productId);
     if(!row?.version)return null;
     const items=await all(`SELECT r.ingredient_id AS ingredientId,p.name AS ingredientName,r.quantity_milli / 1000.0 AS quantity
        FROM r4_recipe_ingredients r JOIN products p ON p.id=r.ingredient_id AND p.tenant_id=r.tenant_id
        WHERE r.tenant_id=? AND r.branch_id=? AND r.product_id=? AND r.version=? ORDER BY p.name`,
        t,b,productId,row.version);
     return {productId,version:row.version,ingredients:items};
   },
   async saveRecipe(t,b,productId,body,key){
     await branch(t,b);const p=await product(t,productId);
     if(p.track_stock)throw fail(409,'Produto com receita deve ter estoque próprio desativado para evitar débito duplo.');
     if(!Array.isArray(body.ingredients)||!body.ingredients.length||body.ingredients.length>40)throw fail(400,'Ingredientes inválidos.');
     const ingredients=[],seen=new Set();
     for(const row of body.ingredients){
       const ingredient=await product(t,row.ingredientId);
       if(ingredient.id===p.id||seen.has(ingredient.id)||!ingredient.track_stock)throw fail(400,'Ingrediente repetido ou sem estoque.');
       const milli=integer(Math.round(row.quantity*1000),1,100000000,'Quantidade de insumo');
       if(Math.abs(row.quantity*1000-milli)>0.000001)throw fail(400,'Use até três casas decimais.');
       seen.add(ingredient.id);ingredients.push({ingredientId:ingredient.id,quantity:milli/1000,milli});
     }
     return mutation(t,'r4.recipe:'+b+':'+productId,key,async()=>{
       const prior=await first('SELECT MAX(version) AS version FROM r4_recipe_versions WHERE tenant_id=? AND branch_id=? AND product_id=?',t,b,productId);
       const version=(prior?.version||0)+1;
       const statements=[q('INSERT INTO r4_recipe_versions(tenant_id,branch_id,product_id,version,created_at) VALUES(?,?,?,?,?)',t,b,productId,version,stamp()),
         ...ingredients.map(x=>q('INSERT INTO r4_recipe_ingredients(tenant_id,branch_id,product_id,version,ingredient_id,quantity_milli) VALUES(?,?,?,?,?,?)',t,b,productId,version,x.ingredientId,x.milli))];
       return {result:{productId,version,ingredients:ingredients.map(({milli,...x})=>x)},statements};
     });
   }
 };
 return result;
}
