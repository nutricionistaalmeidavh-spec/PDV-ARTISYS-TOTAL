'use strict';

const TEXT_LIMIT=128;
const EVENT_SCHEMAS=Object.freeze({
 app_started:{dimensions:['platform','architecture'],measurements:[]},
 app_closed:{dimensions:['result'],measurements:['duration_ms']},
 screen_opened:{dimensions:['route'],measurements:[]},
 sale_started:{dimensions:['module'],measurements:[]},
 sale_completed:{dimensions:['module','result'],measurements:['duration_ms','items_count','payment_methods_count']},
 sale_failed:{dimensions:['module','operation','error_class','fingerprint'],measurements:['duration_ms']},
 return_started:{dimensions:['module'],measurements:[]},
 return_completed:{dimensions:['module','result'],measurements:['duration_ms','items_count']},
 return_failed:{dimensions:['module','operation','error_class','fingerprint'],measurements:['duration_ms']},
 printer_failed:{dimensions:['module','operation','error_class','fingerprint'],measurements:['attempt']},
 fiscal_failed:{dimensions:['module','operation','subsystem','state','error_class','fingerprint'],measurements:['attempt']},
 database_failed:{dimensions:['module','operation','subsystem','error_class','fingerprint'],measurements:[]},
 network_failed:{dimensions:['module','operation','network_state','error_class','fingerprint'],measurements:[]},
 operation_failed:{dimensions:['module','operation','subsystem','error_class','fingerprint'],measurements:['duration_ms']}
});
function plainObject(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function assertText(value,field){if(typeof value!=='string')throw new TypeError(`Campo ${field} deve ser texto.`);if(value.length>TEXT_LIMIT)throw new RangeError(`Campo ${field} excede o limite de ${TEXT_LIMIT}.`);return value;}
function validateMap(input,allowed,type){if(input==null)return{};if(!plainObject(input))throw new TypeError(`${type} deve ser objeto.`);const out={};for(const [key,value] of Object.entries(input)){if(!allowed.has(key))throw new Error(`Campo de telemetria desconhecido: ${key}.`);if(type==='dimensions')out[key]=assertText(value,key);else{const num=Number(value);if(!Number.isFinite(num))throw new TypeError(`Campo ${key} deve ser numerico.`);out[key]=num;}}return out;}
function validateTelemetryEvent(eventName,payload={}){const name=String(eventName||'').trim();const schema=EVENT_SCHEMAS[name];if(!schema)throw new Error(`Evento de telemetria desconhecido: ${name||'<vazio>'}.`);if(!plainObject(payload))throw new TypeError('Payload de telemetria deve ser objeto.');return{dimensions:validateMap(payload.dimensions,new Set(schema.dimensions),'dimensions'),measurements:validateMap(payload.measurements,new Set(schema.measurements),'measurements')};}
module.exports={EVENT_SCHEMAS,TEXT_LIMIT,validateTelemetryEvent};
