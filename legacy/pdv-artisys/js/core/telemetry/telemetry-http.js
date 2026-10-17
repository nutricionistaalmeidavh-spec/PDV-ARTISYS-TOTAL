'use strict';
const {fingerprintError}=require('./telemetry-fingerprint');
function safePath(raw=''){try{return new URL(String(raw||'/'),'http://localhost').pathname;}catch{return String(raw||'').split('?')[0];}}
function moduleFor(pathname){const m=pathname.match(/^\/api\/v1\/([^/]+)/);return m?m[1].replace(/[^a-z0-9_-]/gi,'').slice(0,32):'api';}
function sqliteLike(error){const code=String(error?.code||'');const name=String(error?.name||'');return /^SQLITE_/i.test(code)||/sqlite/i.test(name);}
function technicalFingerprint({errorClass,subsystem,operation,error}){return fingerprintError({errorClass,subsystem,operation,stack:error?.stack||''});}
function classifyTelemetryHttpFailure({method='GET',pathname='/',status=0,error=null}={}){
 const code=Number(status||0);if(code<500)return null;const path=safePath(pathname);const verb=String(method||'GET').toUpperCase();
 if(sqliteLike(error)){const errorClass=String(error?.name||'SQLiteError').slice(0,64);return{eventName:'database_failed',dimensions:{module:moduleFor(path),operation:'database_operation',subsystem:'sqlite',error_class:errorClass,fingerprint:technicalFingerprint({errorClass,subsystem:'sqlite',operation:'database_operation',error})}};}
 if(/^\/api\/v1\/sales(?:\/|$)/.test(path)){const operation=verb==='POST'?'sale_mutation':'sale_request';return{eventName:'sale_failed',dimensions:{module:'pos',operation,error_class:'http_5xx',fingerprint:technicalFingerprint({errorClass:'http_5xx',subsystem:'sales',operation,error})}};}
 if(/^\/api\/v1\/returns(?:\/|$)/.test(path)){const operation='return_mutation';return{eventName:'return_failed',dimensions:{module:'returns',operation,error_class:'http_5xx',fingerprint:technicalFingerprint({errorClass:'http_5xx',subsystem:'returns',operation,error})}};}
 if(/^\/api\/v1\/(cash|inventory|finance|fiscal|print|restaurant|vertical|orders|procurement)(?:\/|$)/.test(path)){const module=moduleFor(path);const operation='http_request';return{eventName:'operation_failed',dimensions:{module,operation,subsystem:'api',error_class:'http_5xx',fingerprint:technicalFingerprint({errorClass:'http_5xx',subsystem:module,operation,error})}};}
 return null;
}
function observeTelemetryResponse({request,response,telemetry,errorProvider=()=>null}={}){
 if(!request||!response||!telemetry?.record)return()=>{};const handler=()=>{try{const result=classifyTelemetryHttpFailure({method:request.method,pathname:request.url,status:response.statusCode,error:errorProvider()});if(result)telemetry.record(result.eventName,{dimensions:result.dimensions},{terminalKey:String(request.headers?.['x-terminal-id']||'server-terminal')});}catch{}};response.once('finish',handler);return()=>response.removeListener('finish',handler);
}
module.exports={safePath,classifyTelemetryHttpFailure,observeTelemetryResponse};
