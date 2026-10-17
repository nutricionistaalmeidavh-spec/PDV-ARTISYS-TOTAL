'use strict';
const {statusForError}=require('./http-error-status');

class KitComboHttpError extends Error { constructor(statusCode,message){super(message);this.statusCode=statusCode;} }
function json(response,statusCode,payload){response.writeHead(statusCode,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(payload));}
async function body(request,limit=1024*1024){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>limit)throw new KitComboHttpError(413,'Corpo da requisicao excede o limite permitido.');chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new KitComboHttpError(400,'JSON invalido.');}}

function createKitComboRouter({runtime,installationToken='',requireTerminalAuth=false}={}){
  if(!runtime?.kitsCombos) throw new TypeError('runtime.kitsCombos is required.');
  function principal(request){
    if(requireTerminalAuth){const id=String(request.headers['x-terminal-id']||'').trim();const key=String(request.headers['x-terminal-key']||'');const auth=runtime.terminals.authenticateTerminal(id,key);if(!auth.ok)throw new KitComboHttpError(401,'Terminal nao autorizado.');return{kind:'device',id,surface:'terminal',userId:null,terminalId:id};}
    if(installationToken&&request.headers['x-pdv-token']!==installationToken)throw new KitComboHttpError(401,'Token local invalido.');
    return{kind:'system',id:'system',terminalId:null};
  }
  return async function kitComboRouter(request,response){
    const url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`);const pathname=url.pathname;
    const kitsPath='/api/v1/vertical/catalog/kits';const combosPath='/api/v1/vertical/catalog/promotional-combos';
    if(pathname!==kitsPath&&pathname!==combosPath)return false;
    try{
      const actor=principal(request);
      const includeInactive=url.searchParams.get('includeInactive')==='true';
      if(request.method==='GET'&&pathname===kitsPath){json(response,200,runtime.kitsCombos.listKits({includeInactive}));return true;}
      if(request.method==='POST'&&pathname===kitsPath){json(response,201,runtime.kitsCombos.upsertKit(await body(request),actor));return true;}
      if(request.method==='GET'&&pathname===combosPath){json(response,200,runtime.kitsCombos.listPromotionalCombos({includeInactive}));return true;}
      if(request.method==='POST'&&pathname===combosPath){json(response,201,runtime.kitsCombos.upsertPromotionalCombo(await body(request),actor));return true;}
      throw new KitComboHttpError(405,'Metodo nao permitido.');
    }catch(error){const status=statusForError(error);try{runtime.logger?.log({level:'warn',subsystem:'kit-combo-http',message:error.message||'Erro interno.',context:{method:request.method,path:pathname,status}});}catch{}json(response,status,{error:error.message||'Erro interno.'});return true;}
  };
}

module.exports={createKitComboRouter,KitComboHttpError};
