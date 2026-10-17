'use strict';

class CheckoutDocumentHttpError extends Error{constructor(statusCode,message){super(message);this.statusCode=statusCode;}}
function json(res,status,payload){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(payload));}
function bearer(req){const value=String(req.headers.authorization||'');return value.startsWith('Bearer ')?value.slice(7).trim():'';}
function match(pathname,pattern){const p=pattern.split('/').filter(Boolean),a=pathname.split('/').filter(Boolean);if(p.length!==a.length)return null;const out={};for(let i=0;i<p.length;i++){if(p[i].startsWith(':'))out[p[i].slice(1)]=decodeURIComponent(a[i]);else if(p[i]!==a[i])return null;}return out;}
function normalizeSearch(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');}
function matchesSearch(parts,query){const q=normalizeSearch(query);if(!q)return true;const hay=normalizeSearch(parts.filter(Boolean).join(' '));return q.split(' ').every(token=>hay.includes(token));}

function createCheckoutDocumentRouter({runtime,sessionStore=null,requireTerminalAuth=false}={}){
  if(!runtime?.sales||!runtime?.orders||!runtime?.restaurant)throw new TypeError('checkout document runtime services are required.');
  const sessions=sessionStore||new Map();
  function principal(req){
    const token=bearer(req);const session=sessions.get(token);
    if(!session||session.expiresAt<=Date.now()){if(token)sessions.delete(token);throw new CheckoutDocumentHttpError(401,'Sessao invalida ou expirada.');}
    if(requireTerminalAuth){const terminal=runtime.terminals.listTerminals().find(item=>item.terminalId===session.terminalId);if(!terminal||terminal.status!=='ACTIVE')throw new CheckoutDocumentHttpError(401,'Terminal nao autorizado.');}
    return{kind:'human',userId:session.userId,terminalId:session.terminalId||null};
  }
  function search(query=''){
    const q=normalizeSearch(query);const rows=[];
    if(runtime.modules?.isEnabled('FOOD')){
      for(const table of runtime.restaurant.listTables()){
        if(!table.sessionId)continue;
        const session=runtime.restaurant.getSession(table.sessionId);if(!session||!['OPEN','CHECKOUT'].includes(session.status))continue;
        if(!matchesSearch([table.label,table.id,session.id,'mesa mesas comanda comandas alimentacao'],q))continue;
        rows.push({type:'COMMAND',id:session.id,number:table.label,label:`${table.label} · Comanda`,status:session.status,totalCents:session.totalCents,customerName:null,saleId:session.checkoutSaleId||null,openedAt:session.openedAt});
      }
    }
    if(runtime.modules?.isEnabled('WHOLESALE')){
      for(const order of runtime.orders.listOrders({origin:'WHOLESALE'})){
        if(!['CONFIRMED','PARTIALLY_FULFILLED'].includes(order.status))continue;
        if(!matchesSearch([order.orderNumber,order.id,order.customerName,'pedido pedidos atacado pedido atacado pedidos atacado pedido de atacado pedidos de atacado'],q))continue;
        rows.push({type:'ORDER',id:order.id,number:order.orderNumber||order.id,label:`${order.orderNumber||order.id} · Pedido Atacado`,status:order.status,totalCents:order.items.reduce((sum,item)=>sum+Math.round(Number(item.pendingQuantity||0)*Number(item.unitPriceCents||0)),0),customerName:order.customerName||null,saleId:null,openedAt:order.createdAt});
      }
    }
    if(runtime.modules?.isEnabled('FOOD')&&runtime.delivery?.list){
      for(const order of runtime.delivery.list()){
        if(!order.saleId||order.status==='CANCELLED')continue;
        const sale=runtime.sales.getSale(order.saleId);if(!sale||!['OPEN','SUSPENDED'].includes(sale.status))continue;
        const pickup=order.fulfillmentType==='PICKUP';
        const aliases=pickup?'retirada retirar pickup':'delivery entrega entregas';
        if(!matchesSearch([order.id,order.customerName,order.phone,aliases],q))continue;
        const channel=pickup?'Retirada':'Delivery';
        rows.push({type:'DELIVERY',id:order.id,number:order.id,label:`${order.customerName||order.id} · ${channel}`,status:order.status,totalCents:Number(sale.totalCents||0),customerName:order.customerName||null,phone:order.phone||null,fulfillmentType:order.fulfillmentType,saleId:order.saleId,openedAt:order.createdAt});
      }
    }
    return rows.sort((a,b)=>String(b.openedAt||'').localeCompare(String(a.openedAt||''))).slice(0,50);
  }
  return async function checkoutDocumentRouter(req,res){
    const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);const pathname=url.pathname;
    if(!pathname.startsWith('/api/v1/checkout/documents'))return false;
    try{
      const actor=principal(req);let m;
      if(pathname==='/api/v1/checkout/documents'&&req.method==='GET'){json(res,200,search(url.searchParams.get('query')||''));return true;}
      if((m=match(pathname,'/api/v1/checkout/documents/command/:id/open'))&&req.method==='POST'){
        if(!runtime.modules?.isEnabled('FOOD'))throw new CheckoutDocumentHttpError(409,'Alimentacao desativada.');
        const session=runtime.restaurant.getSession(m.id);if(!session||!['OPEN','CHECKOUT'].includes(session.status))throw new CheckoutDocumentHttpError(404,'Comanda nao encontrada ou ja encerrada.');
        if(session.checkoutSaleId){const existing=runtime.sales.getSale(session.checkoutSaleId);if(existing&&['OPEN','SUSPENDED'].includes(existing.status)){json(res,200,{type:'COMMAND',document:session,sale:existing});return true;}}
        const terminalId=actor.terminalId;if(!terminalId)throw new CheckoutDocumentHttpError(400,'Terminal obrigatorio.');
        const result=runtime.restaurant.checkoutToSale(session.id,{terminalId,operatorId:actor.userId,actor},runtime.sales);
        json(res,200,{type:'COMMAND',document:result.session,sale:result.sale});return true;
      }
      if((m=match(pathname,'/api/v1/checkout/documents/order/:id/open'))&&req.method==='POST'){
        if(!runtime.modules?.isEnabled('WHOLESALE'))throw new CheckoutDocumentHttpError(409,'Atacado desativado.');
        const terminalId=actor.terminalId;if(!terminalId)throw new CheckoutDocumentHttpError(400,'Terminal obrigatorio.');
        const result=runtime.orders.prepareCheckout(m.id,{terminalId,operatorId:actor.userId,sellerId:actor.userId},actor);
        json(res,200,{type:'ORDER',document:result.order,fulfillment:result.fulfillment,sale:result.sale});return true;
      }
      if((m=match(pathname,'/api/v1/checkout/documents/delivery/:id/open'))&&req.method==='POST'){
        if(!runtime.modules?.isEnabled('FOOD')||!runtime.delivery?.get)throw new CheckoutDocumentHttpError(409,'Alimentacao desativada.');
        const order=runtime.delivery.get(m.id);if(!order||order.status==='CANCELLED')throw new CheckoutDocumentHttpError(404,'Pedido de entrega ou retirada nao encontrado.');
        if(!order.saleId)throw new CheckoutDocumentHttpError(409,'Pedido ainda nao foi enviado para o caixa.');
        let sale=runtime.sales.getSale(order.saleId);if(!sale||!['OPEN','SUSPENDED'].includes(sale.status))throw new CheckoutDocumentHttpError(409,'A venda deste pedido nao esta disponivel para cobranca.');
        if(sale.status==='SUSPENDED'){if(typeof runtime.sales.resumeSale!=='function')throw new CheckoutDocumentHttpError(409,'Venda suspensa nao pode ser retomada.');sale=runtime.sales.resumeSale(sale.id);}
        json(res,200,{type:'DELIVERY',document:order,sale});return true;
      }
      throw new CheckoutDocumentHttpError(405,'Metodo nao permitido.');
    }catch(error){
      let status=error.statusCode||400;if(!error.statusCode&&/Permissao insuficiente|Autorizacao/i.test(error.message||''))status=403;
      json(res,status,{error:error.message||'Erro interno.'});return true;
    }
  };
}
module.exports={createCheckoutDocumentRouter,CheckoutDocumentHttpError};
