'use strict';

const {writeAudit}=require('../audit-log');

const ACCESS_ACTION_PREFIXES=Object.freeze([
  'auth.','profile.','user.','restaurant.mobile.','module.','settings.'
]);

function createAccessSecurityService({db,now=()=>new Date().toISOString()}={}){
  if(!db)throw new TypeError('Database is required.');

  function auditActor(actor={}){
    const userId=actor?.userId||actor?.id||null;
    const role=actor?.kind||actor?.role||(userId?'human':'system');
    return{userId,role};
  }

  function record({action,entity='access',entityId=null,actor={},context=null}={}){
    return writeAudit(db,{action,entity,entityId,actor:auditActor(actor),context},now);
  }

  function listRecent({limit=50}={}){
    const safeLimit=Math.max(1,Math.min(200,Number(limit)||50));
    const rows=db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(safeLimit*4);
    return rows
      .filter(row=>ACCESS_ACTION_PREFIXES.some(prefix=>String(row.action||'').startsWith(prefix)))
      .slice(0,safeLimit)
      .map(row=>({
        id:row.id,
        action:row.action,
        entity:row.entity,
        entityId:row.entity_id,
        actorId:row.actor_id,
        actorKind:row.actor_role,
        context:row.context_json?JSON.parse(row.context_json):null,
        createdAt:row.created_at
      }));
  }

  return Object.freeze({record,listRecent});
}

module.exports={createAccessSecurityService,ACCESS_ACTION_PREFIXES};
