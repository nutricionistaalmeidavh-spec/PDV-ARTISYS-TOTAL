'use strict';
const {createTelemetryIdentity}=require('./telemetry-identity');
const {createTelemetryService}=require('./telemetry-core');
const ATTACH_LISTENERS=new Set();let lastTelemetry=null;let lastRuntime=null;
function onRuntimeTelemetryAttached(handler){if(typeof handler!=='function')throw new TypeError('handler obrigatorio.');ATTACH_LISTENERS.add(handler);if(lastTelemetry)queueMicrotask(()=>{if(ATTACH_LISTENERS.has(handler))handler(lastTelemetry,lastRuntime);});return()=>ATTACH_LISTENERS.delete(handler);}
function attachRuntimeTelemetry({runtime,httpSender=null,defaultEndpoint='',releaseId='',appVersion='',now=()=>new Date().toISOString(),idFactory}={}){
 if(!runtime?.db||!runtime?.settings)throw new TypeError('Runtime com db/settings obrigatorio.');
 if(runtime.telemetry)return runtime.telemetry;
 const identity=createTelemetryIdentity({db:runtime.db});
 const version=String(appVersion||runtime.health?.snapshot?.()?.version||'0.0.0');
 const telemetry=createTelemetryService({db:runtime.db,settings:runtime.settings,logger:runtime.logger||null,identity,now,idFactory,httpSender,appVersion:version,releaseId:releaseId||version,defaultEndpoint,schemaVersionResolver:()=>Number(runtime.db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get()?.version||0)});
 Object.defineProperty(runtime,'telemetry',{value:telemetry,writable:false,enumerable:true,configurable:false});lastTelemetry=telemetry;lastRuntime=runtime;for(const handler of Array.from(ATTACH_LISTENERS)){try{handler(telemetry,runtime);}catch{}}
 return telemetry;
}
module.exports={attachRuntimeTelemetry,onRuntimeTelemetryAttached};
