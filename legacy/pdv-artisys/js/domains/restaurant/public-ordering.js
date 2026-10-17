'use strict';

const {randomBytes}=require('node:crypto');
const {writeAudit}=require('../../core/audit-log');

const PUBLIC_ROLE='public-table-ordering';
const TOKEN_RE=/^[A-Za-z0-9_-]{20,64}$/;
const MENU_LAYOUTS=Object.freeze({COMPACT:'COMPACT',PREMIUM:'PREMIUM'});
const MENU_LAYOUT_VALUES=new Set(Object.values(MENU_LAYOUTS));

function createPublicOrderingService({db,modules,catalog,catalogCustomization,configuredItemPricing=null,restaurant,productPhotos,now=()=>new Date().toISOString(),tokenFactory=()=>randomBytes(18).toString('base64url')}={}){
  if(!db||!modules||!catalog||!catalogCustomization||!restaurant)throw new TypeError('public ordering dependencies are required.');

  db.exec(`
    CREATE TABLE IF NOT EXISTS restaurant_public_ordering_config (
      id TEXT PRIMARY KEY,
      auto_open_table INTEGER NOT NULL DEFAULT 1 CHECK(auto_open_table IN(0,1)),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS restaurant_table_qr_access (
      table_id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(table_id) REFERENCES restaurant_tables(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS restaurant_public_menu_products (
      product_id TEXT PRIMARY KEY,
      description TEXT,
      visible INTEGER NOT NULL DEFAULT 1 CHECK(visible IN(0,1)),
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    );
  `);
  const configColumns=new Set(db.prepare('PRAGMA table_info(restaurant_public_ordering_config)').all().map(row=>row.name));
  if(!configColumns.has('menu_layout'))db.exec("ALTER TABLE restaurant_public_ordering_config ADD COLUMN menu_layout TEXT NOT NULL DEFAULT 'COMPACT'");
  db.prepare(`INSERT OR IGNORE INTO restaurant_public_ordering_config(id,auto_open_table,menu_layout,updated_at) VALUES('default',1,'COMPACT',?)`).run(now());

  const gate=()=>modules.requireEnabled('FOOD');
  const publicActor=()=>({userId:null,role:PUBLIC_ROLE,terminalId:null});

  function normalizeMenuLayout(value){const layout=String(value||MENU_LAYOUTS.COMPACT).trim().toUpperCase();if(!MENU_LAYOUT_VALUES.has(layout))throw new Error('Layout de aparência do cardápio inválido.');return layout;}
  function getConfig(){gate();const row=db.prepare("SELECT * FROM restaurant_public_ordering_config WHERE id='default'").get();return{autoOpenTable:Boolean(row?.auto_open_table),menuLayout:normalizeMenuLayout(row?.menu_layout),updatedAt:row?.updated_at||null};}
  function updateConfig(input={},actor={}){gate();const current=getConfig();const autoOpenTable=input.autoOpenTable===undefined?current.autoOpenTable:input.autoOpenTable!==false;const menuLayout=input.menuLayout===undefined?current.menuLayout:normalizeMenuLayout(input.menuLayout);const timestamp=now();db.prepare("UPDATE restaurant_public_ordering_config SET auto_open_table=?,menu_layout=?,updated_at=? WHERE id='default'").run(autoOpenTable?1:0,menuLayout,timestamp);writeAudit(db,{action:'restaurant.public-ordering.config',entity:'restaurant_public_ordering',entityId:'default',actor,context:{autoOpenTable,menuLayout}},now);return getConfig();}
  function requireTable(tableId){gate();const table=restaurant.getTable(String(tableId));if(!table||table.active===false)throw new Error('Mesa nao encontrada ou inativa.');return table;}
  function accessForTable(tableId){const row=db.prepare('SELECT * FROM restaurant_table_qr_access WHERE table_id=?').get(String(tableId));return row?{tableId:row.table_id,token:row.access_token,createdAt:row.created_at,updatedAt:row.updated_at}:null;}
  function nextToken(){let token='';for(let attempt=0;attempt<5;attempt+=1){token=String(tokenFactory());if(!TOKEN_RE.test(token))throw new Error('Token publico invalido.');if(!db.prepare('SELECT 1 FROM restaurant_table_qr_access WHERE access_token=?').get(token))return token;}throw new Error('Nao foi possivel gerar o acesso da mesa.');}
  function issueTableAccess(tableId,actor={}){const table=requireTable(tableId);const current=accessForTable(table.id);if(current)return current;const timestamp=now();const token=nextToken();db.prepare('INSERT INTO restaurant_table_qr_access(table_id,access_token,created_at,updated_at) VALUES(?,?,?,?)').run(table.id,token,timestamp,timestamp);writeAudit(db,{action:'restaurant.table.public-access.create',entity:'restaurant_table',entityId:table.id,actor,context:{}},now);return accessForTable(table.id);}
  function rotateTableAccess(tableId,actor={}){const table=requireTable(tableId);const timestamp=now();const token=nextToken();db.prepare(`INSERT INTO restaurant_table_qr_access(table_id,access_token,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(table_id) DO UPDATE SET access_token=excluded.access_token,updated_at=excluded.updated_at`).run(table.id,token,timestamp,timestamp);writeAudit(db,{action:'restaurant.table.public-access.rotate',entity:'restaurant_table',entityId:table.id,actor,context:{}},now);return accessForTable(table.id);}
  function resolveToken(token){gate();const value=String(token||'').trim();if(!TOKEN_RE.test(value))throw new Error('QR da mesa invalido.');const row=db.prepare(`SELECT a.table_id,t.label,t.active FROM restaurant_table_qr_access a JOIN restaurant_tables t ON t.id=a.table_id WHERE a.access_token=?`).get(value);if(!row||!row.active)throw new Error('Este QR nao esta ativo.');return{id:row.table_id,label:row.label};}
  function menuMeta(productId){const row=db.prepare('SELECT * FROM restaurant_public_menu_products WHERE product_id=?').get(String(productId));return row?{description:row.description||'',visible:Boolean(row.visible),sortOrder:row.sort_order,updatedAt:row.updated_at}:{description:'',visible:true,sortOrder:0,updatedAt:null};}
  function sanitizeConfiguration(productId){
    let config;try{config=configuredItemPricing?.configuration?configuredItemPricing.configuration(productId):catalogCustomization.getProductConfiguration(productId);}catch{return{groups:[],variants:[],combos:[],pizza:null};}
    const pizza=config.pizza?{
      productId:config.pizza.productId,
      pricingPolicy:config.pizza.pricingPolicy,
      sizes:(config.pizza.sizes||[]).map(item=>({id:item.id,name:item.name,maxFlavors:item.maxFlavors,priceDeltaCents:item.priceDeltaCents})),
      flavors:(config.pizza.flavors||[]).map(item=>({id:item.id,name:item.name,priceDeltaCents:item.priceDeltaCents})),
      crusts:(config.pizza.crusts||[]).map(item=>({id:item.id,name:item.name,priceDeltaCents:item.priceDeltaCents}))
    }:null;
    return{groups:(config.groups||[]).map(group=>({id:group.id,name:group.name,selectionType:group.selectionType,minSelections:group.minSelections,maxSelections:group.maxSelections,required:Boolean(group.required),sortOrder:group.sortOrder,options:(group.options||[]).map(option=>({id:option.id,name:option.name,priceDeltaCents:option.priceDeltaCents}))})),variants:(config.variants||[]).map(variant=>({id:variant.id,name:variant.name,attributes:variant.attributes||{},priceDeltaCents:variant.priceDeltaCents})),combos:(config.combos||[]).map(group=>({id:group.id,name:group.name,minSelections:group.minSelections,maxSelections:group.maxSelections,sortOrder:group.sortOrder,items:(group.items||[]).map(item=>({productId:item.productId,productName:item.productName,quantity:item.quantity,priceDeltaCents:item.priceDeltaCents}))})),pizza};
  }
  function productProjection(product,{includeHidden=false}={}){if(!product.menuEnabled)return null;const meta=menuMeta(product.id);if(!includeHidden&&!meta.visible)return null;const available=product.active!==false&&(!product.trackStock||Number(product.stockQuantity||0)>0);const photo=productPhotos?.get?.(product.id)||null;return{id:product.id,name:product.name,categoryId:product.categoryId,categoryName:product.categoryName||'Outros',description:meta.description,salePriceCents:product.salePriceCents,available,visible:meta.visible,sortOrder:meta.sortOrder,photo:photo?{version:photo.version}:null,configuration:sanitizeConfiguration(product.id)};}
  function listMenu({includeHidden=false}={}){gate();return catalog.listProducts({includeInactive:Boolean(includeHidden)}).map(product=>productProjection(product,{includeHidden})).filter(Boolean).sort((a,b)=>a.sortOrder-b.sortOrder||String(a.categoryName).localeCompare(String(b.categoryName),'pt-BR')||String(a.name).localeCompare(String(b.name),'pt-BR'));}
  function updateMenuProduct(productId,input={},actor={}){gate();const product=catalog.getProduct(String(productId));if(!product||!product.menuEnabled)throw new Error('Item nao esta no Cardapio.');const current=menuMeta(product.id);const description=String(input.description??current.description).trim().slice(0,500)||null;const visible=input.visible===undefined?current.visible:Boolean(input.visible);const sortOrder=Number.isFinite(Number(input.sortOrder))?Math.trunc(Number(input.sortOrder)):current.sortOrder;const timestamp=now();db.prepare(`INSERT INTO restaurant_public_menu_products(product_id,description,visible,sort_order,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET description=excluded.description,visible=excluded.visible,sort_order=excluded.sort_order,updated_at=excluded.updated_at`).run(product.id,description,visible?1:0,sortOrder,timestamp);writeAudit(db,{action:'restaurant.public-menu.update',entity:'product',entityId:product.id,actor,context:{visible,sortOrder}},now);return productProjection(catalog.getProduct(product.id),{includeHidden:true});}
  function safeOrder(order){return{id:order.id,status:order.status,totalCents:order.totalCents,createdAt:order.createdAt,items:(order.items||[]).map(item=>({productId:item.productId,productName:item.productName,quantity:item.quantity,unitPriceCents:item.unitPriceCents,totalCents:item.totalCents,configuration:item.configuration||null,note:item.note||null}))};}
  function safeSession(session){if(!session)return null;return{status:session.status,totalCents:session.totalCents,openedAt:session.openedAt,orders:(session.orders||[]).filter(order=>order.status!=='CANCELLED').map(safeOrder)};}
  function publicContext(token){const table=resolveToken(token);const products=listMenu();const session=restaurant.currentSession(table.id);const categories=[...new Set(products.map(product=>product.categoryName).filter(Boolean))];const config=getConfig();return{table:{label:table.label},session:safeSession(session),products,categories,config:{autoOpenTable:config.autoOpenTable,menuLayout:config.menuLayout}};}
  function requireVisibleAvailableProduct(productId){const product=catalog.getProduct(String(productId));if(!product||product.active===false||!product.menuEnabled)throw new Error('Produto nao encontrado ou indisponivel.');const projected=productProjection(product);if(!projected||!projected.available)throw new Error(`${product.name} esta indisponivel no momento.`);return product;}
  function priceItem(input={}){
    const product=requireVisibleAvailableProduct(input.productId);
    // Zero-base products may be configured as a priced choice. Do not silently
    // sell an unselected variation as a free/extra line in public orders.
    const hasChoice=Boolean(input.variantId||(Array.isArray(input.selections)&&input.selections.length)||(Array.isArray(input.comboSelections)&&input.comboSelections.length));
    if(Number(product.salePriceCents||0)===0&&!hasChoice){
      const config=catalogCustomization.getProductConfiguration(product.id);
      const paidVariants=(config.variants||[]).some(row=>Number(row.priceDeltaCents)>0);
      const paidOptions=(config.groups||[]).some(group=>(group.options||[]).some(row=>Number(row.priceDeltaCents)>0));
      if(paidVariants||paidOptions)throw new Error(`Escolha uma variação ou adicional para "${product.name}" antes de enviar. O item não pode entrar sem preço.`);
    }
    if(configuredItemPricing?.price)return configuredItemPricing.price({...input,productId:product.id});
    const pricing=catalogCustomization.priceConfiguredItem({productId:product.id,variantId:input.variantId||undefined,selections:Array.isArray(input.selections)?input.selections:[],comboSelections:Array.isArray(input.comboSelections)?input.comboSelections:[]});return{productId:product.id,quantity:input.quantity??1,unitPriceCents:pricing.unitPriceCents,configurationSnapshot:pricing.configurationSnapshot,note:String(input.note||'').trim().slice(0,500)};}
  function submitOrder(token,input={},mutationId=null){const table=resolveToken(token);const items=Array.isArray(input.items)?input.items:[];if(!items.length)throw new Error('Adicione itens ao pedido.');if(items.length>100)throw new Error('Pedido excede o limite de itens.');let session=restaurant.currentSession(table.id);if(!session){if(!getConfig().autoOpenTable)throw new Error('Mesa sem comanda aberta. Chame o garcom.');session=restaurant.openTable(table.id,{operatorId:null,actor:publicActor(),mutationId});}const order=restaurant.addOrder(session.id,{items:items.map(priceItem),note:String(input.note||'').trim().slice(0,1000),source:'TABLE',deviceId:null,actor:publicActor(),mutationId});writeAudit(db,{action:'restaurant.public-ordering.order',entity:'restaurant_order',entityId:order.id,actor:publicActor(),context:{tableId:table.id}},now);return safeOrder(order);}
  function requestService(token,requestType,mutationId=null){const table=resolveToken(token);const type=String(requestType||'').toUpperCase();if(!['WAITER','BILL'].includes(type))throw new Error('Tipo de solicitacao invalido.');let session=restaurant.currentSession(table.id);if(!session&&type==='WAITER')session=restaurant.openTable(table.id,{operatorId:null,actor:publicActor(),mutationId});if(!session)throw new Error('Mesa sem comanda aberta.');return restaurant.requestService(table.id,type,{actor:publicActor(),mutationId});}
  function canReadPhoto(token,productId){resolveToken(token);const product=catalog.getProduct(String(productId));return Boolean(product&&productProjection(product));}
  return{getConfig,updateConfig,issueTableAccess,rotateTableAccess,resolveToken,listMenu,updateMenuProduct,publicContext,priceMenuItem:priceItem,submitOrder,requestService,canReadPhoto};
}

module.exports={createPublicOrderingService,PUBLIC_ROLE,TOKEN_RE,MENU_LAYOUTS};
