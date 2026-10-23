// QA-00/QA-12: real Chromium sessions for every default operating profile.
// No production calls, billing, outbound email, or tenant data reuse.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openLocalDatabase} from '../apps/api/src/local-db.mjs';
import {createApi} from '../apps/api/src/worker.mjs';
import {serveLocalPwa} from '../apps/api/src/local-static.mjs';
import {hashPassword} from '../apps/api/src/password.mjs';
const {chromium,webkit}=createRequire(import.meta.url)('playwright');
const engine=process.env.PDV_TEST_BROWSER==='webkit'?'webkit':'chromium';

const roles=['OWNER','CASHIER','WAITER','KITCHEN','STOCKKEEPER','FINANCE','READ_ONLY'];
const stamp='2026-10-23T12:00:00.000Z',password='OnlySyntheticTesting2026!';
const artifacts=resolve('qa-artifacts/'+(engine==='webkit'?'journeys-webkit':'journeys'));mkdirSync(artifacts,{recursive:true});
const db=openLocalDatabase();
const results=[];
let server,browser;
const record=(id,variant,result,detail={})=>{
  results.push({id,variant,result,...detail});
  console.log('QA '+id+' / '+variant+' : '+result);
};
const count=async(sql,...params)=>(await db.prepare(sql).bind(...params).first()).n;
try{
  // Real schema, real authoritative API, isolated in-memory SQLite.
  for(const file of readdirSync(new URL('../apps/api/migrations/',import.meta.url)).filter(f=>/^\d{4}.*\.sql$/.test(f)).sort())
    db.exec(readFileSync(new URL('../apps/api/migrations/'+file,import.meta.url),'utf8'));
  for(const [id,name] of [['qa','Restaurante QA Integracao'],['external','Empresa QA Externa']]){
    await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)')
      .bind(id,'qa-'+id,name,stamp).run();
    await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)')
      .bind('branch-'+id,id,'MAIN','Matriz '+id,stamp).run();
  }
  const hash=await hashPassword(password);
  for(const role of roles){
    const id=role.toLowerCase();
    await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
      .bind(id,id+'@example.test','QA '+role,hash,stamp).run();
    await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)')
      .bind('qa',id,role,stamp).run();
  }
  await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
    .bind('other','other@example.test','QA externo',hash,stamp).run();
  await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)')
    .bind('external','other','OWNER',stamp).run();
  const api=createApi({DB:db,AUTH_ENABLED:'true',COOKIE_SECURE:'false'});
  server=createServer(async(req,res)=>{
    try{
      const base='http://127.0.0.1:'+server.address().port;
      const url=new URL(req.url,base);
      let response;
      if(url.pathname.startsWith('/api/')){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        response=await api.fetch(new Request(url,{method:req.method,headers:req.headers,
          ...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}));
      }else response=await serveLocalPwa(url.pathname,{rootDir:resolve('dist/web'),method:req.method});
      res.writeHead(response.status,Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
    }catch(error){console.error('QA server error',String(error?.message||error));res.writeHead(500);res.end('QA server error');}
  });
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
  const origin='http://127.0.0.1:'+server.address().port;
  const request=async(path,{method='GET',cookie='',body}={})=>{
    const headers={origin,'content-type':'application/json','x-mutation-id':randomUUID()};
    if(cookie)headers.cookie=cookie;
    const response=await fetch(origin+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json().catch(()=>null)};
  };
  browser=await (engine==='webkit'?webkit:chromium).launch(engine==='webkit'?{headless:true}:{headless:true,args:['--no-sandbox']});
  const sessions=new Map();
  const pageErrors=[];
  // First prove the login form rejects a bad secret without creating a session.
  const negativeContext=await browser.newContext({viewport:{width:390,height:844}});
  const negative=await negativeContext.newPage();
  negative.on('pageerror',e=>pageErrors.push('invalid-login: '+e.message));
  await negative.goto(origin+'/app/');
  await negative.locator('#web-email').fill('owner@example.test');
  await negative.locator('#web-password').fill('IncorrectSyntheticPassword2026');
  await negative.locator('#web-login-form button[type=submit]').click();
  await negative.locator('#auth-overlay').waitFor({state:'visible'});
  const wrong=await request('/api/v1/auth/login',{method:'POST',
    body:{email:'owner@example.test',password:'IncorrectSyntheticPassword2026'}});
  assert.equal(wrong.status,401);
  await negative.screenshot({path:resolve(artifacts,'QA-00-login-invalid.png'),fullPage:true});
  record('QA-00','wrong-password', 'PASS',{httpStatus:wrong.status});
  await negativeContext.close();
  for(const role of roles){
    const id=role.toLowerCase();
    const context=await browser.newContext({viewport:{width:390,height:844}});
    const page=await context.newPage();page.setDefaultTimeout(15000);
    page.on('pageerror',e=>pageErrors.push(role+': '+e.message));
    await page.goto(origin+'/app/');
    await page.locator('#web-email').fill(id+'@example.test');
    await page.locator('#web-password').fill(password);
    await page.locator('#web-login-form button[type=submit]').click();
    await page.locator('#auth-overlay').waitFor({state:'hidden'});
    await page.locator('#route-content').getByRole('heading',{name:'Início',exact:true}).waitFor();
    const {cookies}=await context.storageState();
    const cookie=cookies.map(x=>x.name+'='+x.value).join('; ');
    const current=await request('/api/v1/tenants/qa/context',{cookie});
    assert.equal(current.status,200,role+' must have a valid scoped context');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true,
      role+' must not overflow mobile viewport');
    // Screenshot is from a real authenticated browser, not a mockup.
    await page.screenshot({path:resolve(artifacts,'QA-00-'+id+'.png'),fullPage:true});
    sessions.set(role,{context,page,cookie});
    record('QA-00','signed-in-'+id,'PASS',{httpStatus:current.status,viewport:'390x844'});
  }
  assert.equal(sessions.size,7);
  // Verify revoked membership and disabled user cannot bypass server-side
  // authorization with an existing cookie.
  await db.prepare('UPDATE users SET active=0 WHERE id=?').bind('stockkeeper').run();
  const inactiveUser=await request('/api/v1/auth/login',{method:'POST',
    body:{email:'stockkeeper@example.test',password}});
  assert.ok([401,403].includes(inactiveUser.status),'Inactive user must not log in');
  await db.prepare('UPDATE users SET active=1 WHERE id=?').bind('stockkeeper').run();
  record('QA-00','suspended-user-denied','PASS',{httpStatus:inactiveUser.status});
  await db.prepare('UPDATE tenant_memberships SET active=0 WHERE tenant_id=? AND user_id=?')
    .bind('qa','read_only').run();
  const revokedMembership=await request('/api/v1/tenants/qa/context',{cookie:sessions.get('READ_ONLY').cookie});
  assert.ok([403,404].includes(revokedMembership.status),'Revoked membership must lose tenant access');
  await db.prepare('UPDATE tenant_memberships SET active=1 WHERE tenant_id=? AND user_id=?')
    .bind('qa','read_only').run();
  record('QA-00','revoked-membership-denied','PASS',{httpStatus:revokedMembership.status});
  assert.equal(await count('SELECT COUNT(*) AS n FROM users'),8);
  assert.equal(await count('SELECT COUNT(*) AS n FROM tenant_memberships WHERE tenant_id=?','qa'),7);
  record('QA-00','seven-independent-role-memberships','PASS',{sqliteUsers:8,qaMemberships:7});
  // Direct API access is independently rejected; hiding a button is not authorization.
  for(const role of ['CASHIER','WAITER','KITCHEN','STOCKKEEPER','FINANCE','READ_ONLY']){
    const bad=await request('/api/v1/tenants/qa/branches',{
      method:'POST',cookie:sessions.get(role).cookie,body:{code:'DENIED',name:'Filial proibida'}});
    assert.equal(bad.status,403,role+' must not create branches');
    record('QA-00','forbidden-branch-'+role.toLowerCase(),'PASS',{httpStatus:bad.status});
  }
  assert.equal(await count("SELECT COUNT(*) AS n FROM branches WHERE tenant_id='qa'"),1,
    'denied requests must not leave data behind');
  const owner=sessions.get('OWNER');
  const created=await request('/api/v1/tenants/qa/branches',{
    method:'POST',cookie:owner.cookie,body:{code:'SECOND',name:'Filial de QA B'}});
  assert.equal(created.status,201,JSON.stringify(created.data));
  assert.equal(await count("SELECT COUNT(*) AS n FROM branches WHERE tenant_id='qa'"),2);
  record('QA-00','owner-creates-branch-and-sqlite-reconciles','PASS',{branchCount:2});
  const foreign=await request('/api/v1/tenants/external/branches',{cookie:owner.cookie});
  assert.equal(foreign.status,404);
  record('QA-00','cross-tenant-denied','PASS',{httpStatus:404});
  const kitchen=sessions.get('KITCHEN');
  const forbiddenCatalog=await request('/api/v1/tenants/qa/products?branchId=branch-qa',{cookie:kitchen.cookie});
  assert.equal(forbiddenCatalog.status,403);
  record('QA-00','kitchen-denied-catalog','PASS',{httpStatus:403});
  const cashier=sessions.get('CASHIER');
  const allowedCatalog=await request('/api/v1/tenants/qa/products?branchId=branch-qa',{cookie:cashier.cookie});
  assert.equal(allowedCatalog.status,200);
  record('QA-00','cashier-can-read-catalog','PASS',{httpStatus:200});
  // Session revocation must invalidate the server cookie and return to login.
  const active=await request('/api/v1/auth/sessions',{cookie:owner.cookie});
  assert.equal(active.status,200);assert.ok(active.data.sessions.length>0);
  const revoke=await request('/api/v1/auth/sessions/'+active.data.sessions[0].id,{method:'DELETE',cookie:owner.cookie});
  assert.equal(revoke.status,200);
  assert.equal((await request('/api/v1/auth/session',{cookie:owner.cookie})).status,401);
  await owner.page.reload();await owner.page.locator('#auth-overlay').waitFor({state:'visible'});
  await owner.page.screenshot({path:resolve(artifacts,'QA-00-revoked-session.png'),fullPage:true});
  record('QA-00','revoked-session-no-access','PASS',{httpStatus:401});
  // Simulate loss of network and recovery without inventing a server success.
  await cashier.context.setOffline(true);
  const failed=await cashier.page.evaluate(()=>fetch('/api/v1/auth/session')
    .then(()=>false,()=>true));
  assert.equal(failed,true);
  await cashier.page.screenshot({path:resolve(artifacts,'QA-12-network-offline.png'),fullPage:true});
  await cashier.context.setOffline(false);
  const recovered=await cashier.page.evaluate(()=>fetch('/api/v1/auth/session')
    .then(r=>r.status,()=>0));
  assert.equal(recovered,200);
  await cashier.page.reload();await cashier.page.locator('#auth-overlay').waitFor({state:'hidden'});
  await cashier.page.screenshot({path:resolve(artifacts,'QA-12-network-recovered.png'),fullPage:true});
  record('QA-12','offline-failure-followed-by-recovery','PASS',
    {offlineFailure:true,recoveredHttpStatus:200});
  assert.deepEqual(pageErrors,[],'uncaught browser JavaScript errors');
  // Explicitly exclude credentials, cookies, raw customer payloads and tokens.
  writeFileSync(resolve(artifacts,'qa-roles-results.json'),JSON.stringify({
    environment:'localhost / isolated in-memory SQLite / synthetic only',
    browsers:[engine],profiles:roles,results,
    limitations:['No physical Safari/iOS','No printer output','No external billing or transactional email']
  },null,2)+'\n');
  console.log('QA-00 and QA-12 role/negative/recovery evidence recorded.');
} catch(error){
  record('QA-00','harness-failure','FAIL',{message:String(error?.message||error)});
  writeFileSync(resolve(artifacts,'qa-roles-results.json'),
    JSON.stringify({environment:'localhost isolated QA',results},null,2)+'\n');
  throw error;
}finally{
  await browser?.close();
  if(server)await new Promise(ok=>server.close(ok));
  db.close();
}
