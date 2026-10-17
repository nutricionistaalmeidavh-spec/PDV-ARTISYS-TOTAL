'use strict';
const {principalFromActor}=require('../auth/principal-resolver');

const {randomUUID}=require('node:crypto');
const {writeAudit}=require('../audit-log');
const {runHardwareMigrations}=require('../database/hardware-migrations');
const {runSaleObservationMigrations}=require('../database/sale-observation-migrations');

const STATUSES=new Set(['PROTOCOL_VERIFIED','FIELD_VERIFIED','UNTESTED_MODEL','PARTIAL','UNSUPPORTED']);
const LEGACY_STATUS_MAP=Object.freeze({VERIFIED:'FIELD_VERIFIED',BLOCKED_EXTERNAL:'UNTESTED_MODEL'});
const KINDS=new Set(['PRINTER','SCALE','DRAWER','SCANNER','OTHER']);
function required(value,label){const text=String(value||'').trim();if(!text)throw new Error(`${label} obrigatorio.`);return text;}
function parseConfiguration(value){if(!value)return{};if(typeof value==='object')return value;try{return JSON.parse(value);}catch{return{};}}
function normalizeStatus(value){
  const raw=String(value||'').trim().toUpperCase();
  const normalized=LEGACY_STATUS_MAP[raw]||raw;
  if(!STATUSES.has(normalized))throw new Error('Status de homologacao invalido.');
  return normalized;
}

function createHardwareCompatibilityService({db,authorization=null,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db)throw new TypeError('db is required.');
  runHardwareMigrations(db,now);
  runSaleObservationMigrations(db,now);
  function map(row){return row&&{id:row.id,manufacturer:row.manufacturer,model:row.model,kind:row.kind,connection:row.connection,driver:row.driver,configuration:parseConfiguration(row.configuration_json),os:row.os,testedAt:row.tested_at,status:normalizeStatus(row.status),result:row.result,limitations:row.limitations,evidence:row.evidence,createdAt:row.created_at,updatedAt:row.updated_at};}
  function recordEvidence(input={},actor={}){
    if(authorization)authorization.require({principal:principalFromActor(actor),capability:'settings.manage'});
    const manufacturer=required(input.manufacturer,'Fabricante');const model=required(input.model,'Modelo');const kind=String(input.kind||'OTHER').toUpperCase();if(!KINDS.has(kind))throw new Error('Tipo de periferico invalido.');const connection=required(input.connection,'Conexao');const os=required(input.os,'Sistema operacional');const testedAt=required(input.testedAt,'Data do teste');if(Number.isNaN(new Date(testedAt).getTime()))throw new Error('Data do teste invalida.');const status=normalizeStatus(input.status);const result=required(input.result,'Resultado do teste');const evidence=String(input.evidence||'').trim()||null;if(['PROTOCOL_VERIFIED','FIELD_VERIFIED'].includes(status)&&!evidence)throw new Error('Evidencia obrigatoria para status verificado.');
    const id=String(input.id||idFactory('hardware-evidence'));const ts=now();const configuration=input.configuration&&typeof input.configuration==='object'?input.configuration:{};
    db.prepare(`INSERT INTO hardware_compatibility_evidence(id,manufacturer,model,kind,connection,driver,configuration_json,os,tested_at,status,result,limitations,evidence,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET manufacturer=excluded.manufacturer,model=excluded.model,kind=excluded.kind,connection=excluded.connection,driver=excluded.driver,configuration_json=excluded.configuration_json,os=excluded.os,tested_at=excluded.tested_at,status=excluded.status,result=excluded.result,limitations=excluded.limitations,evidence=excluded.evidence,updated_at=excluded.updated_at`).run(id,manufacturer,model,kind,connection,String(input.driver||'').trim()||null,JSON.stringify(configuration),os,new Date(testedAt).toISOString(),status,result,String(input.limitations||'').trim()||null,evidence,ts,ts);
    writeAudit(db,{action:'hardware.compatibility.record',entity:'hardware_compatibility',entityId:id,actor,context:{manufacturer,model,kind,status,testedAt}},now);return map(db.prepare('SELECT * FROM hardware_compatibility_evidence WHERE id=?').get(id));
  }
  function listEvidence({status=null,kind=null}={}){
    const clauses=[];const params=[];let normalizedStatus=null;
    if(status)normalizedStatus=normalizeStatus(status);
    if(kind){const value=String(kind).toUpperCase();if(!KINDS.has(value))throw new Error('Tipo de periferico invalido.');clauses.push('kind=?');params.push(value);}
    const rows=db.prepare(`SELECT * FROM hardware_compatibility_evidence${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY manufacturer,model,tested_at DESC,id`).all(...params).map(map);
    return normalizedStatus?rows.filter(item=>item.status===normalizedStatus):rows;
  }
  return{recordEvidence,listEvidence,STATUSES,KINDS};
}
module.exports={createHardwareCompatibilityService,STATUSES,KINDS,normalizeStatus,LEGACY_STATUS_MAP};
