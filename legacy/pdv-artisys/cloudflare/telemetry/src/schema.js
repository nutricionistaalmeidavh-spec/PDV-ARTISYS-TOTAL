const TEXT_LIMIT=160;
const REGISTRATION_KEYS=new Set(['protocol_version','telemetry_schema_version','installation_id','app_version','release_id','database_schema_version']);
const EVENT_KEYS=new Set(['schema_version','event_id','event_name','occurred_at','installation_id','terminal_id','session_id','app_version','release_id','database_schema_version','dimensions','measurements']);
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
const FORBIDDEN=/(?:password|senha|passwd|token|authorization|credential|secret|segredo|api.?key|private.?key|certificate|certificado|\bcsc\b|\bcpf\b|\bcnpj\b|documento?|\bemail\b|telefone|\bphone\b|address|endere[cç]o|\bxml\b|danfe|\bcard\b|cart[aã]o|\bpan\b|\bcvv\b|observation|observa[cç][aã]o|notes?|message.?content)/i;
const SENSITIVE_VALUES=[/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/i,/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,/\b\d{11}\b/,/\b\d{14}\b/,/\b(?:\d[ -]*?){13,19}\b/];
const TECHNICAL_IDS=new Set(['event_id','installation_id','terminal_id','session_id','release_id']);
const ERROR_EVENTS=new Set(['sale_failed','return_failed','printer_failed','fiscal_failed','database_failed','network_failed','operation_failed']);
function object(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function exactKeys(value,allowed,label){for(const key of Object.keys(value)){if(!allowed.has(key))throw new Error(`Campo ${label} desconhecido: ${key}.`);}}
function safeText(value,field,{scan=true,max=TEXT_LIMIT}={}){if(typeof value!=='string'||!value.trim())throw new TypeError(`${field} deve ser texto.`);if(value.length>max)throw new RangeError(`${field} excede o limite.`);if(FORBIDDEN.test(field))throw new Error(`Campo sensivel/proibido: ${field}.`);if(scan&&SENSITIVE_VALUES.some(re=>re.test(value)))throw new Error(`Valor sensivel/proibido: ${field}.`);return value;}
function safeInteger(value,field){const n=Number(value);if(!Number.isInteger(n)||n<0)throw new TypeError(`${field} invalido.`);return n;}
function validateRegistration(input){if(!object(input))throw new TypeError('Registro invalido.');exactKeys(input,REGISTRATION_KEYS,'de registro');const out={protocol_version:safeInteger(input.protocol_version,'protocol_version'),telemetry_schema_version:safeInteger(input.telemetry_schema_version,'telemetry_schema_version'),installation_id:safeText(input.installation_id,'installation_id',{scan:false}),app_version:safeText(input.app_version,'app_version'),release_id:safeText(input.release_id,'release_id',{scan:false}),database_schema_version:safeInteger(input.database_schema_version,'database_schema_version')};if(out.protocol_version!==1||out.telemetry_schema_version!==1)throw Object.assign(new Error('Versao de protocolo/schema nao suportada.'),{statusCode:422});return out;}
function validateMap(input,allowed,type){if(input==null)return{};if(!object(input))throw new TypeError(`${type} invalido.`);const out={};for(const [key,value] of Object.entries(input)){if(!allowed.has(key))throw new Error(`Campo ${type} desconhecido: ${key}.`);if(FORBIDDEN.test(key))throw new Error(`Campo sensivel/proibido: ${key}.`);if(type==='dimensions')out[key]=safeText(value,key);else{const n=Number(value);if(!Number.isFinite(n))throw new TypeError(`${key} deve ser numerico.`);out[key]=n;}}return out;}
function validateEvent(input){if(!object(input))throw new TypeError('Evento invalido.');exactKeys(input,EVENT_KEYS,'de evento');const schema=EVENT_SCHEMAS[input.event_name];if(!schema)throw new Error(`Evento desconhecido: ${String(input.event_name||'')}.`);const out={};for(const field of ['schema_version','database_schema_version'])out[field]=safeInteger(input[field],field);if(out.schema_version!==1)throw Object.assign(new Error('schema_version nao suportado.'),{statusCode:422});for(const field of ['event_id','event_name','occurred_at','installation_id','terminal_id','session_id','app_version','release_id'])out[field]=safeText(input[field],field,{scan:!TECHNICAL_IDS.has(field)});out.dimensions=validateMap(input.dimensions,new Set(schema.dimensions),'dimensions');out.measurements=validateMap(input.measurements,new Set(schema.measurements),'measurements');if(ERROR_EVENTS.has(out.event_name)&&out.dimensions.fingerprint!==undefined&&!/^ERR-[0-9a-f]{8,64}$/i.test(out.dimensions.fingerprint))throw new Error('Fingerprint invalido.');return out;}
function validateBatch(input){if(!object(input))throw new TypeError('Batch invalido.');exactKeys(input,new Set(['schema_version','events']),'de batch');if(safeInteger(input.schema_version,'schema_version')!==1)throw Object.assign(new Error('schema_version nao suportado.'),{statusCode:422});if(!Array.isArray(input.events))throw new TypeError('events deve ser array.');if(input.events.length>50)throw Object.assign(new Error('Batch excede 50 eventos.'),{statusCode:413});return{schema_version:1,events:input.events.map(validateEvent)};}
export{EVENT_SCHEMAS,ERROR_EVENTS,validateRegistration,validateEvent,validateBatch};
