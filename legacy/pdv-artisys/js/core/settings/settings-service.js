'use strict';

const {writeAudit}=require('../audit-log');
const {MODULES,getModuleDefinition}=require('../modules/module-registry');
const {principalFromActor}=require('../auth/principal-resolver');

const SENSITIVE_KEY=/(password|passwd|senha|token|secret|segredo|authorization|credential|api[-_.]?key|private[-_.]?key)/i;
const MODULE_SETTING=/^modules\.([A-Z_]+)\.enabled$/;

function ensureSettingsTable(db){
  db.exec(`CREATE TABLE IF NOT EXISTS app_settings (
    scope TEXT NOT NULL,
    setting_key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    value_type TEXT NOT NULL,
    updated_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (scope,setting_key)
  );
  CREATE INDEX IF NOT EXISTS idx_app_settings_key ON app_settings(setting_key,scope);`);
}

function typeOfValue(value){
  if(value===null)return'null';
  if(Array.isArray(value))return'array';
  const type=typeof value;
  if(!['string','number','boolean','object'].includes(type))throw new Error('Tipo de configuracao nao suportado.');
  if(type==='number'&&!Number.isFinite(value))throw new Error('Numero de configuracao invalido.');
  return type;
}

function assertPublicKey(key){
  const normalized=String(key||'').trim();
  if(!normalized||normalized.length>120||!/^[A-Za-z0-9_.:-]+$/.test(normalized))throw new Error('Chave de configuracao invalida.');
  if(SENSITIVE_KEY.test(normalized))throw new Error('Configuracao sensivel/segredo deve usar armazenamento protegido, nao app_settings.');
  return normalized;
}

function assertScope(scope){
  const value=String(scope||'global').trim();
  if(!value||value.length>160||!/^[A-Za-z0-9_.:-]+$/.test(value))throw new Error('Escopo de configuracao invalido.');
  return value;
}

function mapRow(row){
  if(!row)return null;
  let value=null;try{value=JSON.parse(row.value_json);}catch{value=null;}
  return{scope:row.scope,key:row.setting_key,value,type:row.value_type,updatedBy:row.updated_by,createdAt:row.created_at,updatedAt:row.updated_at};
}

function moduleState(db,moduleId){
  const definition=getModuleDefinition(moduleId);
  if(!definition)throw new Error(`Modulo desconhecido: ${moduleId}.`);
  const row=db.prepare('SELECT value_json FROM app_settings WHERE scope=? AND setting_key=?').get('global',`modules.${moduleId}.enabled`);
  if(!row)return Boolean(definition.defaultEnabled);
  try{return Boolean(JSON.parse(row.value_json));}catch{return Boolean(definition.defaultEnabled);}
}

function validateModuleSetting(db,key,value,scope){
  const match=key.match(MODULE_SETTING);if(!match)return null;
  const moduleId=match[1];const definition=getModuleDefinition(moduleId);
  if(!definition)throw new Error(`Modulo desconhecido: ${moduleId}.`);
  if(scope!=='global')throw new Error('Modulos so podem ser configurados no escopo global.');
  if(typeof value!=='boolean')throw new Error('Estado do modulo deve ser booleano.');
  if(value){
    for(const dependency of definition.dependsOn||[])if(!moduleState(db,dependency))throw new Error(`Ative o modulo ${dependency} antes de ${moduleId}.`);
  }else{
    const dependent=MODULES.find(item=>(item.dependsOn||[]).includes(moduleId)&&moduleState(db,item.id));
    if(dependent)throw new Error(`Desative o modulo ${dependent.id} antes de ${moduleId}.`);
  }
  return{moduleId,definition};
}

function createSettingsService({db,authorization=null,now=()=>new Date().toISOString()}={}){
  if(!db)throw new TypeError('Database is required.');
  ensureSettingsTable(db);

  function get(key,{scope='global',defaultValue=null}={}){
    const safeKey=assertPublicKey(key);const safeScope=assertScope(scope);
    const row=db.prepare('SELECT * FROM app_settings WHERE scope=? AND setting_key=?').get(safeScope,safeKey);
    return row?mapRow(row).value:defaultValue;
  }

  function list({scope=null,prefix=''}={}){
    const clauses=[];const params=[];
    if(scope){clauses.push('scope=?');params.push(assertScope(scope));}
    if(prefix){clauses.push('setting_key LIKE ?');params.push(`${String(prefix)}%`);}
    return db.prepare(`SELECT * FROM app_settings${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY setting_key,scope`).all(...params).map(mapRow);
  }

  function mayWrite(key,scope,actor){
    const principal=principalFromActor(actor);
    if(!principal)return false;
    if(principal.kind==='system')return true;
    if(principal.kind==='human'&&key.startsWith('ui.')&&scope===`user:${principal.id}`)return true;
    if(!authorization)return true;
    const capability=MODULE_SETTING.test(String(key))?'modules.manage':'settings.manage';
    return authorization.can({principal,capability});
  }

  function set(key,value,{scope='global',actor={}}={}){
    const safeKey=assertPublicKey(key);const safeScope=assertScope(scope);const type=typeOfValue(value);
    if(!mayWrite(safeKey,safeScope,actor))throw new Error('Permissao insuficiente para alterar configuracao.');
    const moduleSetting=validateModuleSetting(db,safeKey,value,safeScope);
    const timestamp=now();
    db.prepare(`INSERT INTO app_settings(scope,setting_key,value_json,value_type,updated_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(scope,setting_key) DO UPDATE SET value_json=excluded.value_json,value_type=excluded.value_type,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .run(safeScope,safeKey,JSON.stringify(value),type,actor?.userId||actor?.id||null,timestamp,timestamp);
    if(moduleSetting)writeAudit(db,{action:'module.toggle',entity:'module',entityId:moduleSetting.moduleId,actor,context:{enabled:value}},now);
    else writeAudit(db,{action:'settings.update',entity:'setting',entityId:`${safeScope}:${safeKey}`,actor,context:{key:safeKey,scope:safeScope,type}},now);
    return mapRow(db.prepare('SELECT * FROM app_settings WHERE scope=? AND setting_key=?').get(safeScope,safeKey));
  }

  function remove(key,{scope='global',actor={}}={}){
    const safeKey=assertPublicKey(key);const safeScope=assertScope(scope);
    if(!mayWrite(safeKey,safeScope,actor))throw new Error('Permissao insuficiente para alterar configuracao.');
    const match=safeKey.match(MODULE_SETTING);if(match)throw new Error('Estado de modulo deve ser alterado explicitamente para true ou false.');
    const result=db.prepare('DELETE FROM app_settings WHERE scope=? AND setting_key=?').run(safeScope,safeKey);
    if(result.changes)writeAudit(db,{action:'settings.remove',entity:'setting',entityId:`${safeScope}:${safeKey}`,actor,context:{key:safeKey,scope:safeScope}},now);
    return Boolean(result.changes);
  }

  return{get,list,set,remove};
}

module.exports={createSettingsService,ensureSettingsTable,assertPublicKey,SENSITIVE_KEY,MODULE_SETTING,validateModuleSetting};
