'use strict';
function storeDateKey(timestamp,timeZone='America/Sao_Paulo'){
  const date=new Date(timestamp);if(!Number.isFinite(date.getTime()))throw new Error('Data do pedido inválida.');
  try{const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);return ['year','month','day'].map(type=>parts.find(part=>part.type===type).value).join('-');}
  catch(error){if(error instanceof RangeError&&timeZone!=='America/Sao_Paulo')return storeDateKey(timestamp);throw error;}
}
function storeTimeZone(db){try{const row=db.prepare("SELECT value_json FROM app_settings WHERE scope='global' AND setting_key='store.timeZone'").get();return row?JSON.parse(row.value_json):'America/Sao_Paulo';}catch{return 'America/Sao_Paulo';}}
module.exports={storeDateKey,storeTimeZone};
