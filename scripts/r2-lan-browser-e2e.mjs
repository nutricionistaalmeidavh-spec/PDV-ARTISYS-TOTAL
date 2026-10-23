// cap-047: actual Node+SQLite HTTPS LAN with the built mobile PWA in Chromium.
// All traffic remains on 127.0.0.1; no paid service, cloud login or real devices.
import {execFileSync} from 'node:child_process';
import {createServer as createTcpServer} from 'node:net';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,sep,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
import {openLocalDatabase} from '../apps/api/src/local-db.mjs';
import {applyLocalMigrations} from '../apps/api/src/local-migrations.mjs';
import {createLanServer} from '../apps/api/src/https-lan-server.mjs';
import {hashPassword} from '../apps/api/src/password.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){
  const probe=createTcpServer();
  await new Promise((ok,reject)=>probe.once('error',reject).listen(0,'127.0.0.1',ok));
  const port=probe.address().port;
  await new Promise((ok,reject)=>probe.close(e=>e?reject(e):ok()));
  return port;
}
const folder=await mkdtemp(join(tmpdir(),'pdv-r2-mobile-lan-'));
let db,server,browser;
try{
  const port=await freePort();
  const origin='https://127.0.0.1:'+port;
  const keyPath=join(folder,'localhost.key'),certPath=join(folder,'localhost.crt');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-sha256','-nodes',
    '-keyout',keyPath,'-out',certPath,'-days','1','-subj','/CN=127.0.0.1',
    '-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
  db=openLocalDatabase(join(folder,'pdv.sqlite'));
  await applyLocalMigrations(db);
  const now=new Date().toISOString();
  const pw=await hashPassword('R2-Browser-Strong-Password!2026');
  await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
    .bind('owner','r2-owner@integration.test','Local Owner',pw,now).run();
  await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)')
    .bind('a','lan-browser-store','LAN Browser Store',now).run();
  await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)')
    .bind('branch-a','a','MAIN','Main',now).run();
  await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)')
    .bind('a','owner','OWNER',now).run();
  // A waiter has a distinct pre-provisioned local account in this fixture;
  // Cloudflare-to-local account replication is NOT implemented yet.
  await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
    .bind('waiter','r2-waiter@integration.test','Garçom QA',pw,now).run();
  await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)')
    .bind('a','waiter','WAITER',now).run();
  server=createLanServer({origin,tlsKey:await readFile(keyPath),
    tlsCert:await readFile(certPath),db,webRoot:resolve(root,'dist/web')});
  await new Promise((ok,reject)=>server.once('error',reject).listen(port,'127.0.0.1',ok));
  // The generated TLS cert exists only in this localhost CI fixture; Chromium's
  // worker process also needs the temporary certificate exception.
  // Production LAN devices still require a trusted certificate/CA.
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--ignore-certificate-errors']});
  const context=await browser.newContext({viewport:{width:390,height:844},
    ignoreHTTPSErrors:true,deviceScaleFactor:1});
  const page=await context.newPage();
  const response=await page.goto(origin+'/app/',{waitUntil:'domcontentloaded'});
  assert.equal(response.status(),200,'cap-047 HTTPS local PWA must load on a mobile viewport');
  await page.locator('#web-login-form').waitFor({timeout:15000});
  await page.locator('#web-email').fill('r2-owner@integration.test');
  await page.locator('#web-password').fill('R2-Browser-Strong-Password!2026');
  await page.locator('#web-login-form button[type=submit]').click();
  const events=[];
  page.on('pageerror',error=>events.push('pageerror '+error.message));
  page.on('response',response=>{if(response.status()>=400)
    events.push(response.status()+' '+new URL(response.url()).pathname);});
  try{
    await page.locator('body[data-active-route=settings]').waitFor({timeout:12000});
  }catch(error){
    const state=await page.evaluate(async()=>{
      let session;
      try{const response=await fetch('/api/v1/auth/session',{credentials:'same-origin'});
        session={status:response.status,body:await response.text()};}
      catch(reason){session={error:String(reason)};}
      return {route:document.body.dataset.activeRoute||'',loginVisible:
        !!document.querySelector('#web-login-form')?.getBoundingClientRect().height,
        text:document.body.innerText.slice(0,1300),session};
    });
    throw Error('cap-047 login/bootstrap failed: '+JSON.stringify({state,events,error:error.message}));
  }
  const state=await page.evaluate(()=>({
    width:window.innerWidth,documentWidth:document.documentElement.scrollWidth,
    settings:typeof window.PdvR2LanSettings?.render==='function',
    qr:typeof window.PdvLocalQr?.qrSvg==='function',
    manifest:document.querySelector('link[rel=manifest]')?.getAttribute('href')
  }));
  assert.equal(state.settings,true,'cap-047 LAN device settings must be available in the mobile PWA');
  assert.equal(state.qr,true,'cap-047 QR must be generated locally without a cloud image');
  assert.ok(state.documentWidth<=state.width+12,
    'cap-047 mobile PWA must avoid horizontal overflow: '+JSON.stringify(state));
  assert.ok(state.manifest?.includes('manifest.webmanifest'));
  // The route flag may update before the async settings panel mounts in Chromium.
  // Keep this a real UI assertion, but wait for the expected element to be attached.
  await page.locator('#r2-settings').waitFor({state:'attached',timeout:12000});
  assert.equal(await page.locator('#r2-settings').count(),1,
    'cap-047 first LAN login must open pairing UI before blocked business requests');
  // Real UI: admin selects waiter, generates 5-minute QR, employee logs in
  // through that local HTTPS origin, and code is prefilled only after login.
  const pairingBranch=page.locator('#r2-new-pairing [name="branchId"]');
  await page.locator('#r2-new-pairing [name="branchId"] option[value="branch-a"]').waitFor({state:'attached'});
  await pairingBranch.selectOption('branch-a');
  await page.locator('#r2-new-pairing [name="kind"]').selectOption('WAITER');
  await page.locator('#r2-new-pairing button[type="submit"]').click();
  await page.locator('#r2-code-output svg').waitFor({timeout:12000});
  const qrMessage=await page.locator('#r2-code-output').innerText();
  const qrCode=qrMessage.match(/\b[a-f0-9]{64}\b/)?.[0];
  assert.ok(qrCode,'owner UI must generate one-time waiter pairing code and SVG QR');
  const waiterContext=await browser.newContext({viewport:{width:390,height:844},
    ignoreHTTPSErrors:true,deviceScaleFactor:1});
  try{
    const waiterPage=await waiterContext.newPage();
    await waiterPage.goto(origin+'/app/#pdv-pair='+qrCode,{waitUntil:'domcontentloaded'});
    await waiterPage.locator('#web-login-form').waitFor({timeout:15000});
    assert.equal(new URL(waiterPage.url()).hash,'','QR code must leave browser history before login');
    await waiterPage.locator('#web-email').fill('r2-waiter@integration.test');
    await waiterPage.locator('#web-password').fill('R2-Browser-Strong-Password!2026');
    await waiterPage.locator('#web-login-form button[type=submit]').click();
    await waiterPage.locator('#r2-pair-device [name=code]').waitFor({timeout:16000});
    assert.equal(await waiterPage.locator('#r2-pair-device [name=code]').inputValue(),qrCode,
      'one-time QR code must survive the operator login handoff');
    await waiterPage.locator('#r2-pair-device [name=name]').fill('Garçom QA salão');
    await waiterPage.locator('#r2-pair-device button[type=submit]').click();
    await waiterPage.waitForFunction(()=>{
      const key='pdv-total-r2-device-a';
      return Boolean(localStorage.getItem(key+'-id')&&localStorage.getItem(key+'-credential'));
    },{timeout:16000});
    const waiterApi=await waiterPage.evaluate(async()=>{
      const key='pdv-total-r2-device-a';
      const resp=await fetch('/api/v1/tenants/a/restaurant/tables?branchId=branch-a',{
        credentials:'same-origin',headers:{
          'x-pdv-device-id':localStorage.getItem(key+'-id'),
          'x-pdv-device-credential':localStorage.getItem(key+'-credential')
        }});
      return resp.status;
    });
    assert.equal(waiterApi,200,'paired waiter account operates restaurant API on local HTTPS');
  }finally{await waiterContext.close();}
  const live=await page.evaluate(async()=>{
    const base='/api/v1/tenants/a/lan';
    const req=async(url,method='GET',data)=>{
      const response=await fetch(base+url,{method,credentials:'same-origin',
        headers:{'content-type':'application/json'},
        ...(data?{body:JSON.stringify(data)}:{})});
      return {status:response.status,data:await response.json()};
    };
    const address=await req('/access');
    const pairing=await req('/pairings','POST',{kind:'TERMINAL',branchId:'branch-a'});
    if(pairing.status!==201)return {address,pairing};
    const device=await req('/devices/pair','POST',{code:pairing.data.code,name:'Mobile QA terminal'});
    if(device.status!==201)return {address,pairing,device};
    const products=await fetch('/api/v1/tenants/a/products?branchId=branch-a',{
      credentials:'same-origin',headers:{
        'x-pdv-device-id':device.data.device.id,
        'x-pdv-device-credential':device.data.credential}});
    const revoked=await req('/devices/'+device.data.device.id,'DELETE');
    const denied=await fetch('/api/v1/tenants/a/products?branchId=branch-a',{
      credentials:'same-origin',headers:{
        'x-pdv-device-id':device.data.device.id,
        'x-pdv-device-credential':device.data.credential}});
    return {address,pairingStatus:pairing.status,deviceStatus:device.status,
      productsStatus:products.status,revokedStatus:revoked.status,deniedStatus:denied.status};
  });
  assert.equal(live.address?.status,200,'cap-047 LAN access endpoint available in browser');
  assert.equal(live.address.data.origin,origin);
  assert.equal(live.pairingStatus,201,JSON.stringify(live));
  assert.equal(live.deviceStatus,201,JSON.stringify(live));
  assert.equal(live.productsStatus,200,JSON.stringify(live));
  assert.equal(live.revokedStatus,200,JSON.stringify(live));
  assert.equal(live.deniedStatus,401,'cap-047 revoked device cannot continue offline');
  const swReady=await page.evaluate(()=>Promise.race([
    navigator.serviceWorker.ready.then(()=>true),
    new Promise(resolve=>setTimeout(()=>resolve(false),10000))
  ]));
  if(!swReady){
    const diagnostics=await page.evaluate(async()=>{
      const supported='serviceWorker' in navigator;
      const registrations=supported?await navigator.serviceWorker.getRegistrations():[];
      let script;
      try{const response=await fetch('/sw.js');script={status:response.status,type:response.headers.get('content-type')};}
      catch(error){script={error:String(error)};}
      return {isSecureContext:window.isSecureContext,supported,
        registrations:registrations.map(reg=>({scope:reg.scope,installing:reg.installing?.state,
          waiting:reg.waiting?.state,active:reg.active?.state})),script};
    });
    throw Error('cap-047 Service Worker registration/activation failed: '+JSON.stringify(diagnostics));
  }
  await context.setOffline(true);
  const blocked=await page.evaluate(async()=>{
    try{await fetch('/api/v1/auth/session',{cache:'no-store'});return false;}
    catch{return true;}
  });
  assert.equal(blocked,true,'cap-047 disconnected PWA must not fake a confirmed server response');
  await context.setOffline(false);
  let recovered=false;
  for(let attempt=0;attempt<10;attempt++){
    try{recovered=await page.evaluate(async()=> (await fetch('/api/v1/health')).ok);if(recovered)break;}catch{}
    await pause(100);
  }
  assert.equal(recovered,true,'cap-047 local network reconnection must restore API');
  console.log('PASS cap-047: browser/mobile, real local HTTPS PWA, paired devices, revocation, offline and reconnect');
}finally{
  if(browser)await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  if(db)db.close();
  if(!resolve(folder).startsWith(resolve(tmpdir())+sep)||!basename(folder).startsWith('pdv-r2-mobile-lan-'))
    throw Error('Refusing cleanup outside the generated LAN test directory.');
  await rm(folder,{recursive:true,force:true});
}
