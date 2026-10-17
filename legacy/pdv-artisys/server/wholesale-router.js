'use strict';

class WholesaleHttpError extends Error{constructor(statusCode,message){super(message);this.statusCode=statusCode;}}
function json(res,status,payload){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(payload));}
async function body(req,limit=1024*1024){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw new WholesaleHttpError(413,'Corpo da requisicao excede o limite permitido.');chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new WholesaleHttpError(400,'JSON invalido.');}}
function bearer(req){const value=String(req.headers.authorization||'');return value.startsWith('Bearer ')?value.slice(7).trim():'';}
function pathMatch(pathname,pattern){const p=pattern.split('/').filter(Boolean),a=pathname.split('/').filter(Boolean);if(p.length!==a.length)return null;const out={};for(let i=0;i<p.length;i++){if(p[i].startsWith(':'))out[p[i].slice(1)]=decodeURIComponent(a[i]);else if(p[i]!==a[i])return null;}return out;}

function createWholesaleRouter({runtime,sessionStore=null,requireTerminalAuth=false}={}){
  if(!runtime?.wholesale)throw new TypeError('wholesale runtime service is required.');
  const sessions=sessionStore||new Map();
  function principal(req){
    const token=bearer(req);const session=sessions.get(token);
    if(!session||session.expiresAt<=Date.now()){if(token)sessions.delete(token);throw new WholesaleHttpError(401,'Sessao invalida ou expirada.');}
    if(requireTerminalAuth){const terminal=runtime.terminals.listTerminals().find(item=>item.terminalId===session.terminalId);if(!terminal||terminal.status!=='ACTIVE')throw new WholesaleHttpError(401,'Terminal nao autorizado.');}
    return{kind:'human',userId:session.userId,terminalId:session.terminalId||null};
  }
  return async function wholesaleRouter(req,res){
    const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);const pathname=url.pathname;
    if(!pathname.startsWith('/api/v1/wholesale'))return false;
    try{
      const actor=principal(req);let match;
      if(pathname==='/api/v1/wholesale/tiers'){
        if(req.method==='GET'){json(res,200,runtime.wholesale.listTiers({productId:url.searchParams.get('productId')||null,includeInactive:url.searchParams.get('includeInactive')==='true'},actor));return true;}
        if(req.method==='POST'){json(res,201,runtime.wholesale.upsertTier(await body(req),actor));return true;}
      }
      if((match=pathMatch(pathname,'/api/v1/wholesale/tiers/:id'))&&req.method==='DELETE'){json(res,200,runtime.wholesale.deactivateTier(match.id,actor));return true;}
      if((match=pathMatch(pathname,'/api/v1/wholesale/customers/:id/policy'))){
        if(req.method==='GET'){json(res,200,runtime.wholesale.getCustomerPolicy(match.id,actor));return true;}
        if(req.method==='PUT'){json(res,200,runtime.wholesale.saveCustomerPolicy({...await body(req),customerId:match.id},actor));return true;}
      }
      if(pathname==='/api/v1/wholesale/price'&&req.method==='GET'){
        const productId=url.searchParams.get('productId');const quantity=Number(url.searchParams.get('quantity'));if(!productId)throw new WholesaleHttpError(400,'productId obrigatorio.');
        json(res,200,runtime.wholesale.resolvePrice(productId,quantity,actor));return true;
      }
      if(pathname==='/api/v1/wholesale/orders'){
        if(req.method==='GET'){json(res,200,runtime.wholesale.listOrders({status:url.searchParams.get('status')||null,customerId:url.searchParams.get('customerId')||null,locationId:url.searchParams.get('locationId')||null},actor));return true;}
        if(req.method==='POST'){json(res,201,runtime.wholesale.createQuote(await body(req),actor));return true;}
      }
      if((match=pathMatch(pathname,'/api/v1/wholesale/orders/:id'))&&req.method==='GET'){json(res,200,runtime.wholesale.getOrder(match.id,actor));return true;}
      if((match=pathMatch(pathname,'/api/v1/wholesale/orders/:id/confirm'))&&req.method==='POST'){json(res,200,runtime.wholesale.confirmOrder(match.id,actor));return true;}
      if((match=pathMatch(pathname,'/api/v1/wholesale/orders/:id/cancel'))&&req.method==='POST'){json(res,200,runtime.wholesale.cancelOrder(match.id,await body(req),actor));return true;}
      if((match=pathMatch(pathname,'/api/v1/wholesale/orders/:id/fulfill'))&&req.method==='POST'){const result=runtime.wholesale.fulfillOrder(match.id,await body(req),actor);await runtime.dispatchPending();json(res,201,result);return true;}
      throw new WholesaleHttpError(405,'Metodo nao permitido.');
    }catch(error){
      let status=error.statusCode||400;
      if(error?.code==='MODULE_DISABLED')status=409;
      else if(!error.statusCode&&/Permissao insuficiente|Autorizacao de gerente|Usuario sem permissao/i.test(error.message||''))status=403;
      else if(!error.statusCode&&/nao encontrado/i.test(error.message||''))status=404;
      try{runtime.logger?.log({level:'warn',subsystem:'wholesale-http',message:error.message||'Erro interno.',context:{method:req.method,path:pathname,status}});}catch{}
      json(res,status,{error:error.message||'Erro interno.',code:error.code||null});return true;
    }
  };
}
module.exports={createWholesaleRouter,WholesaleHttpError};
