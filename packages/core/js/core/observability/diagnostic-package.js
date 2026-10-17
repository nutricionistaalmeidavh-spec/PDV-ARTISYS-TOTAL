'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {sanitizeAuditPayload,writeAudit}=require('../audit-log');
const {principalFromActor}=require('../auth/principal-resolver');

const CRC_TABLE=(()=>{const table=new Uint32Array(256);for(let n=0;n<256;n+=1){let c=n;for(let k=0;k<8;k+=1)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);table[n]=c>>>0;}return table;})();
function crc32(buffer){let crc=0xFFFFFFFF;for(const byte of buffer)crc=CRC_TABLE[(crc^byte)&0xFF]^(crc>>>8);return (crc^0xFFFFFFFF)>>>0;}
function dosDateTime(dateValue){const d=new Date(dateValue);const year=Math.max(1980,d.getUTCFullYear());const dosDate=((year-1980)<<9)|((d.getUTCMonth()+1)<<5)|d.getUTCDate();const dosTime=(d.getUTCHours()<<11)|(d.getUTCMinutes()<<5)|Math.floor(d.getUTCSeconds()/2);return{dosDate,dosTime};}
function jsonBuffer(value){return Buffer.from(`${JSON.stringify(sanitizeAuditPayload(value),null,2)}\n`,'utf8');}

function buildStoredZip(entries,createdAt){
  const localParts=[];const centralParts=[];let offset=0;const stamp=dosDateTime(createdAt);
  for(const entry of entries){
    const name=Buffer.from(String(entry.name),'utf8');const data=Buffer.isBuffer(entry.data)?entry.data:Buffer.from(entry.data);const crc=crc32(data);
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x0800,6);local.writeUInt16LE(0,8);local.writeUInt16LE(stamp.dosTime,10);local.writeUInt16LE(stamp.dosDate,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);local.writeUInt16LE(0,28);
    localParts.push(local,name,data);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x0800,8);central.writeUInt16LE(0,10);central.writeUInt16LE(stamp.dosTime,12);central.writeUInt16LE(stamp.dosDate,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt16LE(0,30);central.writeUInt16LE(0,32);central.writeUInt16LE(0,34);central.writeUInt16LE(0,36);central.writeUInt32LE(0,38);central.writeUInt32LE(offset,42);centralParts.push(central,name);
    offset+=local.length+name.length+data.length;
  }
  const centralSize=centralParts.reduce((n,b)=>n+b.length,0);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(0,4);end.writeUInt16LE(0,6);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(centralSize,12);end.writeUInt32LE(offset,16);end.writeUInt16LE(0,20);
  return Buffer.concat([...localParts,...centralParts,end]);
}

function createDiagnosticPackage({db,health,settings,logger,authorization=null,diagnosticsDir,version='0.0.0',now=()=>new Date().toISOString(),idFactory=()=>`diag-${randomUUID()}`}={}){
  if(!db||!health||!settings||!logger||!diagnosticsDir)throw new TypeError('db, health, settings, logger and diagnosticsDir are required.');
  fs.mkdirSync(diagnosticsDir,{recursive:true});
  function createPackage({actor={}}={}){
    if(authorization)authorization.require({principal:principalFromActor(actor),capability:'settings.manage'});
    const createdAt=now();const id=String(idFactory('diag'));const schemaVersion=Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get().version||0);
    const contents=['health.json','settings-public.json','migrations.json','logs.json'];
    const manifest={id,product:'ArtiSys PDV',version:String(version),schemaVersion,createdAt,contents,safeSupportBundle:true};
    const migrations=db.prepare('SELECT version,name,applied_at AS appliedAt FROM schema_migrations ORDER BY version').all();
    const entries=[
      {name:'manifest.json',data:jsonBuffer(manifest)},
      {name:'health.json',data:jsonBuffer(health.snapshot())},
      {name:'settings-public.json',data:jsonBuffer(settings.list())},
      {name:'migrations.json',data:jsonBuffer(migrations)},
      {name:'logs.json',data:jsonBuffer(logger.list({limit:1000}))}
    ];
    const zip=buildStoredZip(entries,createdAt);const fileName=`${id}.zip`;const filePath=path.join(diagnosticsDir,fileName);fs.writeFileSync(filePath,zip);const sha256=createHash('sha256').update(zip).digest('hex');
    writeAudit(db,{action:'diagnostics.create',entity:'diagnostics',entityId:id,actor,context:{fileName,sha256,size:zip.length}},now);
    return{id,fileName,filePath,sha256,size:zip.length,createdAt};
  }
  return{createPackage};
}

module.exports={createDiagnosticPackage,buildStoredZip,crc32};