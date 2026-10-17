'use strict';
const { validateTelemetryEvent }=require('../js/core/telemetry/telemetry-events');
const { DIAGNOSTIC_EVENTS }=require('../js/core/telemetry/telemetry-core');
const UI_EVENTS=new Set(['screen_opened','return_started']);
const UI_ROUTES=new Set(['home','checkout','products','customers','inventory','finance','reports','management','sellers','cash','sales','returns','settings']);
const PRIVACY_SETTINGS=new Set(['telemetry.enabled','telemetry.diagnostics']);
function bearer(request){const value=String(request.headers?.authorization||'');return value.startsWith('Bearer ')?value.slice(7).trim():'';}
function sendJson(response,statusCode,payload){response.writeHead(statusCode,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(payload));}
async function readJson(request,limit=16*1024){let total=0;const chunks=[];for await(const chunk of request){const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(String(chunk),'utf8');total+=buffer.length;if(total>limit){const error=new Error('Corpo da requisicao excede o limite permitido.');error.statusCode=413;throw error;}chunks.push(buffer);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{const error=new Error('JSON invalido.');error.statusCode=400;throw error;}}
function validateUiTelemetryEvent(eventName,payload={}){const name=String(eventName||'').trim();if(!UI_EVENTS.has(name))throw Object.assign(new Error('Evento de telemetria UI nao permitido.'),{statusCode:422});const validated=validateTelemetryEvent(name,payload);if(name==='screen_opened'){const route=validated.dimensions.route;if(!UI_ROUTES.has(route))throw Object.assign(new Error('Rota de telemetria UI nao permitida.'),{statusCode:422});}return validated;}
function activeSession(request,sessionStore){const token=bearer(request);const session=sessionStore.get(token);if(!session||session.expiresAt<=Date.now()){if(token)sessionStore.delete(token);return null;}return session;}
function createTelemetryRouter({runtime,sessionStore,requireTerminalAuth=false,bodyLimitBytes=16*1024}={}){
 if(!runtime?.telemetry)throw new TypeError('runtime.telemetry is required.');if(!sessionStore)throw new TypeError('sessionStore is required.');
 return async function telemetryRoute(request,response){
  const url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`);
  const settingMatch=url.pathname.match(/^\/api\/v1\/settings\/(telemetry\.(?:enabled|diagnostics))$/);
  const isUiEvent=request.method==='POST'&&url.pathname==='/api/v1/system/telemetry/events';
  if(!isUiEvent&&!(settingMatch&&(request.method==='PUT'||request.method==='DELETE')))return false;
  try{
   const session=activeSession(request,sessionStore);if(!session){sendJson(response,401,{error:'Sessao invalida ou expirada.'});return true;}
   if(requireTerminalAuth){const terminal=runtime.terminals.listTerminals().find(item=>item.terminalId===session.terminalId);if(!terminal||terminal.status!=='ACTIVE'){sendJson(response,401,{error:'Terminal nao autorizado.'});return true;}}
   if(settingMatch){
    if(!runtime.authorization.can({principal:{kind:'human',id:session.userId},capability:'settings.manage'})){sendJson(response,403,{error:'Permissao insuficiente.'});return true;}
    const key=settingMatch[1];if(!PRIVACY_SETTINGS.has(key)){sendJson(response,404,{error:'Configuracao nao encontrada.'});return true;}
    if(request.method==='DELETE'){sendJson(response,405,{error:'Configuracao de privacidade deve ser definida explicitamente.'});return true;}
    const body=await readJson(request,bodyLimitBytes);if(typeof body.value!=='boolean'){sendJson(response,422,{error:'Configuracao de privacidade exige valor booleano.'});return true;}
    const saved=runtime.settings.set(key,body.value,{scope:'global',actor:{kind:'human',userId:session.userId,terminalId:session.terminalId||null}});
    if(body.value===false){if(key==='telemetry.enabled')runtime.telemetry.queue?.clear?.();else runtime.telemetry.queue?.discardEvents?.([...DIAGNOSTIC_EVENTS]);}
    sendJson(response,200,saved);return true;
   }
   const body=await readJson(request,bodyLimitBytes);const payload=validateUiTelemetryEvent(body.eventName,body.payload||{});runtime.telemetry.record(body.eventName,payload,{terminalKey:session.terminalId||'server-terminal'});sendJson(response,202,{accepted:true});return true;
  }catch(error){sendJson(response,Number(error?.statusCode)||500,{error:Number(error?.statusCode)>=500?'Falha interna ao registrar telemetria.':String(error?.message||'Requisicao invalida.')});return true;}
 };
}
module.exports={UI_EVENTS,UI_ROUTES,PRIVACY_SETTINGS,validateUiTelemetryEvent,createTelemetryRouter};
