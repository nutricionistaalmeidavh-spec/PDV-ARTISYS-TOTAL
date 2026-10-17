'use strict';

function bearer(request){const value=String(request.headers.authorization||'');return value.startsWith('Bearer ')?value.slice(7).trim():'';}
function sendJson(response,statusCode,payload){response.writeHead(statusCode,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(payload));}

function createAuthSessionRouter({runtime,sessionStore,requireTerminalAuth=false}={}){
  if(!runtime)throw new TypeError('runtime is required.');
  if(!sessionStore)throw new TypeError('sessionStore is required.');

  return async function authSessionRoute(request,response){
    const url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`);
    if(!['GET','DELETE'].includes(request.method)||url.pathname!=='/api/v1/auth/session')return false;

    const token=bearer(request);const session=sessionStore.get(token);
    if(!session||session.expiresAt<=Date.now()){if(token)sessionStore.delete(token);sendJson(response,401,{error:'Sessao invalida ou expirada.'});return true;}

    if(requireTerminalAuth){
      const terminal=runtime.terminals.listTerminals().find(item=>item.terminalId===session.terminalId);
      if(!terminal||terminal.status!=='ACTIVE'){sendJson(response,401,{error:'Terminal nao autorizado.'});return true;}
    }

    const user=runtime.catalog.getUser(session.userId);
    if(!user||!user.active){sessionStore.delete(token);sendJson(response,401,{error:'Usuario inativo ou inexistente.'});return true;}

    if(request.method==='DELETE'){
      sessionStore.delete(token);
      runtime.accessSecurity?.record({action:'auth.session.revoked',entity:'session',entityId:session.id||null,actor:{kind:'human',userId:user.id},context:{self:true,terminalId:session.terminalId||null}});
      sendJson(response,200,{revoked:true});return true;
    }

    if(runtime.account?.syncLicenseStatus&&runtime.account?.status?.().activated){
      const license=await runtime.account.syncLicenseStatus({allowOffline:true});
      if(license?.active===false){sessionStore.delete(token);sendJson(response,403,{error:'Licenca comercial suspensa, cancelada ou expirada.'});return true;}
    }

    session.lastSeenAt=Date.now();
    const access=runtime.profiles?.getUserAccess?.(user.id)||{profile:null,permissions:[]};
    sendJson(response,200,{
      user:{...user,profile:access.profile,permissions:access.permissions},
      sessionId:session.id||null,
      terminalId:session.terminalId||null,
      expiresAt:new Date(session.expiresAt).toISOString()
    });
    return true;
  };
}

module.exports={createAuthSessionRouter};
