import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalDatabase} from '../src/local-db.mjs';
import {applyLocalMigrations} from '../src/local-migrations.mjs';
import {hashPassword} from '../src/password.mjs';
import {totpForTest} from '../src/account-security.mjs';
import {createApi} from '../src/worker.mjs';
import {applyOfflineBaseline} from '../src/offline-replica.mjs';

test('MFA-enrolled waiter retains TOTP requirement on replicated LAN PWA with gateway-only encryption key',async t=>{
 const cloud=openLocalDatabase(),local=openLocalDatabase();
 t.after(()=>{cloud.close();local.close();});await applyLocalMigrations(cloud);await applyLocalMigrations(local);
 const now=Date.now(),stamp=new Date(now).toISOString(),password='MFA-Offline-LongPassword-2026!';
 const digest=await hashPassword(password);
 await cloud.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind('a','tenant-a','A',stamp).run();
 await cloud.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)').bind('branch-a','a','MAIN','Matriz',stamp).run();
 await cloud.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,email_verified_at,created_at) VALUES(?,?,?,?,?,?)')
  .bind('owner','owner@qa.test','Owner',digest,stamp,stamp).run();
 await cloud.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)')
  .bind('a','owner','OWNER',stamp).run();
 const origin='https://cloud.qa.test';
 const master='production-secret-only-in-cloud-12345678901234567890';
 const cloudApi=createApi({DB:cloud,AUTH_ENABLED:'true',OFFLINE_SYNC_ENABLED:'true',COOKIE_SECURE:'true',
  MFA_ENABLED:'true',MFA_ENCRYPTION_KEY:master});
 const call=async(api,path,{method='GET',body,cookie,headers={}}={})=>{
  const h=new Headers(headers);if(cookie)h.set('cookie',cookie);
  if(method!=='GET')h.set('origin',origin);
  if(body!==undefined)h.set('content-type','application/json');
  const res=await api.fetch(new Request(origin+path,{method,headers:h,...(body===undefined?{}:{body:JSON.stringify(body)})}));
  return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 };
 const online=await call(cloudApi,'/api/v1/auth/login',{method:'POST',body:{email:'owner@qa.test',password}});
 assert.equal(online.status,200);
 const setup=await call(cloudApi,'/api/v1/auth/mfa/enroll',{method:'POST',cookie:online.cookie,body:{password}});
 assert.equal(setup.status,200,JSON.stringify(setup.data));
 const confirmed=await call(cloudApi,'/api/v1/auth/mfa/confirm',{method:'POST',cookie:online.cookie,
  body:{code:await totpForTest(setup.data.secret,now)}});
 assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));
 const creation=await call(cloudApi,'/api/v1/tenants/a/offline/gateways',{method:'POST',cookie:online.cookie,
  body:{branchId:'branch-a',label:'Offline MFA'}});
 assert.equal(creation.status,201,JSON.stringify(creation.data));
 const {gateway,credential}=creation.data;
 const snapshot=await call(cloudApi,'/api/v1/offline/gateway/snapshot',{
  headers:{authorization:'Bearer '+credential,'x-pdv-offline-gateway-id':gateway.id}});
 assert.equal(snapshot.status,200,JSON.stringify(snapshot.data));
 assert.equal(snapshot.data.tables.saas_mfa_totp.length,1);
 assert.ok(!JSON.stringify(snapshot.data).includes(master),'master encryption key is never in snapshot');
 assert.ok(!JSON.stringify(snapshot.data).includes(setup.data.secret),'plaintext TOTP secret is never in snapshot');
 await applyOfflineBaseline(local,snapshot.data,{tenantId:'a',branchId:'branch-a',gatewayId:gateway.id});
 const localEnv={DB:local,AUTH_ENABLED:'true',LAN_MODE:'true',COOKIE_SECURE:'true',MFA_ENABLED:'true',
  OFFLINE_REPLICA_ENABLED:'true',MFA_ENCRYPTION_KEY:'pdv-offline-device-mfa:'+credential};
 const localApi=createApi(localEnv,{now:()=>now+60000});
 const login=await call(localApi,'/api/v1/auth/login',{method:'POST',body:{email:'owner@qa.test',password}});
 assert.equal(login.status,202,'offline password alone must not sign in a MFA-enrolled account');
 assert.equal(login.data.mfaRequired,true);
 const noMfa=await call(localApi,'/api/v1/auth/session');
 assert.equal(noMfa.status,401);
 const verified=await call(localApi,'/api/v1/auth/mfa/login',{method:'POST',body:{
  challengeToken:login.data.challengeToken,code:await totpForTest(setup.data.secret,now+60000)}});
 assert.equal(verified.status,200,JSON.stringify(verified.data));
 assert.ok(verified.cookie);
 const denied=await call(localApi,'/api/v1/auth/mfa/disable',{method:'POST',cookie:verified.cookie,body:{password}});
 assert.equal(denied.status,403,'offline replica cannot disable canonical MFA');
});
