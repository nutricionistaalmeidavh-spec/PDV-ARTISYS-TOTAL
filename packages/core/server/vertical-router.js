'use strict';
const {statusForError}=require('./http-error-status');

class VerticalHttpError extends Error{constructor(statusCode,message){super(message);this.statusCode=statusCode;}}
function json(response,statusCode,payload){response.writeHead(statusCode,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(payload));}
async function body(request,limit=1024*1024){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>limit)throw new VerticalHttpError(413,'Corpo da requisicao excede o limite permitido.');chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new VerticalHttpError(400,'JSON invalido.');}}
function bearer(request){const value=String(request.headers.authorization||'');return value.startsWith('Bearer ')?value.slice(7).trim():'';}

function createVerticalRouter({runtime,installationToken='',requireTerminalAuth=false,sessionStore=null}={}){
  if(!runtime)throw new TypeError('runtime is required.');
  const sessions=sessionStore||null;
  function principal(request){
    if(sessions){
      const token=bearer(request);const session=sessions.get(token);
      if(!session||session.expiresAt<=Date.now()){if(token)sessions.delete(token);throw new VerticalHttpError(401,'Sessao invalida ou expirada.');}
      if(runtime.catalog?.getUser){const user=runtime.catalog.getUser(session.userId);if(!user||!user.active){sessions.delete(token);throw new VerticalHttpError(401,'Sessao invalida ou expirada.');}session.name=user.name;}
      if(requireTerminalAuth){const terminal=runtime.terminals.listTerminals().find(item=>item.terminalId===session.terminalId);if(!terminal||terminal.status!=='ACTIVE')throw new VerticalHttpError(401,'Terminal nao autorizado.');}
      return{actor:{kind:'human',userId:session.userId,terminalId:session.terminalId||null},principal:{kind:'human',id:session.userId},terminalId:session.terminalId||null};
    }
    if(requireTerminalAuth){const id=String(request.headers['x-terminal-id']||'').trim();const key=String(request.headers['x-terminal-key']||'');const auth=runtime.terminals.authenticateTerminal(id,key);if(!auth.ok)throw new VerticalHttpError(401,'Terminal nao autorizado.');return{actor:{kind:'device',id,surface:'terminal',terminalId:id},principal:{kind:'device',id,surface:'terminal'},terminalId:id};}
    if(installationToken&&request.headers['x-pdv-token']!==installationToken)throw new VerticalHttpError(401,'Token local invalido.');
    return{actor:{kind:'system',userId:null,terminalId:null},principal:{kind:'system',id:'system'},terminalId:null};
  }
  function requireCapability(actor,capability){const principal=actor?.kind==='human'?{kind:'human',id:actor.userId}:actor;try{return runtime.authorization.require({principal,capability});}catch(error){throw new VerticalHttpError(error.statusCode||403,error.message||'Permissao insuficiente.');}}
  function requireCapabilities(actor,...capabilities){for(const capability of capabilities)requireCapability(actor,capability);return true;}
  function requireOneOfCapabilities(actor,capabilities){
    for(const capability of capabilities){try{requireCapability(actor,capability);return true;}catch(error){if(error.statusCode!==403)throw error;}}
    throw new VerticalHttpError(403,'Permissao insuficiente para configurar itens do pedido.');
  }
  function moduleRule(moduleId,actor,manage=false){
    const method=manage?'requireManage':'requireAccess';
    if(typeof runtime.modules?.[method]==='function')return runtime.modules[method](moduleId,actor);
    return requireCapability(actor,manage?'modules.manage':(moduleId==='FOOD'?'restaurant.access':'wholesale.access'));
  }
  async function mutate(request,pathname,statusCode,handler){const mutationId=String(request.headers['x-mutation-id']||'').trim();if(!mutationId||!runtime.mutations)return{statusCode,payload:await handler(mutationId||null)};return runtime.mutations.execute({mutationId,method:request.method,path:pathname},async()=>({statusCode,payload:await handler(mutationId)}));}
  return async function verticalRouter(request,response){
    const url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`);const pathname=url.pathname;if(!pathname.startsWith('/api/v1/vertical/'))return false;
    try{
      const p=principal(request);const actor=p.actor;
      if(request.method==='GET'&&pathname==='/api/v1/vertical/modules'){json(response,200,runtime.modules.list());return true;}

      if(request.method==='POST'&&pathname==='/api/v1/vertical/catalog/option-groups'){requireCapability(actor,'products.manage');json(response,201,runtime.catalogCustomization.upsertOptionGroup(await body(request),actor));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/catalog/options'){requireCapability(actor,'products.manage');json(response,201,runtime.catalogCustomization.upsertOption(await body(request),actor));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/catalog/variants'){requireCapability(actor,'products.manage');json(response,201,runtime.catalogCustomization.upsertVariant(await body(request),actor));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/catalog/combo-groups'){requireCapability(actor,'products.manage');json(response,201,runtime.catalogCustomization.upsertComboGroup(await body(request),actor));return true;}
      const linkGroup=pathname.match(/^\/api\/v1\/vertical\/catalog\/products\/([^/]+)\/option-groups\/([^/]+)$/);
      if(request.method==='PUT'&&linkGroup){requireCapability(actor,'products.manage');json(response,200,runtime.catalogCustomization.linkGroupToProduct(decodeURIComponent(linkGroup[1]),decodeURIComponent(linkGroup[2]),await body(request),actor));return true;}
      const comboItem=pathname.match(/^\/api\/v1\/vertical\/catalog\/combo-groups\/([^/]+)\/items$/);
      if(request.method==='POST'&&comboItem){requireCapability(actor,'products.manage');json(response,201,runtime.catalogCustomization.upsertComboItem(decodeURIComponent(comboItem[1]),await body(request),actor));return true;}
      const productConfig=pathname.match(/^\/api\/v1\/vertical\/catalog\/products\/([^/]+)\/configuration$/);
      if(request.method==='GET'&&productConfig){requireOneOfCapabilities(actor,['products.manage','sales.create','restaurant.orders.create']);const productId=decodeURIComponent(productConfig[1]);json(response,200,runtime.configuredItemPricing?.configuration?runtime.configuredItemPricing.configuration(productId):runtime.catalogCustomization.getProductConfiguration(productId));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/catalog/price'){requireOneOfCapabilities(actor,['products.manage','sales.create','restaurant.orders.create']);const data=await body(request);json(response,200,runtime.configuredItemPricing?.price?runtime.configuredItemPricing.price(data):runtime.catalogCustomization.priceConfiguredItem(data));return true;}

      const recipe=pathname.match(/^\/api\/v1\/vertical\/recipes\/([^/]+)$/);
      if(request.method==='GET'&&recipe){requireCapability(actor,'products.manage');const value=runtime.recipes.getRecipe(decodeURIComponent(recipe[1]));if(!value)throw new VerticalHttpError(404,'Ficha tecnica nao encontrada.');json(response,200,value);return true;}
      if(request.method==='PUT'&&recipe){requireCapability(actor,'products.manage');json(response,200,runtime.recipes.setRecipe(decodeURIComponent(recipe[1]),await body(request),actor));return true;}

      if(request.method==='POST'&&pathname==='/api/v1/vertical/pizzeria/profile'){moduleRule('FOOD',actor);requireCapability(actor,'products.manage');json(response,201,runtime.pizzeria.upsertProfile(await body(request),actor));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/pizzeria/catalog'){moduleRule('FOOD',actor);requireCapability(actor,'products.manage');const data=await body(request);let value;if(data.kind==='size')value=runtime.pizzeria.upsertSize(data,actor);else if(data.kind==='flavor')value=runtime.pizzeria.upsertFlavor(data,actor);else if(data.kind==='crust')value=runtime.pizzeria.upsertCrust(data,actor);else throw new VerticalHttpError(400,'Tipo de cadastro de pizzaria invalido.');json(response,201,value);return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/pizzeria/price'){moduleRule('FOOD',actor);json(response,200,runtime.pizzeria.pricePizza(await body(request)));return true;}
      const pizzaProfile=pathname.match(/^\/api\/v1\/vertical\/pizzeria\/products\/([^/]+)$/);
      if(request.method==='GET'&&pizzaProfile){moduleRule('FOOD',actor);const value=runtime.pizzeria.getProfile(decodeURIComponent(pizzaProfile[1]));if(!value)throw new VerticalHttpError(404,'Perfil de pizzaria nao encontrado.');json(response,200,value);return true;}

      const configuredSale=pathname.match(/^\/api\/v1\/vertical\/sales\/([^/]+)\/configured-item$/);
      if(request.method==='POST'&&configuredSale){requireCapability(actor,'sales.create');const data=await body(request);const priced=runtime.configuredItemPricing?.price?runtime.configuredItemPricing.price(data):data;json(response,200,runtime.sales.addItem(decodeURIComponent(configuredSale[1]),{...priced,forceSeparateLine:true}));return true;}

      const settlement=pathname.match(/^\/api\/v1\/vertical\/restaurant\/sessions\/([^/]+)\/settlements$/);
      if(request.method==='POST'&&settlement){moduleRule('FOOD',actor);requireCapabilities(actor,'restaurant.orders.create','sales.create');const data=await body(request);const terminalId=data.terminalId||p.terminalId;if(!terminalId)throw new VerticalHttpError(400,'Terminal obrigatorio.');json(response,201,runtime.restaurantSettlement.createItemSettlement(decodeURIComponent(settlement[1]),{...data,terminalId},actor));return true;}
      const equalSettlement=pathname.match(/^\/api\/v1\/vertical\/restaurant\/sessions\/([^/]+)\/settlements\/equal$/);
      if(request.method==='POST'&&equalSettlement){moduleRule('FOOD',actor);requireCapabilities(actor,'restaurant.orders.create','sales.create');const data=await body(request);const terminalId=data.terminalId||p.terminalId;if(!terminalId)throw new VerticalHttpError(400,'Terminal obrigatorio.');json(response,201,runtime.restaurantSettlement.createEqualSettlement(decodeURIComponent(equalSettlement[1]),{...data,terminalId},actor));return true;}
      const remaining=pathname.match(/^\/api\/v1\/vertical\/restaurant\/sessions\/([^/]+)\/remaining$/);
      if(request.method==='GET'&&remaining){moduleRule('FOOD',actor);json(response,200,runtime.restaurantSettlement.getRemainingBalance(decodeURIComponent(remaining[1])));return true;}
      const completeSettlement=pathname.match(/^\/api\/v1\/vertical\/restaurant\/settlements\/([^/]+)\/complete$/);
      if(request.method==='POST'&&completeSettlement){moduleRule('FOOD',actor);requireCapabilities(actor,'restaurant.orders.create','sales.create');json(response,200,runtime.restaurantSettlement.completeSettlement(decodeURIComponent(completeSettlement[1]),await body(request),actor));return true;}
      const cancelOrderItem=pathname.match(/^\/api\/v1\/vertical\/restaurant\/order-items\/([^/]+)\/cancel$/);
      if(request.method==='POST'&&cancelOrderItem){moduleRule('FOOD',actor);requireCapability(actor,'restaurant.orders.cancel');const data=await body(request);json(response,200,runtime.restaurantSettlement.cancelOrderItem(decodeURIComponent(cancelOrderItem[1]),data.reason,actor));return true;}
      const mergeSessions=pathname.match(/^\/api\/v1\/vertical\/restaurant\/sessions\/([^/]+)\/merge$/);
      if(request.method==='POST'&&mergeSessions){moduleRule('FOOD',actor);requireCapability(actor,'restaurant.orders.transfer');const data=await body(request);json(response,200,runtime.restaurantSettlement.mergeSessions(decodeURIComponent(mergeSessions[1]),data.targetSessionId,actor));return true;}
      const transferItems=pathname.match(/^\/api\/v1\/vertical\/restaurant\/sessions\/([^/]+)\/transfer-items$/);
      if(request.method==='POST'&&transferItems){moduleRule('FOOD',actor);requireCapability(actor,'restaurant.orders.transfer');const data=await body(request);json(response,200,runtime.restaurantSettlement.transferItems(decodeURIComponent(transferItems[1]),data.targetSessionId,data.items||[],actor));return true;}

      if(request.method==='GET'&&pathname==='/api/v1/vertical/food/orders'){moduleRule('FOOD',actor);let legacyOrders=[];try{legacyOrders=runtime.fastFood?.list?.({})||[];}catch{}json(response,200,{orders:runtime.delivery.list({}),legacyOrders});return true;}
      const legacyFoodStatus=pathname.match(/^\/api\/v1\/vertical\/food\/legacy-orders\/([^/]+)\/status$/);
      if(request.method==='PATCH'&&legacyFoodStatus){moduleRule('FOOD',actor);const data=await body(request);json(response,200,runtime.fastFood.updateStatus(decodeURIComponent(legacyFoodStatus[1]),data.status,actor));return true;}
      if(request.method==='GET'&&pathname==='/api/v1/vertical/delivery'){moduleRule('FOOD',actor);json(response,200,runtime.delivery.list({status:url.searchParams.get('status')||null,fulfillmentType:url.searchParams.get('fulfillmentType')||null}));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/delivery'){moduleRule('FOOD',actor);requireCapability(actor,'restaurant.orders.create');const data=await body(request);const result=await mutate(request,pathname,201,()=>runtime.delivery.create(data,actor));json(response,result.statusCode,result.payload);return true;}
      const deliveryStatus=pathname.match(/^\/api\/v1\/vertical\/delivery\/([^/]+)\/status$/);
      if(request.method==='PATCH'&&deliveryStatus){moduleRule('FOOD',actor);requireCapability(actor,'restaurant.orders.create');const data=await body(request);json(response,200,runtime.delivery.updateStatus(decodeURIComponent(deliveryStatus[1]),data.status,actor));return true;}
      const deliveryCancel=pathname.match(/^\/api\/v1\/vertical\/delivery\/([^/]+)\/cancel$/);
      if(request.method==='POST'&&deliveryCancel){moduleRule('FOOD',actor);requireCapability(actor,'restaurant.orders.cancel');const data=await body(request);json(response,200,runtime.delivery.cancel(decodeURIComponent(deliveryCancel[1]),data.reason,actor));return true;}
      const deliveryCourier=pathname.match(/^\/api\/v1\/vertical\/delivery\/([^/]+)\/courier$/);
      if(request.method==='PATCH'&&deliveryCourier){moduleRule('FOOD',actor);requireCapability(actor,'restaurant.orders.create');const data=await body(request);json(response,200,runtime.delivery.assignCourier(decodeURIComponent(deliveryCourier[1]),data.courier,actor));return true;}
      const deliverySale=pathname.match(/^\/api\/v1\/vertical\/delivery\/([^/]+)\/sale$/);
      if(request.method==='POST'&&deliverySale){moduleRule('FOOD',actor);requireCapabilities(actor,'restaurant.orders.create','sales.create');const data=await body(request);json(response,201,runtime.delivery.createSale(decodeURIComponent(deliverySale[1]),{...data,terminalId:data.terminalId||p.terminalId},actor));return true;}

      if(request.method==='GET'&&pathname==='/api/v1/vertical/fast-food/ready'){moduleRule('FOOD',actor);json(response,200,runtime.fastFood.readyBoard());return true;}
      if(request.method==='GET'&&pathname==='/api/v1/vertical/fast-food'){moduleRule('FOOD',actor);json(response,200,runtime.fastFood.list({status:url.searchParams.get('status')||null}));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/fast-food'){moduleRule('FOOD',actor);const data=await body(request);const result=await mutate(request,pathname,201,()=>runtime.fastFood.create(data,actor));json(response,result.statusCode,result.payload);return true;}
      const fastStatus=pathname.match(/^\/api\/v1\/vertical\/fast-food\/([^/]+)\/status$/);
      if(request.method==='PATCH'&&fastStatus){moduleRule('FOOD',actor);const data=await body(request);json(response,200,runtime.fastFood.updateStatus(decodeURIComponent(fastStatus[1]),data.status,actor));return true;}

      if(request.method==='POST'&&['/api/v1/vertical/market/price-weight','/api/v1/vertical/catalog/weight/price'].includes(pathname)){json(response,200,runtime.marketBakery.priceWeightedItem(await body(request)));return true;}
      if(request.method==='POST'&&['/api/v1/vertical/market/weight-profile','/api/v1/vertical/catalog/weight/profile'].includes(pathname)){requireCapability(actor,'products.manage');json(response,201,runtime.marketBakery.upsertWeightBarcodeProfile(await body(request),actor));return true;}
      if(request.method==='POST'&&['/api/v1/vertical/market/parse-weight','/api/v1/vertical/catalog/weight/parse'].includes(pathname)){const data=await body(request);json(response,200,runtime.marketBakery.parseWeightBarcode(data.barcode,{profileId:data.profileId||null}));return true;}
      const weightedSale=pathname.match(/^\/api\/v1\/vertical\/catalog\/weight\/sales\/([^/]+)\/items$/);
      if(request.method==='POST'&&weightedSale){json(response,200,runtime.marketBakery.addWeightedItemToSale(decodeURIComponent(weightedSale[1]),await body(request),actor));return true;}
      const weightedSaleItem=pathname.match(/^\/api\/v1\/vertical\/catalog\/weight\/sales\/([^/]+)\/items\/([^/]+)$/);
      if(request.method==='DELETE'&&weightedSaleItem){json(response,200,runtime.sales.removeItemById(decodeURIComponent(weightedSaleItem[1]),decodeURIComponent(weightedSaleItem[2])));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/bakery/orders'){moduleRule('FOOD',actor);requireCapability(actor,'restaurant.orders.create');json(response,201,runtime.marketBakery.createBakeryOrder(await body(request),actor));return true;}
      const bakeryOrder=pathname.match(/^\/api\/v1\/vertical\/bakery\/orders\/([^/]+)$/);
      if(request.method==='GET'&&bakeryOrder){moduleRule('FOOD',actor);requireCapability(actor,'restaurant.orders.view');json(response,200,runtime.marketBakery.getBakeryOrder(decodeURIComponent(bakeryOrder[1])));return true;}
      const bakeryStatus=pathname.match(/^\/api\/v1\/vertical\/bakery\/orders\/([^/]+)\/status$/);
      if(request.method==='PATCH'&&bakeryStatus){moduleRule('FOOD',actor);requireCapability(actor,'restaurant.orders.create');const data=await body(request);json(response,200,runtime.marketBakery.updateBakeryOrderStatus(decodeURIComponent(bakeryStatus[1]),data.status,actor));return true;}
      const bakeryCancel=pathname.match(/^\/api\/v1\/vertical\/bakery\/orders\/([^/]+)\/cancel$/);
      if(request.method==='POST'&&bakeryCancel){moduleRule('FOOD',actor);requireCapability(actor,'restaurant.orders.cancel');const data=await body(request);json(response,200,runtime.marketBakery.cancelBakeryOrder(decodeURIComponent(bakeryCancel[1]),data.reason,actor));return true;}

      throw new VerticalHttpError(404,'Rota vertical nao encontrada.');
    }catch(error){const status=statusForError(error);try{runtime.logger?.log({level:status>=500?'error':'warn',subsystem:'vertical-http',message:error.message||'Erro interno.',context:{method:request.method,path:pathname,status}});}catch{}json(response,status,{error:error.message||'Erro interno.',code:error.code||undefined});return true;}
  };
}
module.exports={createVerticalRouter,VerticalHttpError};
