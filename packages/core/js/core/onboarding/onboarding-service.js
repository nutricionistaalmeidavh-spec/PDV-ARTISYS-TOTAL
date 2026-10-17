'use strict';
const {principalFromActor}=require('../auth/principal-resolver');

const {writeAudit}=require('../audit-log');
const {MODULES,getModuleDefinition}=require('../modules/module-registry');

const SEGMENTS=Object.freeze({
  FOOD:['FOOD'],
  WHOLESALE:['WHOLESALE'],
  GENERIC:[],
  RESTAURANT:['FOOD'],
  PIZZERIA:['FOOD'],
  FAST_FOOD:['FOOD'],
  BAKERY:['FOOD'],
  MARKET:[],
  RETAIL:[]
});

function createOnboardingService({db,modules,authorization=null,now=()=>new Date().toISOString()}={}){
  if(!db||!modules)throw new TypeError('db and modules are required.');
  const normalizeSegment=value=>{const segment=String(value||'GENERIC').trim().toUpperCase();if(!SEGMENTS[segment])throw new Error('Segmento inicial invalido.');return segment;};
  function getState(){
    const row=db.prepare("SELECT * FROM onboarding_state WHERE id='primary'").get();
    if(!row)return{completed:false,businessName:null,segment:null,moduleIds:[],updatedAt:null,completedAt:null};
    let moduleIds=[];try{moduleIds=JSON.parse(row.module_ids_json||'[]');}catch{}
    return{completed:Boolean(row.completed),businessName:row.business_name,segment:row.segment,moduleIds:Array.isArray(moduleIds)?moduleIds:[],updatedAt:row.updated_at,completedAt:row.completed_at};
  }
  function recommend(segment){const normalized=normalizeSegment(segment);return{segment:normalized,moduleIds:[...SEGMENTS[normalized]]};}
  function complete(input={},actor={}){
    if(authorization)authorization.require({principal:principalFromActor(actor),capability:'modules.manage'});
    const segment=normalizeSegment(input.segment);const businessName=String(input.businessName||'').trim()||'Estabelecimento';const requested=Array.isArray(input.moduleIds)?[...new Set(input.moduleIds.map(id=>String(id).trim().toUpperCase()))]:recommend(segment).moduleIds;
    for(const id of requested)if(!getModuleDefinition(id))throw new Error(`Modulo desconhecido: ${id}.`);
    const requestedSet=new Set(requested);
    const enabled=modules.enabledIds();
    for(const definition of [...MODULES].reverse())if(enabled.includes(definition.id)&&!requestedSet.has(definition.id))modules.setEnabled(definition.id,false,actor);
    const pending=new Set(requested);
    let progress=true;
    while(pending.size&&progress){progress=false;for(const id of [...pending]){const definition=getModuleDefinition(id);if((definition.dependsOn||[]).every(dep=>modules.isEnabled(dep)||requestedSet.has(dep)&&!pending.has(dep))){try{modules.setEnabled(id,true,actor);pending.delete(id);progress=true;}catch{}}}}
    if(pending.size){for(const id of pending)modules.setEnabled(id,true,actor);}
    const applied=modules.enabledIds();const ts=now();
    db.prepare(`INSERT INTO onboarding_state(id,business_name,segment,module_ids_json,completed,completed_at,updated_at) VALUES('primary',?,?,?,1,?,?)
      ON CONFLICT(id) DO UPDATE SET business_name=excluded.business_name,segment=excluded.segment,module_ids_json=excluded.module_ids_json,completed=1,completed_at=excluded.completed_at,updated_at=excluded.updated_at`).run(businessName,segment,JSON.stringify(applied),ts,ts);
    writeAudit(db,{action:'onboarding.complete',entity:'onboarding',entityId:'primary',actor,context:{businessName,segment,moduleIds:applied}},now);return getState();
  }
  return{getState,recommend,complete,SEGMENTS};
}

module.exports={createOnboardingService,SEGMENTS};
