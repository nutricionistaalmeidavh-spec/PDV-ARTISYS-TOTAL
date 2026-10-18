// cap-047: actual Node+SQLite HTTPS LAN with the built mobile PWA in Chromium.
// All traffic remains on 127.0.0.1; no paid service, cloud login or real devices.
import {execFileSync} from 'node:child_process';
import {createServer as createTcpServer} from 'node:net';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
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
  const response=await page.goto(origin,{waitUntil:'domcontentloaded'});
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
  assert.equal(await page.locator('#r2-settings').count(),1,
    'cap-047 first LAN login must open pairing UI before blocked business requests');
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
  await rm(folder,{recursive:true,force:true});
}
