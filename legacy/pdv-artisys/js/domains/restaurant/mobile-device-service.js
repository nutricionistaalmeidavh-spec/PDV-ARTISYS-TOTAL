'use strict';

const { randomBytes, randomUUID, scryptSync, timingSafeEqual } = require('node:crypto');
const { writeAudit } = require('../../core/audit-log');

const DEVICE_TYPES = new Set(['WAITER','KITCHEN']);
const DEVICE_STATUSES = new Set(['ACTIVE','BLOCKED']);

function hashSecret(secret,salt){return scryptSync(String(secret),String(salt),32).toString('hex');}
function safeEqualHex(left,right){try{const a=Buffer.from(String(left),'hex');const b=Buffer.from(String(right),'hex');return a.length===b.length&&timingSafeEqual(a,b);}catch{return false;}}
function canonicalSurface(type){const value=String(type||'').trim().toUpperCase();if(value==='WAITER')return'waiter';if(value==='KITCHEN')return'kitchen';return value.toLowerCase().replace(/_/g,'-');}
function scopeFor(){return{type:'establishment',id:null};}

function createMobileDeviceService({db,now=()=>new Date().toISOString(),idFactory=prefix=>`${prefix}-${randomUUID()}`,secretFactory=()=>randomBytes(32).toString('base64url')}={}){
  if(!db)throw new TypeError('Database is required.');

  function stationIdsForDevice(id){try{return db.prepare('SELECT station_id AS stationId FROM mobile_device_kitchen_stations WHERE device_id=? ORDER BY station_id').all(String(id)).map(row=>row.stationId);}catch{return [];}}
  function mapDevice(row){
    if(!row)return null;
    const deviceType=row.device_type;
    const surface=row.surface||canonicalSurface(deviceType);
    const scope=row.scope_type?{type:row.scope_type,id:row.scope_id||null}:scopeFor(deviceType,row.table_id);
    return {id:row.id,name:row.name,deviceType,surface,scope,tableId:row.table_id,userId:row.user_id,stationIds:deviceType==='KITCHEN'?stationIdsForDevice(row.id):[],status:row.status,lastSeenAt:row.last_seen_at,createdBy:row.created_by,createdAt:row.created_at,updatedAt:row.updated_at};
  }

  function getDevice(id){return mapDevice(db.prepare('SELECT * FROM mobile_devices WHERE id=?').get(String(id)));}
  function requireDevice(id){const row=db.prepare('SELECT * FROM mobile_devices WHERE id=?').get(String(id));if(!row)throw new Error('Dispositivo nao encontrado.');return row;}

  function validateBinding(type,tableId,userId,stationIds=[]){
    if(type==='WAITER'&&userId){
      const user=db.prepare("SELECT id FROM users WHERE id=? AND active=1").get(String(userId));
      if(!user)throw new Error('Usuario do garcom nao encontrado ou inativo.');
    }
    if(type==='KITCHEN'){
      for(const stationId of stationIds){
        const station=db.prepare('SELECT id FROM kitchen_stations WHERE id=? AND active=1').get(String(stationId));
        if(!station)throw new Error('Setor de producao nao encontrado ou inativo.');
      }
    }
  }

  function createDevice(input={},actor={}){
    const name=String(input.name||'').trim();if(!name)throw new Error('Nome do dispositivo obrigatorio.');
    const requestedType=String(input.deviceType||'').trim().toUpperCase();if(!DEVICE_TYPES.has(requestedType))throw new Error('Tipo de dispositivo invalido.');
    const tableId=null;const userId=input.userId?String(input.userId):null;
    const stationIds=[...new Set((Array.isArray(input.stationIds)?input.stationIds:[]).map(value=>String(value||'').trim()).filter(Boolean))];
    validateBinding(requestedType,tableId,userId,stationIds);
    const id=String(input.id||idFactory('mobile')).trim();const credential=String(secretFactory());const salt=randomBytes(16).toString('hex');const timestamp=now();
    const storedType=requestedType;
    const surface=canonicalSurface(requestedType);const scope=scopeFor();
    db.prepare(`INSERT INTO mobile_devices(id,name,device_type,surface,scope_type,scope_id,table_id,user_id,credential_hash,credential_salt,status,last_seen_at,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,'ACTIVE',NULL,?,?,?)`).run(id,name,storedType,surface,scope.type,scope.id,tableId,userId,hashSecret(credential,salt),salt,actor?.userId||null,timestamp,timestamp);
    if(requestedType==='KITCHEN'&&stationIds.length){
      const insertStation=db.prepare('INSERT INTO mobile_device_kitchen_stations(device_id,station_id,created_at) VALUES(?,?,?)');
      for(const stationId of stationIds)insertStation.run(id,stationId,timestamp);
    }
    writeAudit(db,{action:'restaurant.mobile.create',entity:'mobile_device',entityId:id,actor,context:{name,deviceType:requestedType,tableId,userId,stationIds}},now);
    return {...getDevice(id),credential};
  }

  function listDevices({deviceType=null,status=null}={}){
    const clauses=[];const params=[];
    if(deviceType){
      const type=String(deviceType).toUpperCase();if(!DEVICE_TYPES.has(type))throw new Error('Tipo de dispositivo invalido.');
      clauses.push('device_type=?');params.push(type);
    }
    if(status){const value=String(status).toUpperCase();if(!DEVICE_STATUSES.has(value))throw new Error('Status de dispositivo invalido.');clauses.push('status=?');params.push(value);}
    return db.prepare(`SELECT * FROM mobile_devices${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY name,id`).all(...params).map(mapDevice);
  }

  function authenticate(deviceId,credential){
    const row=db.prepare('SELECT * FROM mobile_devices WHERE id=?').get(String(deviceId||''));
    if(!row||row.status!=='ACTIVE'||!credential)return{ok:false,reason:row?.status==='BLOCKED'?'blocked':'invalid'};
    const candidate=hashSecret(credential,row.credential_salt);if(!safeEqualHex(candidate,row.credential_hash))return{ok:false,reason:'invalid'};
    const timestamp=now();db.prepare('UPDATE mobile_devices SET last_seen_at=?,updated_at=? WHERE id=?').run(timestamp,timestamp,row.id);
    return{ok:true,device:mapDevice({...row,last_seen_at:timestamp,updated_at:timestamp})};
  }

  function authenticatePrincipal(deviceId,credential){
    const auth=authenticate(deviceId,credential);if(!auth.ok)return auth;
    const device=auth.device;
    return{ok:true,device,principal:{kind:'device',id:device.id,surface:device.surface,userId:device.userId||null,scope:device.scope}};
  }

  function setKitchenStations(deviceId,stationIds=[],actor={}){
    const row=requireDevice(deviceId);
    const deviceType=mapDevice(row)?.deviceType;
    if(deviceType!=='KITCHEN')throw new Error('Apenas dispositivos KDS podem ser vinculados a setores de producao.');
    const normalized=[...new Set((Array.isArray(stationIds)?stationIds:[]).map(value=>String(value||'').trim()).filter(Boolean))];
    validateBinding('KITCHEN',null,null,normalized);
    const timestamp=now();
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare('DELETE FROM mobile_device_kitchen_stations WHERE device_id=?').run(row.id);
      const insert=db.prepare('INSERT INTO mobile_device_kitchen_stations(device_id,station_id,created_at) VALUES(?,?,?)');
      for(const stationId of normalized)insert.run(row.id,stationId,timestamp);
      db.exec('COMMIT');
    }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
    writeAudit(db,{action:'restaurant.mobile.kitchen-stations',entity:'mobile_device',entityId:row.id,actor,context:{stationIds:normalized}},now);
    return getDevice(row.id);
  }

  function setStatus(deviceId,status,actor={}){
    const normalized=String(status||'').toUpperCase();if(!DEVICE_STATUSES.has(normalized))throw new Error('Status de dispositivo invalido.');
    const row=requireDevice(deviceId);db.prepare('UPDATE mobile_devices SET status=?,updated_at=? WHERE id=?').run(normalized,now(),row.id);
    writeAudit(db,{action:'restaurant.mobile.status',entity:'mobile_device',entityId:row.id,actor,context:{from:row.status,to:normalized}},now);
    return getDevice(row.id);
  }

  function rotateCredential(deviceId,actor={}){
    const row=requireDevice(deviceId);const credential=String(secretFactory());const salt=randomBytes(16).toString('hex');const timestamp=now();
    db.prepare("UPDATE mobile_devices SET credential_hash=?,credential_salt=?,status='ACTIVE',updated_at=? WHERE id=?").run(hashSecret(credential,salt),salt,timestamp,row.id);
    writeAudit(db,{action:'restaurant.mobile.rotate',entity:'mobile_device',entityId:row.id,actor,context:{}},now);
    return{...getDevice(row.id),credential};
  }

  return{createDevice,listDevices,getDevice,authenticate,authenticatePrincipal,setKitchenStations,setStatus,rotateCredential,DEVICE_TYPES,DEVICE_STATUSES};
}

module.exports={createMobileDeviceService};
