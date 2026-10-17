'use strict';
const {createTelemetryQueue}=require('./telemetry-queue');
const {validateTelemetryEvent}=require('./telemetry-events');
const {sanitizeTelemetryEnvelope}=require('./telemetry-sanitizer');
const DIAGNOSTIC_EVENTS=new Set(['sale_failed','return_failed','printer_failed','fiscal_failed','database_failed','network_failed','operation_failed']);
const REQUIRED_CONSENT_VERSION=1;
function createTelemetryService({db,settings,logger=null,identity,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${Date.now()}`,httpSender=null,appVersion='0.0.0',releaseId='dev',schemaVersionResolver=()=>0,defaultEndpoint='',random=Math.random}={}){
 if(!db||!settings||!identity)throw new TypeError('db, settings e identity sao obrigatorios.');const queue=createTelemetryQueue({db,now});const sessionId=String(idFactory('telemetry-session'));let lastLog=0;
 const consented=()=>Number(settings.get('telemetry.consent_version',{scope:'global',defaultValue:0})||0)>=REQUIRED_CONSENT_VERSION&&Boolean(settings.get('telemetry.consent_accepted_at',{scope:'global',defaultValue:''}));
 const enabled=()=>consented()&&Boolean(settings.get('telemetry.enabled',{scope:'global',defaultValue:false}));
 const diagnostics=()=>Boolean(settings.get('telemetry.diagnostics',{scope:'global',defaultValue:false}));
 let transport=httpSender;let endpointDefault=String(defaultEndpoint||'');
 const endpoint=()=>String(settings.get('telemetry.endpoint',{scope:'global',defaultValue:endpointDefault})||'').trim();
 const batchSize=()=>{const n=Number(settings.get('telemetry.batchSize',{scope:'global',defaultValue:50}));return Number.isInteger(n)&&n>0?Math.min(n,50):50;};
 function safeLog(message){const t=Date.now();if(t-lastLog<60000)return;lastLog=t;try{logger?.log?.({level:'warn',subsystem:'telemetry',message:String(message||'Falha de telemetria.').slice(0,160)});}catch{}}
 function record(eventName,payload={},options={}){try{if(!enabled())return false;if(DIAGNOSTIC_EVENTS.has(String(eventName))&&!diagnostics())return false;const validated=validateTelemetryEvent(eventName,payload);const envelope=sanitizeTelemetryEnvelope({schema_version:1,event_id:String(idFactory('telemetry')),event_name:String(eventName),occurred_at:now(),installation_id:identity.installationId(),terminal_id:identity.terminalId(options.terminalKey||'server-terminal'),session_id:sessionId,app_version:String(appVersion),release_id:String(releaseId||appVersion),database_schema_version:Number(schemaVersionResolver()||0),dimensions:validated.dimensions,measurements:validated.measurements});queue.enqueue({id:envelope.event_id,eventName,payload:envelope});return true;}catch(error){safeLog(error?.message);return false;}}
 function retryAt(attempt){const seconds=Math.min(3600,Math.max(5,5*(2**Math.min(attempt,8))));const jitter=1+(Number(random())-.5)*.2;return new Date(Date.parse(now())+seconds*1000*jitter).toISOString();}
 async function flush(){const summary={attempted:0,sent:0,retryable:0,discarded:0,paused:false};try{if(!enabled()||!endpoint()||!transport?.sendBatch){summary.paused=true;return summary;}const rows=queue.listReady(batchSize());if(!rows.length)return summary;summary.attempted=rows.length;let response;try{response=await transport.sendBatch({schema_version:1,events:rows.map(row=>row.payload)});}catch{queue.reschedule(rows.map(r=>r.id),retryAt(Math.max(...rows.map(r=>r.attempts),0)));summary.retryable=rows.length;return summary;}const status=Number(response?.status||0);const ids=rows.map(r=>r.id);if(status>=200&&status<300){queue.ack(ids);summary.sent=rows.length;}else if([400,413,422].includes(status)){queue.discard(ids);summary.discarded=rows.length;}else if([401,403].includes(status)){summary.paused=true;}else{queue.reschedule(ids,retryAt(Math.max(...rows.map(r=>r.attempts),0)));summary.retryable=rows.length;}return summary;}catch(error){safeLog(error?.message);summary.paused=true;return summary;}}
 function status(){let pending=0;try{pending=queue.count();}catch{}return{enabled:enabled(),diagnostics:diagnostics(),consented:consented(),endpointConfigured:Boolean(endpoint()),pending};}
 function setEnabled(value,actor={}){return settings.set('telemetry.enabled',Boolean(value),{scope:'global',actor});}
 function configureTransport({httpSender:nextSender,defaultEndpoint:nextEndpoint}={}){if(nextSender!==undefined)transport=nextSender;if(nextEndpoint!==undefined)endpointDefault=String(nextEndpoint||'');return status();}
 function close(){return true;}
 return{record,flush,status,setEnabled,configureTransport,close,queue};
}
module.exports={createTelemetryService,DIAGNOSTIC_EVENTS,REQUIRED_CONSENT_VERSION};
