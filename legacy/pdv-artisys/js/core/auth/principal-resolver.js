'use strict';

function principalFromActor(actor={}){
  if(!actor||typeof actor!=='object')return null;
  const kind=String(actor.kind||'').trim().toLowerCase();
  if(kind==='system')return{kind:'system',id:'system'};
  if(kind==='public-resource'&&actor.id)return{...actor,kind:'public-resource',id:String(actor.id)};
  if(kind==='device'&&actor.id)return{...actor,kind:'device',id:String(actor.id)};
  const userId=String(actor.id||actor.userId||'').trim();
  if(kind==='human'&&userId)return{kind:'human',id:userId};
  if(!kind&&userId)return{kind:'human',id:userId};
  return null;
}

function principalFromSession(session={}){
  const userId=String(session?.userId||'').trim();
  return userId?{kind:'human',id:userId}:null;
}

function actorFromSession(session={}){
  return{
    kind:'human',
    userId:String(session?.userId||''),
    terminalId:session?.terminalId||null
  };
}

module.exports={principalFromActor,principalFromSession,actorFromSession};
