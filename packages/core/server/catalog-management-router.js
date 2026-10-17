'use strict';

class CatalogManagementHttpError extends Error {
  constructor(statusCode,message){super(message);this.statusCode=statusCode;}
}

function json(res,status,payload){
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(payload));
}

function bearer(req){
  const value=String(req.headers.authorization||'');
  return value.startsWith('Bearer ')?value.slice(7).trim():'';
}

async function readBody(req,limit=1024*1024){
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>limit)throw new CatalogManagementHttpError(413,'Corpo da requisicao excede o limite permitido.');chunks.push(chunk);}
  if(!chunks.length)return{};
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new CatalogManagementHttpError(400,'JSON invalido.');}
}

function createCatalogManagementRouter({runtime,sessionStore=null,requireTerminalAuth=false,bodyLimitBytes=1024*1024}={}){
  if(!runtime?.catalog)throw new TypeError('catalog runtime service is required.');
  const sessions=sessionStore||new Map();

  function principal(req){
    const token=bearer(req);const session=sessions.get(token);
    if(!session||session.expiresAt<=Date.now()){if(token)sessions.delete(token);throw new CatalogManagementHttpError(401,'Sessao invalida ou expirada.');}
    const current=runtime.catalog.getUser(session.userId);
    if(!current||!current.active){sessions.delete(token);throw new CatalogManagementHttpError(401,'Sessao invalida ou expirada.');}
    session.name=current.name;
    if(requireTerminalAuth){const terminal=runtime.terminals.listTerminals().find(item=>item.terminalId===session.terminalId);if(!terminal||terminal.status!=='ACTIVE')throw new CatalogManagementHttpError(401,'Terminal nao autorizado.');}
    return{kind:'human',userId:session.userId,terminalId:session.terminalId||null};
  }

  function requireCapability(actor,capability){try{return runtime.authorization.require({principal:{kind:'human',id:actor.userId},capability});}catch(error){throw new CatalogManagementHttpError(error.statusCode||403,error.message||'Permissao insuficiente.');}}
  function invalidateUserSessions(user){
    for(const [token,session] of sessions.entries()){
      if(session.userId!==user.id)continue;
      if(!user.active)sessions.delete(token);
      else{session.name=user.name;}
    }
  }

  return async function catalogManagementRouter(req,res){
    const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);const pathname=url.pathname;
    const categoryMatch=pathname.match(/^\/api\/v1\/categories\/([^/]+)$/);
    const customerMatch=pathname.match(/^\/api\/v1\/customers\/([^/]+)$/);
    const supplierMatch=pathname.match(/^\/api\/v1\/suppliers\/([^/]+)$/);
    const userMatch=pathname.match(/^\/api\/v1\/users\/([^/]+)$/);
    const isManaged=(req.method==='POST'&&(pathname==='/api/v1/customers'||pathname==='/api/v1/users'))||
      (req.method==='DELETE'&&(categoryMatch||customerMatch||supplierMatch||userMatch));
    if(!isManaged)return false;

    try{
      const actor=principal(req);
      if(req.method==='POST'&&pathname==='/api/v1/customers'){
        requireCapability(actor,'customers.manage');
        json(res,201,runtime.catalog.upsertCustomer(await readBody(req,bodyLimitBytes),actor));return true;
      }
      if(req.method==='POST'&&pathname==='/api/v1/users'){
        const data=await readBody(req,bodyLimitBytes);
        const existing=data.id?runtime.catalog.getUser(data.id):null;
        requireCapability(actor,existing?'users.edit':'users.create');
        const saved=runtime.catalog.saveManagedUser(data,actor);
        invalidateUserSessions(saved);json(res,201,saved);return true;
      }
      if(req.method==='DELETE'&&categoryMatch){
        requireCapability(actor,'products.manage');json(res,200,runtime.catalog.removeCategory(decodeURIComponent(categoryMatch[1]),actor));return true;
      }
      if(req.method==='DELETE'&&customerMatch){
        requireCapability(actor,'customers.manage');json(res,200,runtime.catalog.removeCustomer(decodeURIComponent(customerMatch[1]),actor));return true;
      }
      if(req.method==='DELETE'&&supplierMatch){
        requireCapability(actor,'suppliers.manage');json(res,200,runtime.catalog.removeSupplier(decodeURIComponent(supplierMatch[1]),actor));return true;
      }
      if(req.method==='DELETE'&&userMatch){
        requireCapability(actor,'users.disable');
        const removed=runtime.catalog.removeUser(decodeURIComponent(userMatch[1]),actor);invalidateUserSessions(removed);json(res,200,removed);return true;
      }
      return false;
    }catch(error){
      let status=error.statusCode||(/UNIQUE constraint failed/i.test(error.message||'')?409:400);
      if(!error.statusCode&&/Permissao insuficiente|Somente administrador|Gerente nao pode/i.test(error.message||''))status=403;
      json(res,status,{error:error.message||'Erro interno.'});return true;
    }
  };
}

module.exports={createCatalogManagementRouter,CatalogManagementHttpError};
