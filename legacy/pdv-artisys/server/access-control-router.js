'use strict';

const {PERMISSIONS,PERMISSION_GROUPS}=require('../js/core/auth/permission-registry');
const {actorFromSession,principalFromSession}=require('../js/core/auth/principal-resolver');

class AccessControlHttpError extends Error{constructor(statusCode,message){super(message);this.statusCode=statusCode;}}

function bearer(request){const value=String(request.headers.authorization||'');return value.startsWith('Bearer ')?value.slice(7).trim():'';}
function json(response,statusCode,payload){response.writeHead(statusCode,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(payload));}
async function body(request,limit=1024*1024){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>limit)throw new AccessControlHttpError(413,'Corpo da requisicao excede o limite permitido.');chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AccessControlHttpError(400,'JSON invalido.');}}

function createAccessControlRouter({runtime,sessionStore=null,requireTerminalAuth=false,bodyLimitBytes=1024*1024}={}){
  if(!runtime?.authorization||!runtime?.profiles)throw new TypeError('authorization/profile runtime services are required.');
  const sessions=sessionStore||new Map();

  function sessionFor(request){
    const token=bearer(request);const session=sessions.get(token);
    if(!session||session.expiresAt<=Date.now()){if(token)sessions.delete(token);throw new AccessControlHttpError(401,'Sessao invalida ou expirada.');}
    const user=runtime.catalog.getUser(session.userId);
    if(!user||!user.active){sessions.delete(token);throw new AccessControlHttpError(401,'Sessao invalida ou expirada.');}
    if(requireTerminalAuth){const terminal=runtime.terminals.listTerminals().find(item=>item.terminalId===session.terminalId);if(!terminal||terminal.status!=='ACTIVE')throw new AccessControlHttpError(401,'Terminal nao autorizado.');}
    session.lastSeenAt=Date.now();
    return{token,session,user,actor:actorFromSession(session),principal:principalFromSession(session)};
  }

  function requireCapability(context,capability){
    try{runtime.authorization.require({principal:context.principal,capability});}
    catch(error){throw new AccessControlHttpError(error.statusCode||403,error.message||'Permissao insuficiente.');}
  }

  function revokeUserSessions(userId){
    for(const [token,session] of sessions.entries())if(String(session.userId)===String(userId))sessions.delete(token);
  }

  function revokeProfileSessions(profileId){
    const ids=runtime.db.prepare('SELECT id FROM users WHERE profile_id=?').all(String(profileId)).map(row=>String(row.id));
    for(const id of ids)revokeUserSessions(id);
  }

  function securitySnapshot(){
    const users=runtime.catalog.listUsers({includeInactive:true});
    const devices=runtime.mobileDevices.listDevices({});
    const activeSessions=[...sessions.values()].filter(session=>session.expiresAt>Date.now()).map(session=>({
      id:session.id||null,userId:session.userId,name:session.name||null,terminalId:session.terminalId||null,
      createdAt:session.createdAt?new Date(session.createdAt).toISOString():null,
      lastSeenAt:session.lastSeenAt?new Date(session.lastSeenAt).toISOString():null,
      expiresAt:new Date(session.expiresAt).toISOString()
    }));
    const adminProfile=runtime.profiles.getProfileBySystemKey('admin');
    return{
      counts:{
        people:users.filter(user=>user.active).length,
        administrators:adminProfile?users.filter(user=>user.active&&user.profileId===adminProfile.id).length:0,
        devices:devices.filter(device=>device.status==='ACTIVE').length,
        blockedDevices:devices.filter(device=>device.status==='BLOCKED').length,
        sessions:activeSessions.length
      },
      sessions:activeSessions,
      recent:runtime.accessSecurity?.listRecent({limit:30})||[]
    };
  }

  return async function accessControlRouter(request,response){
    const url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`);const pathname=url.pathname;
    if(!pathname.startsWith('/api/v1/access/'))return false;
    try{
      const context=sessionFor(request);

      if(request.method==='GET'&&pathname==='/api/v1/access/permissions'){
        requireCapability(context,'profiles.view');json(response,200,{groups:PERMISSION_GROUPS,permissions:PERMISSIONS});return true;
      }
      if(request.method==='GET'&&pathname==='/api/v1/access/profiles'){
        requireCapability(context,'profiles.view');json(response,200,runtime.profiles.listProfiles({includeInactive:url.searchParams.get('includeInactive')==='true'}));return true;
      }
      if(request.method==='POST'&&pathname==='/api/v1/access/profiles'){
        requireCapability(context,'profiles.create');json(response,201,runtime.profiles.createProfile(await body(request,bodyLimitBytes),context.actor));return true;
      }
      const profileMatch=pathname.match(/^\/api\/v1\/access\/profiles\/([^/]+)$/);
      if(profileMatch&&request.method==='PATCH'){
        requireCapability(context,'profiles.edit');const id=decodeURIComponent(profileMatch[1]);const updated=runtime.profiles.updateProfile(id,await body(request,bodyLimitBytes),context.actor);revokeProfileSessions(id);json(response,200,updated);return true;
      }
      if(profileMatch&&request.method==='DELETE'){
        requireCapability(context,'profiles.delete');const id=decodeURIComponent(profileMatch[1]);const deleted=runtime.profiles.deleteProfile(id,context.actor);json(response,200,deleted);return true;
      }

      const assignment=pathname.match(/^\/api\/v1\/access\/users\/([^/]+)\/profile$/);
      if(assignment&&request.method==='PUT'){
        requireCapability(context,'profiles.assign');const data=await body(request,bodyLimitBytes);const user=runtime.profiles.assignProfile(decodeURIComponent(assignment[1]),data.profileId,context.actor);revokeUserSessions(user.id);json(response,200,user);return true;
      }

      if(request.method==='GET'&&pathname==='/api/v1/access/devices'){
        requireCapability(context,'devices.view');json(response,200,runtime.mobileDevices.listDevices({status:url.searchParams.get('status')||null,deviceType:url.searchParams.get('deviceType')||null}));return true;
      }
      if(request.method==='GET'&&pathname==='/api/v1/access/kitchen-stations'){
        requireCapability(context,'devices.view');json(response,200,runtime.kitchen.listStations());return true;
      }
      if(request.method==='POST'&&pathname==='/api/v1/access/devices'){
        requireCapability(context,'devices.pair');json(response,201,runtime.mobileDevices.createDevice(await body(request,bodyLimitBytes),context.actor));return true;
      }
      const deviceStatus=pathname.match(/^\/api\/v1\/access\/devices\/([^/]+)\/status$/);
      if(deviceStatus&&request.method==='PATCH'){
        requireCapability(context,'devices.block');const data=await body(request,bodyLimitBytes);json(response,200,runtime.mobileDevices.setStatus(decodeURIComponent(deviceStatus[1]),data.status,context.actor));return true;
      }
      const deviceRotate=pathname.match(/^\/api\/v1\/access\/devices\/([^/]+)\/rotate$/);
      if(deviceRotate&&request.method==='POST'){
        requireCapability(context,'devices.rotate_credential');json(response,200,runtime.mobileDevices.rotateCredential(decodeURIComponent(deviceRotate[1]),context.actor));return true;
      }
      const deviceStations=pathname.match(/^\/api\/v1\/access\/devices\/([^/]+)\/kitchen-stations$/);
      if(deviceStations&&request.method==='PUT'){
        requireCapability(context,'devices.pair');const data=await body(request,bodyLimitBytes);json(response,200,runtime.mobileDevices.setKitchenStations(decodeURIComponent(deviceStations[1]),data.stationIds,context.actor));return true;
      }

      if(request.method==='GET'&&pathname==='/api/v1/access/security'){
        requireCapability(context,'security.view');json(response,200,securitySnapshot());return true;
      }
      const sessionMatch=pathname.match(/^\/api\/v1\/access\/sessions\/([^/]+)$/);
      if(sessionMatch&&request.method==='DELETE'){
        requireCapability(context,'sessions.revoke');const id=decodeURIComponent(sessionMatch[1]);let removed=false;
        for(const [token,session] of sessions.entries())if(String(session.id||'')===id){sessions.delete(token);removed=true;}
        runtime.accessSecurity?.record({action:'auth.session.revoked',entity:'session',entityId:id,actor:context.actor,context:{removed}});
        json(response,200,{removed});return true;
      }

      return false;
    }catch(error){
      const status=error.statusCode||(/UNIQUE constraint failed/i.test(error.message||'')?409:400);
      json(response,status,{error:error.message||'Erro interno.',code:error.code||undefined});return true;
    }
  };
}

module.exports={createAccessControlRouter,AccessControlHttpError};
