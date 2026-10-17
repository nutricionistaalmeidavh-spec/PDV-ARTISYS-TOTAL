'use strict';
const {fingerprintError}=require('./telemetry-fingerprint');
const REGISTERED_BUSES=new WeakSet();
function failureDimensions({module,subsystem=module,operation,state='',domainType}){return{module,operation,...(subsystem?{subsystem}:{}),...(state?{state}:{}),error_class:'domain_failure',fingerprint:fingerprintError({errorClass:'domain_failure',subsystem,operation,stack:domainType})};}
const EVENT_MAP=Object.freeze({
 'sale.opened':['sale_started',{module:'pos'}],
 'sale.completed':['sale_completed',{module:'pos',result:'success'}],
 'return.completed':['return_completed',{module:'returns',result:'success'}],
 'receipt.failed':['printer_failed',failureDimensions({module:'printing',subsystem:'printing',operation:'receipt_print',domainType:'receipt.failed'})]
});
function registerTelemetryEffects({bus,telemetry}={}){
 if(!bus?.subscribe||!telemetry?.record)throw new TypeError('bus e telemetry obrigatorios.');
 if(REGISTERED_BUSES.has(bus))return[];REGISTERED_BUSES.add(bus);
 const unsub=[];
 for(const [domainType,[eventName,dimensions]] of Object.entries(EVENT_MAP))unsub.push(bus.subscribe(domainType,()=>{try{telemetry.record(eventName,{dimensions});}catch{/* observability is fail-open */}}));
 return unsub;
}
module.exports={EVENT_MAP,registerTelemetryEffects};
