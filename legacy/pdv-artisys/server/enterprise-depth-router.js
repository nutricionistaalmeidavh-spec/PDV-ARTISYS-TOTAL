'use strict';
const { createTerminalStockLocationService }=require('../js/domains/inventory/terminal-stock-location-service');
class EnterpriseDepthHttpError extends Error{constructor(statusCode,message){super(message);this.statusCode=statusCode;}}
function json(res,status,payload){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(payload));}
async function body(req,limit=1024*1024){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw new EnterpriseDepthHttpError(413,'Corpo da requisicao excede o limite permitido.');chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new EnterpriseDepthHttpError(400,'JSON invalido.');}}
function pathMatch(pathname,pattern){const p=pattern.split('/').filter(Boolean),a=pathname.split('/').filter(Boolean);if(p.length!==a.length)return null;const out={};for(let i=0;i<p.length;i++){if(p[i].startsWith(':'))out[p[i].slice(1)]=decodeURIComponent(a[i]);else if(p[i]!==a[i])return null;}return out;}
function bearer(req){const value=String(req.headers.authorization||'');return value.startsWith('Bearer ')?value.slice(7).trim():'';}

function createEnterpriseDepthRouter({runtime,requireTerminalAuth=false,sessionStore=null}={}){
  if(!runtime?.logistics||!runtime?.procurement||!runtime?.orders)throw new TypeError('enterprise depth runtime services are required.');
  const sessions=sessionStore||new Map();
  const terminalStockLocations=createTerminalStockLocationService({db:runtime.db});
  function principal(req){
    const token=bearer(req);const session=sessions.get(token);
    if(!session||session.expiresAt<=Date.now()){if(token)sessions.delete(token);throw new EnterpriseDepthHttpError(401,'Sessao invalida ou expirada.');}
    if(requireTerminalAuth){const terminal=runtime.terminals.listTerminals().find(item=>item.terminalId===session.terminalId);if(!terminal||terminal.status!=='ACTIVE')throw new EnterpriseDepthHttpError(401,'Terminal nao autorizado.');}
    return{kind:'human',userId:session.userId,terminalId:session.terminalId||null};
  }
  function requireCapability(actor,capability){try{return runtime.authorization.require({principal:{kind:'human',id:actor.userId},capability});}catch(error){throw new EnterpriseDepthHttpError(error.statusCode||403,error.message||'Permissao insuficiente.');}}
  return async function enterpriseDepthRouter(req,res){
    const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);const pathname=url.pathname;
    if(pathname!=='/api/v1/suppliers'&&!pathname.startsWith('/api/v1/stock-')&&!pathname.startsWith('/api/v1/purchase-')&&!pathname.startsWith('/api/v1/sales-orders')&&!pathname.startsWith('/api/v1/terminal-stock-locations'))return false;
    try{
      const actor=principal(req);let match;
      if(pathname==='/api/v1/suppliers'){
        requireCapability(actor,req.method==='GET'?'suppliers.view':'suppliers.manage');
        if(req.method==='GET'){json(res,200,runtime.catalog.listSuppliers({includeInactive:url.searchParams.get('includeInactive')==='true'}));return true;}
        if(req.method==='POST'){json(res,201,runtime.catalog.upsertSupplier(await body(req),actor));return true;}
      }
      if(pathname==='/api/v1/stock-locations'){
        if(req.method==='GET'){json(res,200,runtime.logistics.listLocations({includeInactive:url.searchParams.get('includeInactive')==='true'}));return true;}
        if(req.method==='POST'){requireCapability(actor,'inventory.adjust');json(res,201,runtime.logistics.createLocation(await body(req),actor));return true;}
      }
      if(pathname==='/api/v1/stock-balances'&&req.method==='GET'){
        const aggregate=url.searchParams.get('aggregate')==='true';const locationId=url.searchParams.get('locationId')||'MAIN';
        json(res,200,runtime.inventory.listBalances({query:url.searchParams.get('query')||'',locationId,aggregate}));return true;
      }
      if(pathname==='/api/v1/stock-movements'&&req.method==='GET'){
        json(res,200,runtime.inventory.listMovements({productId:url.searchParams.get('productId')||null,locationId:url.searchParams.get('locationId')||null,type:url.searchParams.get('type')||null,from:url.searchParams.get('from')||null,to:url.searchParams.get('to')||null}));return true;
      }
      if(pathname==='/api/v1/stock-availability'&&req.method==='GET'){const productId=url.searchParams.get('productId');if(!productId)throw new EnterpriseDepthHttpError(400,'productId obrigatorio.');json(res,200,runtime.logistics.getAvailability(productId,url.searchParams.get('locationId')||'MAIN'));return true;}
      if(pathname==='/api/v1/stock-reservations'&&req.method==='GET'){const names=new Map(runtime.catalog.listProducts({includeInactive:true}).map(product=>[product.id,product.name]));const rows=runtime.logistics.listReservations({status:url.searchParams.get('status')||null,sourceType:url.searchParams.get('sourceType')||null,sourceId:url.searchParams.get('sourceId')||null,locationId:url.searchParams.get('locationId')||null}).map(row=>({...row,productName:names.get(row.productId)||null}));json(res,200,rows);return true;}
      if(pathname==='/api/v1/stock-transfers'){
        if(req.method==='GET'){json(res,200,runtime.logistics.listTransfers({status:url.searchParams.get('status')||null,locationId:url.searchParams.get('locationId')||null}));return true;}
        if(req.method==='POST'){requireCapability(actor,'inventory.adjust');json(res,201,runtime.logistics.createTransfer(await body(req),actor));return true;}
      }
      if((match=pathMatch(pathname,'/api/v1/stock-transfers/:id/dispatch'))&&req.method==='POST'){requireCapability(actor,'inventory.adjust');json(res,200,runtime.logistics.dispatchTransfer(match.id,await body(req),actor));return true;}
      if((match=pathMatch(pathname,'/api/v1/stock-transfers/:id/receive'))&&req.method==='POST'){requireCapability(actor,'inventory.adjust');json(res,200,runtime.logistics.receiveTransfer(match.id,await body(req),actor));return true;}
      if((match=pathMatch(pathname,'/api/v1/stock-transfers/:id/cancel'))&&req.method==='POST'){requireCapability(actor,'inventory.adjust');json(res,200,runtime.logistics.cancelTransfer(match.id,await body(req),actor));return true;}
      if(pathname==='/api/v1/terminal-stock-locations'&&req.method==='GET'){
        requireCapability(actor,'inventory.adjust');
        const bindingRows=terminalStockLocations.listTerminalBindings();const bindings=new Map(bindingRows.map(item=>[item.terminalId,item]));
        const terminals=new Map(runtime.terminals.listTerminals().map(item=>[item.terminalId,item]));
        if(actor.terminalId&&!terminals.has(actor.terminalId))terminals.set(actor.terminalId,{terminalId:actor.terminalId,name:`Terminal ${actor.terminalId}`,status:'ACTIVE',local:true});
        for(const binding of bindingRows)if(!terminals.has(binding.terminalId))terminals.set(binding.terminalId,{terminalId:binding.terminalId,name:`Terminal ${binding.terminalId}`,status:'ACTIVE',local:true});
        const rows=[...terminals.values()].map(terminal=>{const binding=bindings.get(terminal.terminalId);const resolved=terminalStockLocations.resolveTerminalLocation(terminal.terminalId);return{...terminal,locationId:resolved.locationId,locationName:resolved.locationName,locationType:resolved.locationType,fallback:Boolean(resolved.fallback),explicitBinding:Boolean(binding)};});
        json(res,200,rows);return true;
      }
      if((match=pathMatch(pathname,'/api/v1/terminal-stock-locations/:terminalId'))&&req.method==='PUT'){
        requireCapability(actor,'inventory.adjust');const data=await body(req);json(res,200,terminalStockLocations.bindTerminal(match.terminalId,data.locationId,actor));return true;
      }
      if(pathname==='/api/v1/purchase-orders'){
        requireCapability(actor,'inventory.procurement');
        if(req.method==='GET'){json(res,200,runtime.procurement.listPurchaseOrders({status:url.searchParams.get('status')||null,supplierId:url.searchParams.get('supplierId')||null,locationId:url.searchParams.get('locationId')||null}));return true;}
        if(req.method==='POST'){json(res,201,runtime.procurement.createPurchaseOrder(await body(req),actor));return true;}
      }
      if(pathname==='/api/v1/purchase-receipts'&&req.method==='GET'){requireCapability(actor,'inventory.procurement');json(res,200,runtime.procurement.listReceipts({purchaseOrderId:url.searchParams.get('purchaseOrderId')||null}));return true;}
      if((match=pathMatch(pathname,'/api/v1/purchase-orders/:id/submit'))&&req.method==='POST'){requireCapability(actor,'inventory.procurement');json(res,200,runtime.procurement.submitPurchaseOrder(match.id,actor));return true;}
      if((match=pathMatch(pathname,'/api/v1/purchase-orders/:id/receive'))&&req.method==='POST'){requireCapability(actor,'inventory.procurement');json(res,201,runtime.procurement.receivePurchaseOrder(match.id,await body(req),actor));return true;}
      if(pathname==='/api/v1/sales-orders'){
        if(req.method==='GET'){json(res,200,runtime.orders.listOrders({status:url.searchParams.get('status')||null,customerId:url.searchParams.get('customerId')||null,locationId:url.searchParams.get('locationId')||null}));return true;}
        if(req.method==='POST'){json(res,201,runtime.orders.createQuote(await body(req),actor));return true;}
      }
      if((match=pathMatch(pathname,'/api/v1/sales-orders/:id'))&&req.method==='GET'){const order=runtime.orders.getOrder(match.id);if(!order)throw new EnterpriseDepthHttpError(404,'Pedido nao encontrado.');json(res,200,order);return true;}
      if((match=pathMatch(pathname,'/api/v1/sales-orders/:id/confirm'))&&req.method==='POST'){json(res,200,runtime.orders.confirmOrder(match.id,actor));return true;}
      if((match=pathMatch(pathname,'/api/v1/sales-orders/:id/cancel'))&&req.method==='POST'){requireCapability(actor,'sales.cancel');json(res,200,runtime.orders.cancelOrder(match.id,await body(req),actor));return true;}
      if((match=pathMatch(pathname,'/api/v1/sales-orders/:id/fulfill'))&&req.method==='POST'){requireCapability(actor,'sales.create');const result=runtime.orders.fulfillOrder(match.id,await body(req),actor);await runtime.dispatchPending();json(res,201,result);return true;}
      throw new EnterpriseDepthHttpError(405,'Metodo nao permitido.');
    }catch(error){let status=error.statusCode||(/UNIQUE constraint failed/.test(error.message||'')?409:400);if(!error.statusCode&&/(Autorizacao de gerente|Usuario sem permissao|Permissao insuficiente)/i.test(error.message||''))status=403;try{runtime.logger?.log({level:'warn',subsystem:'enterprise-depth-http',message:error.message||'Erro interno.',context:{method:req.method,path:pathname,status}});}catch{}json(res,status,{error:error.message||'Erro interno.'});return true;}
  };
}
module.exports={createEnterpriseDepthRouter,EnterpriseDepthHttpError};
