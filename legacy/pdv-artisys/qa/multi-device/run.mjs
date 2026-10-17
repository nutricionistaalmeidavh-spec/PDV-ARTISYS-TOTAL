#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { _electron as electron } from 'playwright';

const require=createRequire(import.meta.url);
const {createPdvRuntime}=require('../../js/core/pdv-runtime');
const {createLocalServer}=require('../../server/local-server');

const PROFILE_SCENARIOS=Object.freeze({
  smoke:['terminal-onboarding-pairing','server-restart-recovery','price-propagation','sale-stock-decrement','last-unit-race','idempotent-completion','database-invariants'],
  full:['terminal-onboarding-pairing','server-restart-recovery','price-propagation','cashier-ui-price-propagation','sale-stock-decrement','last-unit-race','idempotent-completion','cash-session-isolation','restaurant-kds-flow','authorization-boundaries','database-invariants'],
  stress:['terminal-onboarding-pairing','price-propagation','cashier-ui-price-propagation','sale-stock-decrement','last-unit-race','idempotent-completion','cash-session-isolation','restaurant-kds-flow','authorization-boundaries','scale-10-cashiers-15-waiters-13-orders','aggressive-order-ramp','stress-last-unit-races','database-invariants']
});

const SCALE_CASHIERS=10;
const SCALE_WAITERS=15;
const SCALE_SIMULTANEOUS_ORDERS=13;
const AGGRESSIVE_ORDER_LEVELS=[100,250,500];
const LOAD_REQUEST_TIMEOUT_MS=90000;

function parseArgs(argv){
  const result={profile:process.env.QA_PROFILE||'full',output:'qa-artifacts/multi-device'};
  for(let i=0;i<argv.length;i+=1){
    if(argv[i]==='--profile'&&argv[i+1])result.profile=argv[++i];
    else if(argv[i]==='--output'&&argv[i+1])result.output=argv[++i];
  }
  result.profile=String(result.profile||'full').toLowerCase();
  if(!PROFILE_SCENARIOS[result.profile])throw new Error('Perfil invalido. Use smoke, full ou stress.');
  return result;
}

function assert(condition,message,details={}){
  if(condition)return;
  const error=new Error(message);
  error.details=details;
  throw error;
}

function safeJson(value){
  try{return JSON.stringify(value);}catch{return String(value);}
}

function freeLocalPort(){
  return new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      const address=server.address();
      const port=typeof address==='object'&&address?address.port:0;
      server.close(error=>error?reject(error):resolve(port));
    });
  });
}

async function waitUntil(predicate,{timeoutMs=15000,intervalMs=100,message='Condição de QA não atendida.'}={}){
  const started=Date.now();
  while(Date.now()-started<timeoutMs){
    try{if(await predicate())return true;}catch{}
    await new Promise(resolve=>setTimeout(resolve,intervalMs));
  }
  throw new Error(message);
}

async function authenticateDesktopPage(page,{username,password,timeoutMs=20000}={}){
  const loginForm=page.locator('#login-form');
  const authOverlay=page.locator('#auth-overlay');
  const existing=page.locator('[data-existing-continue]');
  await waitUntil(async()=>{
    if(await existing.isVisible().catch(()=>false)){
      await existing.click();
      return false;
    }
    if(await authOverlay.isHidden().catch(()=>false))return true;
    return loginForm.isVisible().catch(()=>false);
  },{timeoutMs,message:'Desktop nao chegou a login nem restaurou sessao.'});
  if(await authOverlay.isHidden().catch(()=>false))return'restored';
  await loginForm.locator("input[name='username']").fill(username);
  await loginForm.locator("input[name='password']").fill(password);
  await loginForm.locator("button[type='submit']").click();
  await authOverlay.waitFor({state:'hidden',timeout:timeoutMs});
  return'logged-in';
}

function requestFactory(base,defaults={}){
  return async function request(route,{method='GET',body,headers={},expected=null,timeoutMs=LOAD_REQUEST_TIMEOUT_MS}={}){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),timeoutMs);
    let response;
    try{
      response=await fetch(base+route,{
        method,
        headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(defaults.headers||{}),...headers},
        body:body===undefined?undefined:JSON.stringify(body),
        signal:controller.signal
      });
    }catch(error){
      if(error?.name==='AbortError')throw new Error(method+' '+route+' excedeu '+timeoutMs+'ms.');
      throw error;
    }finally{clearTimeout(timeout);}
    const text=await response.text();
    let payload=null;
    if(text){try{payload=JSON.parse(text);}catch{payload=text;}}
    const result={status:response.status,body:payload};
    if(expected!==null){
      const accepted=Array.isArray(expected)?expected:[expected];
      if(!accepted.includes(response.status)){
        const error=new Error(method+' '+route+' retornou '+response.status+': '+safeJson(payload));
        error.response=result;
        throw error;
      }
    }
    return result;
  };
}

async function login(base,{username,password,terminal}){
  const terminalHeaders={'x-terminal-id':terminal.terminalId,'x-terminal-key':terminal.credential};
  const request=requestFactory(base,{headers:terminalHeaders});
  const response=await request('/api/v1/auth/login',{method:'POST',body:{username,password,terminalId:terminal.terminalId},expected:200});
  const token=response.body.sessionToken;
  return {terminalId:terminal.terminalId,token,request:requestFactory(base,{headers:{authorization:'Bearer '+token,...terminalHeaders}})};
}

function deviceClient(base,device){
  return requestFactory(base,{headers:{'x-device-id':device.id,'x-device-key':device.credential}});
}

function movementCount(db,productId,type='sale'){
  return db.prepare('SELECT COUNT(*) AS n FROM inventory_movements WHERE product_id=? AND type=?').get(String(productId),String(type)).n;
}

function completedCount(db,ids){
  const placeholders=ids.map(()=>'?').join(',');
  return db.prepare("SELECT COUNT(*) AS n FROM sales WHERE id IN ("+placeholders+") AND status='COMPLETED'").get(...ids).n;
}

function percentile(values,ratio){
  if(!values.length)return 0;
  const sorted=[...values].sort((a,b)=>a-b);
  const index=Math.min(sorted.length-1,Math.max(0,Math.ceil(sorted.length*ratio)-1));
  return sorted[index];
}

function roundMetric(value){
  return Math.round(Number(value||0)*100)/100;
}

function summarizeLoad(samples,elapsedMs,launchSpreadMs){
  const durations=samples.filter(sample=>sample.ok).map(sample=>sample.durationMs);
  return{
    requests:samples.length,
    succeeded:samples.filter(sample=>sample.ok).length,
    failed:samples.filter(sample=>!sample.ok).length,
    elapsedMs:roundMetric(elapsedMs),
    launchSpreadMs:roundMetric(launchSpreadMs),
    p50Ms:roundMetric(percentile(durations,0.50)),
    p95Ms:roundMetric(percentile(durations,0.95)),
    maxMs:roundMetric(durations.length?Math.max(...durations):0),
    throughputOpsPerSecond:elapsedMs>0?roundMetric((samples.length*1000)/elapsedMs):0
  };
}

async function runSimultaneousOperations(operations){
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const queued=operations.map(async operation=>{
    await gate;
    const started=performance.now();
    const {run,...meta}=operation;
    try{
      const result=await run();
      return{...meta,ok:true,started,durationMs:performance.now()-started,result};
    }catch(error){
      return{...meta,ok:false,started,durationMs:performance.now()-started,error:error?.message||String(error)};
    }
  });
  const batchStarted=performance.now();
  release();
  const samples=await Promise.all(queued);
  const elapsedMs=performance.now()-batchStarted;
  const starts=samples.map(sample=>sample.started);
  const launchSpreadMs=starts.length?Math.max(...starts)-Math.min(...starts):0;
  return{samples,metrics:summarizeLoad(samples,elapsedMs,launchSpreadMs)};
}

async function runMultiDeviceQa({profile='full',output='qa-artifacts/multi-device'}={}){
  const selected=PROFILE_SCENARIOS[profile];
  if(!selected)throw new Error('Perfil de QA desconhecido.');
  const outputDir=path.resolve(output);
  fs.rmSync(outputDir,{recursive:true,force:true});
  fs.mkdirSync(outputDir,{recursive:true});
  const logPath=path.join(outputDir,'events.jsonl');
  const log=(event,data={})=>fs.appendFileSync(logPath,JSON.stringify({at:new Date().toISOString(),event,...data})+'\n');

  const dbPath=path.join(outputDir,'final.sqlite');
  const packageVersion=JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'..','..','package.json'),'utf8')).version;
  let idSeq=0;
  let nowSeq=0;
  const runtime=createPdvRuntime({
    dbPath,
    appVersion:packageVersion,
    serverVersion:packageVersion,
    idFactory:prefix=>'qa-'+prefix+'-'+(++idSeq),
    now:()=>new Date(Date.UTC(2026,9,3,18,0,0)+(nowSeq++)*1000).toISOString()
  });
  const installToken='qa-local-fixture';
  const qaPort=await freeLocalPort();
  let server=createLocalServer({runtime,host:'127.0.0.1',port:qaPort,token:installToken,requireTerminalAuth:true});
  const actor={kind:'human',userId:'qa-admin',terminalId:'ADMIN-01'};
  const results=[];
  const state={};

  function pairTerminal(terminalId,name){
    const pairing=runtime.terminals.createPairingCode({createdBy:'qa-admin',ttlSeconds:3600});
    const paired=runtime.terminals.pairTerminal({code:pairing.code,terminalId,name,fingerprint:'qa-'+terminalId,appVersion:packageVersion});
    return{terminalId,name,credential:paired.credential};
  }

  async function scenario(name,fn){
    if(!selected.includes(name))return;
    const started=performance.now();
    log('scenario.start',{name});
    try{
      const details=await fn();
      const entry={name,status:'PASS',durationMs:Math.round(performance.now()-started),details:details||{}};
      results.push(entry);log('scenario.pass',entry);return entry;
    }catch(error){
      const entry={name,status:'FAIL',durationMs:Math.round(performance.now()-started),error:error?.message||String(error),details:error?.details||error?.response||{}};
      results.push(entry);log('scenario.fail',entry);return entry;
    }
  }

  try{
    runtime.catalog.createUser({id:'qa-admin',username:'qa-admin',name:'QA Administrador',profileId:'profile-administrator',password:'qa-test-password'});
    runtime.catalog.createUser({id:'qa-cash-a',username:'qa-cash-a',name:'QA Caixa A',profileId:'profile-cashier',password:'qa-test-password'});
    runtime.catalog.createUser({id:'qa-cash-b',username:'qa-cash-b',name:'QA Caixa B',profileId:'profile-cashier',password:'qa-test-password'});
    runtime.catalog.createUser({id:'qa-waiter',username:'qa-waiter',name:'QA Garcom',profileId:'profile-waiter',password:'qa-test-password'});
    runtime.catalog.createUser({id:'qa-waiter-2',username:'qa-waiter-2',name:'QA Garcom 2',profileId:'profile-waiter',password:'qa-test-password'});

    runtime.catalog.upsertCategory({id:'qa-category',name:'QA Multi-Device'},actor);
    runtime.modules.setEnabled('FOOD',true,actor);
    const seedProducts=[
      {id:'qa-price',sku:'QA-PRICE',name:'Produto Preco',salePriceCents:1000,costCents:400,trackStock:false,menuEnabled:true},
      {id:'qa-ui-price',sku:'QA-UI-PRICE',name:'Produto UI Preco',salePriceCents:1000,costCents:400,trackStock:false,menuEnabled:true},
      {id:'qa-stock',sku:'QA-STOCK',name:'Produto Estoque',salePriceCents:1000,costCents:400,trackStock:true,menuEnabled:true},
      {id:'qa-last',sku:'QA-LAST',name:'Ultima Unidade',salePriceCents:700,costCents:250,trackStock:true,menuEnabled:true},
      {id:'qa-idem',sku:'QA-IDEM',name:'Produto Idempotencia',salePriceCents:900,costCents:300,trackStock:true,menuEnabled:true},
      {id:'qa-food',sku:'QA-FOOD',name:'Prato QA',salePriceCents:1800,costCents:700,trackStock:true,menuEnabled:true}
    ];
    for(const product of seedProducts)runtime.catalog.upsertProduct({...product,categoryId:'qa-category',active:true},actor);
    runtime.inventory.move({productId:'qa-stock',type:'opening',quantityDelta:5,reason:'QA seed'},actor);
    runtime.inventory.move({productId:'qa-last',type:'opening',quantityDelta:1,reason:'QA seed'},actor);
    runtime.inventory.move({productId:'qa-idem',type:'opening',quantityDelta:2,reason:'QA seed'},actor);
    runtime.inventory.move({productId:'qa-food',type:'opening',quantityDelta:5,reason:'QA seed'},actor);

    state.adminTerminal=pairTerminal('ADMIN-01','Administracao QA');
    state.cashATerminal=pairTerminal('CAIXA-01','Caixa QA 1');
    state.cashBTerminal=pairTerminal('CAIXA-02','Caixa QA 2');

    const address=await server.start();
    const base='http://'+address.host+':'+address.port;
    state.base=base;
    state.admin=await login(base,{username:'qa-admin',password:'qa-test-password',terminal:state.adminTerminal});
    state.cashA=await login(base,{username:'qa-cash-a',password:'qa-test-password',terminal:state.cashATerminal});
    state.cashB=await login(base,{username:'qa-cash-b',password:'qa-test-password',terminal:state.cashBTerminal});

    const cashAOpen=await state.cashA.request('/api/v1/cash/sessions',{method:'POST',headers:{'x-mutation-id':'qa-open-cash-a'},body:{initialCashCents:10000},expected:201});
    const cashBOpen=await state.cashB.request('/api/v1/cash/sessions',{method:'POST',headers:{'x-mutation-id':'qa-open-cash-b'},body:{initialCashCents:10000},expected:201});
    state.cashSessionA=cashAOpen.body.session;
    state.cashSessionB=cashBOpen.body.session;

    await scenario('server-restart-recovery',async()=>{
      const before=await state.cashA.request('/api/v1/products',{expected:200});
      assert(Array.isArray(before.body)&&before.body.some(item=>item.id==='qa-price'),'Precondicao de persistencia LAN ausente.');
      await server.stop();
      let outageObserved=false;
      try{await state.cashA.request('/api/v1/products',{timeoutMs:1500});}
      catch{outageObserved=true;}
      assert(outageObserved,'Cliente nao percebeu a queda do servidor LAN.');
      server=createLocalServer({runtime,host:'127.0.0.1',port:qaPort,token:installToken,requireTerminalAuth:true});
      const restarted=await server.start();
      assert(restarted.port===qaPort,'Servidor LAN reiniciou em porta diferente',{expected:qaPort,actual:restarted.port});
      state.admin=await login(base,{username:'qa-admin',password:'qa-test-password',terminal:state.adminTerminal});
      state.cashA=await login(base,{username:'qa-cash-a',password:'qa-test-password',terminal:state.cashATerminal});
      state.cashB=await login(base,{username:'qa-cash-b',password:'qa-test-password',terminal:state.cashBTerminal});
      await waitUntil(async()=>{
        try{
          const response=await state.cashA.request('/api/v1/products',{expected:200,timeoutMs:2000});
          return Array.isArray(response.body)&&response.body.some(item=>item.id==='qa-price');
        }catch{return false;}
      },{timeoutMs:15000,message:'Cliente nao recuperou conexao apos reinicio do servidor LAN.'});
      const cashSession=runtime.cash.getSession(state.cashSessionA.id);
      assert(cashSession?.status==='OPEN','Sessao de caixa nao persistiu durante reinicio LAN',{cashSession});
      return{outageObserved,recovered:true,port:qaPort,cashSessionId:state.cashSessionA.id};
    });

    await scenario('terminal-onboarding-pairing',async()=>{
      const rootDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
      const principalUserData=path.join(outputDir,'electron-principal-onboarding');
      const terminalUserData=path.join(outputDir,'electron-terminal-onboarding');
      const screenshotDir=path.join(outputDir,'screenshots');
      fs.mkdirSync(principalUserData,{recursive:true});
      fs.mkdirSync(terminalUserData,{recursive:true});
      fs.mkdirSync(screenshotDir,{recursive:true});
      const lanPort=await freeLocalPort();
      fs.writeFileSync(path.join(principalUserData,'data-server.json'),JSON.stringify({
        selected:true,
        setupIntent:null,
        mode:'lan-host',
        host:'127.0.0.1',
        port:lanPort,
        serverUrl:'',
        terminalId:'PDV-01'
      },null,2)+'\n');

      const launchDesktop=async(userDataDir,extraEnv={})=>electron.launch({
        executablePath:require('electron'),
        args:[path.join(rootDir,'qa','desktop','main.cjs'),'--no-sandbox','--password-store=basic'],
        env:{
          ...process.env,
          ARTISYS_QA:'1',
          ARTISYS_QA_USER_DATA_DIR:userDataDir,
          ARTISYS_QA_NO_PRINTERS:'1',
          ARTISYS_QA_SIMULATE_PRINTER:'1',
          PDV_STORE_NAME:'Loja QA Onboarding',
          PDV_AUTO_PRINT:'false',
          PDV_REQUIRE_COMMERCIAL_ACTIVATION:'false',
          ...extraEnv
        }
      });

      let principalApp=null;
      let terminalApp=null;
      try{
        principalApp=await launchDesktop(principalUserData,{ARTISYS_QA_AUTO_ADMIN:'1'});
        const principalPage=await principalApp.firstWindow();
        await authenticateDesktopPage(principalPage,{username:'qaadmin',password:'QaLocalOnly-12345!'});
        await principalPage.locator("button[data-route='settings']").click();
        const unitsCategory=principalPage.locator("#settings-hub [data-settings-category='units']");
        await unitsCategory.waitFor({state:'visible',timeout:15000});
        await unitsCategory.click();
        const addTerminal=principalPage.locator('#p1-terminal-admin-panel [data-create-pairing-code]');
        await addTerminal.waitFor({state:'visible',timeout:15000});
        await addTerminal.click();
        const codeNode=principalPage.locator('#p1-terminal-admin-panel [data-pairing-output] strong');
        await codeNode.waitFor({state:'visible',timeout:10000});
        const codeText=await codeNode.innerText();
        const pairingCode=codeText.match(/\d{6}/)?.[0]||'';
        assert(/^\d{6}$/.test(pairingCode),'PC principal não gerou código de pareamento de 6 dígitos',{codeText});
        await principalPage.screenshot({path:path.join(screenshotDir,'onboarding-principal-code.png'),fullPage:true});

        terminalApp=await launchDesktop(terminalUserData,{ARTISYS_QA_NO_RELAUNCH:'1'});
        let terminalPage=await terminalApp.firstWindow();
        const connectExisting=terminalPage.locator('[data-connect-existing]');
        await connectExisting.waitFor({state:'visible',timeout:20000});
        assert(await terminalPage.locator('#activation-verify-form').count()===0,'Terminal novo exibiu ativação comercial antes do pareamento.');
        assert(await terminalPage.locator('#first-access-form').count()===0,'Terminal novo exibiu criação de administrador antes do pareamento.');
        await connectExisting.click();
        const pairingAdvanced=terminalPage.locator('#terminal-pairing-form [data-pairing-advanced] summary');
        await pairingAdvanced.click();
        await terminalPage.locator("#terminal-pairing-form input[name='serverUrl']").fill('http://127.0.0.1:'+lanPort);
        await terminalPage.locator('#terminal-pairing-form [data-pairing-code]').fill(pairingCode);
        await terminalPage.locator("#terminal-pairing-form input[name='terminalName']").fill('Caixa Pareado QA');
        await terminalPage.locator("#terminal-pairing-form button[type='submit']").click();

        const terminalConfigPath=path.join(terminalUserData,'data-server.json');
        await waitUntil(()=>{
          if(!fs.existsSync(terminalConfigPath))return false;
          const saved=JSON.parse(fs.readFileSync(terminalConfigPath,'utf8'));
          return saved.selected===true&&saved.mode==='lan-client'&&Boolean(saved.terminalId);
        },{message:'Terminal não persistiu o pareamento LAN.'});
        const terminalConfig=JSON.parse(fs.readFileSync(terminalConfigPath,'utf8'));
        const terminalId=String(terminalConfig.terminalId||'');
        const rawTerminalConfig=fs.readFileSync(terminalConfigPath,'utf8');
        assert(!/terminalKey|credential|secret/i.test(rawTerminalConfig),'Configuração pública do terminal persistiu segredo',{rawTerminalConfig});
        assert(fs.existsSync(path.join(terminalUserData,'terminal-credential.bin')),'Credencial permanente não foi salva no armazenamento seguro do terminal.');
        await terminalApp.close().catch(()=>{});
        terminalApp=null;

        terminalApp=await launchDesktop(terminalUserData,{ARTISYS_QA_NO_RELAUNCH:'1'});
        terminalPage=await terminalApp.firstWindow();
        assert(await terminalPage.locator('#activation-verify-form').count()===0,'Terminal pareado pediu ativação comercial novamente.');
        assert(await terminalPage.locator('#first-access-form').count()===0,'Terminal pareado tentou criar outro administrador.');
        await terminalPage.screenshot({path:path.join(screenshotDir,'onboarding-terminal-login.png'),fullPage:true});
        await authenticateDesktopPage(terminalPage,{username:'qaadmin',password:'QaLocalOnly-12345!'});

        await principalPage.locator('#p1-terminal-admin-panel [data-terminal-refresh]').click();
        const lifecycleButton=principalPage.locator(`#p1-terminal-admin-panel [data-terminal-status="${terminalId}"]`);
        await lifecycleButton.waitFor({state:'visible',timeout:10000});
        assert((await lifecycleButton.innerText()).includes('Bloquear'),'Terminal pareado não apareceu como ACTIVE no PC principal.');
        await lifecycleButton.click();
        await waitUntil(async()=>((await lifecycleButton.innerText()).includes('Reativar')),{
          message:'PC principal não refletiu terminal BLOCKED.'
        });

        await terminalPage.reload({waitUntil:'domcontentloaded'});
        await terminalPage.locator('#login-form').waitFor({state:'visible',timeout:20000});
        await terminalPage.locator("#login-form input[name='username']").fill('qaadmin');
        await terminalPage.locator("#login-form input[name='password']").fill('QaLocalOnly-12345!');
        await terminalPage.locator("#login-form button[type='submit']").click();
        await terminalPage.locator('.toast.error').waitFor({state:'visible',timeout:10000});

        await lifecycleButton.click();
        await waitUntil(async()=>((await lifecycleButton.innerText()).includes('Bloquear')),{
          message:'PC principal não refletiu terminal ACTIVE após reativação.'
        });
        await terminalPage.locator("#login-form button[type='submit']").click();
        await terminalPage.locator('#auth-overlay').waitFor({state:'hidden',timeout:20000});
        await terminalPage.screenshot({path:path.join(screenshotDir,'onboarding-terminal-reactivated.png'),fullPage:true});

        return{
          principalPort:lanPort,
          terminalId,
          pairingCodeDigits:pairingCode.length,
          blockedStatus:'BLOCKED',
          reactivatedStatus:'ACTIVE',
          activationPromptShown:false,
          adminSetupShown:false,
          screenshots:3
        };
      }finally{
        if(terminalApp)await terminalApp.close().catch(()=>{});
        if(principalApp)await principalApp.close().catch(()=>{});
      }
    });

    await scenario('price-propagation',async()=>{
      await state.admin.request('/api/v1/products',{method:'POST',body:{id:'qa-price',sku:'QA-PRICE',name:'Produto Preco',categoryId:'qa-category',salePriceCents:1250,costCents:400,trackStock:false,menuEnabled:true,active:true},expected:201});
      const products=await state.cashA.request('/api/v1/products',{expected:200});
      const product=products.body.find(item=>item.id==='qa-price');
      assert(product?.salePriceCents===1250,'Novo preco nao apareceu no caixa',{product});
      const opened=await state.cashA.request('/api/v1/sales',{method:'POST',body:{saleNumber:'QA-PRICE-SALE'},expected:201});
      const sale=await state.cashA.request('/api/v1/sales/'+opened.body.id+'/items',{method:'POST',body:{productId:'qa-price',quantity:1},expected:200});
      assert(sale.body.items[0]?.unitPriceCents===1250,'Venda nova nao capturou o preco atualizado',{item:sale.body.items[0]});
      const completed=await state.cashA.request('/api/v1/sales/'+opened.body.id+'/complete',{method:'POST',headers:{'x-mutation-id':'qa-price-complete'},body:{payments:[{method:'PIX',amountCents:1250}]},expected:200});
      assert(completed.body.sale.status==='COMPLETED','Venda com preco atualizado nao concluiu',{sale:completed.body.sale});
      assert(completed.body.sale.totalCents===1250,'Venda concluiu com total diferente do preco atualizado',{sale:completed.body.sale});
      state.priceSaleId=opened.body.id;
      return{priceCents:product.salePriceCents,saleUnitPriceCents:sale.body.items[0].unitPriceCents,saleTotalCents:completed.body.sale.totalCents};
    });

    await scenario('cashier-ui-price-propagation',async()=>{
      const rootDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
      const userDataDir=path.join(outputDir,'electron-cashier-user-data');
      const screenshotDir=path.join(outputDir,'screenshots');
      fs.mkdirSync(userDataDir,{recursive:true});
      fs.mkdirSync(screenshotDir,{recursive:true});
      fs.writeFileSync(path.join(userDataDir,'data-server.json'),JSON.stringify({
        selected:true,
        mode:'lan-client',
        host:'0.0.0.0',
        port:4174,
        serverUrl:base,
        terminalId:state.cashATerminal.terminalId
      },null,2)+'\n');

      let app=null;
      try{
        app=await electron.launch({
          executablePath:require('electron'),
          args:[
            path.join(rootDir,'qa','desktop','main.cjs'),
            '--no-sandbox',
            '--password-store=basic'
          ],
          env:{
            ...process.env,
            ARTISYS_QA:'1',
            ARTISYS_QA_USER_DATA_DIR:userDataDir,
            ARTISYS_QA_NO_PRINTERS:'1',
            ARTISYS_QA_SIMULATE_PRINTER:'1',
            PDV_DEPLOYMENT_PROFILE:'terminal',
            PDV_SERVER_URL:base,
            PDV_TERMINAL_ID:state.cashATerminal.terminalId,
            PDV_TERMINAL_KEY:state.cashATerminal.credential,
            PDV_TERMINAL_NAME:'Caixa QA UI',
            PDV_STORE_NAME:'Loja QA',
            PDV_AUTO_PRINT:'false',
            PDV_REQUIRE_COMMERCIAL_ACTIVATION:'false'
          }
        });
        const page=await app.firstWindow();
        await authenticateDesktopPage(page,{username:'qa-cash-a',password:'qa-test-password'});
        await page.locator("button[data-route='checkout']").click();

        const card=page.locator("[data-add-product='qa-ui-price']");
        await card.waitFor({state:'visible',timeout:15000});
        const before=(await card.innerText()).replace(/\s+/g,' ');
        assert(before.includes('10,00'),'Caixa Electron nao exibiu preco inicial de R$ 10,00',{text:before});
        await page.screenshot({path:path.join(screenshotDir,'cashier-price-before.png'),fullPage:true});

        await state.admin.request('/api/v1/products',{method:'POST',body:{
          id:'qa-ui-price',sku:'QA-UI-PRICE',name:'Produto UI Preco',categoryId:'qa-category',
          salePriceCents:1375,costCents:400,trackStock:false,menuEnabled:true,active:true
        },expected:201});

        await page.reload({waitUntil:'domcontentloaded'});
        await page.locator('#auth-overlay').waitFor({state:'hidden',timeout:20000});
        await page.locator("button[data-route='checkout']").click();
        const updated=page.locator("[data-add-product='qa-ui-price']");
        await updated.waitFor({state:'visible',timeout:15000});
        const after=(await updated.innerText()).replace(/\s+/g,' ');
        assert(after.includes('13,75'),'Preco alterado pelo Admin nao apareceu no Caixa Electron',{text:after});
        await updated.click();

        const cart=page.locator(".cart-line[data-select-product='qa-ui-price']");
        await cart.waitFor({state:'visible',timeout:15000});
        const cartText=(await cart.innerText()).replace(/\s+/g,' ');
        assert(cartText.includes('13,75'),'Carrinho do Caixa Electron nao usou o novo preco',{text:cartText});
        await page.screenshot({path:path.join(screenshotDir,'cashier-price-after.png'),fullPage:true});
        return{before:'10,00',after:'13,75',cartPrice:'13,75',screenshots:2};
      }finally{
        if(app)await app.close().catch(()=>{});
      }
    });

    await scenario('sale-stock-decrement',async()=>{
      const opened=await state.cashA.request('/api/v1/sales',{method:'POST',body:{saleNumber:'QA-STOCK-SALE'},expected:201});
      await state.cashA.request('/api/v1/sales/'+opened.body.id+'/items',{method:'POST',body:{productId:'qa-stock',quantity:2},expected:200});
      const completed=await state.cashA.request('/api/v1/sales/'+opened.body.id+'/complete',{method:'POST',headers:{'x-mutation-id':'qa-stock-complete'},body:{payments:[{method:'CASH',amountCents:2000}]},expected:200});
      const inventory=await state.admin.request('/api/v1/inventory/qa-stock',{expected:200});
      assert(completed.body.sale.status==='COMPLETED','Venda de estoque nao concluiu',{sale:completed.body.sale});
      assert(inventory.body.quantity===3,'Venda nao baixou exatamente duas unidades',{inventory:inventory.body});
      assert(movementCount(runtime.db,'qa-stock')===1,'Baixa de estoque foi duplicada',{movements:movementCount(runtime.db,'qa-stock')});
      state.stockSaleId=opened.body.id;
      return{saleId:opened.body.id,finalStock:inventory.body.quantity,movements:movementCount(runtime.db,'qa-stock')};
    });

    await scenario('last-unit-race',async()=>{
      const a=await state.cashA.request('/api/v1/sales',{method:'POST',body:{saleNumber:'QA-LAST-A'},expected:201});
      const b=await state.cashB.request('/api/v1/sales',{method:'POST',body:{saleNumber:'QA-LAST-B'},expected:201});
      await state.cashA.request('/api/v1/sales/'+a.body.id+'/items',{method:'POST',body:{productId:'qa-last',quantity:1},expected:200});
      await state.cashB.request('/api/v1/sales/'+b.body.id+'/items',{method:'POST',body:{productId:'qa-last',quantity:1},expected:200});
      const attempts=await Promise.all([
        state.cashA.request('/api/v1/sales/'+a.body.id+'/complete',{method:'POST',headers:{'x-mutation-id':'qa-last-a'},body:{payments:[{method:'PIX',amountCents:700}]}}),
        state.cashB.request('/api/v1/sales/'+b.body.id+'/complete',{method:'POST',headers:{'x-mutation-id':'qa-last-b'},body:{payments:[{method:'PIX',amountCents:700}]}})
      ]);
      const successes=attempts.filter(item=>item.status===200);
      const inventory=await state.admin.request('/api/v1/inventory/qa-last',{expected:200});
      const completed=completedCount(runtime.db,[a.body.id,b.body.id]);
      const movements=movementCount(runtime.db,'qa-last');
      assert(successes.length===1,'Duas vendas consumiram a mesma ultima unidade',{attempts,completed,finalStock:inventory.body.quantity,movements});
      assert(completed===1,'Mais de uma venda ficou COMPLETED com estoque unitario',{attempts,completed});
      assert(inventory.body.quantity===0,'Saldo final da ultima unidade deve ser zero',{inventory:inventory.body});
      assert(movements===1,'Ultima unidade deve gerar uma unica baixa',{movements});
      return{attemptStatuses:attempts.map(item=>item.status),completedSales:completed,finalStock:inventory.body.quantity,movements};
    });

    await scenario('idempotent-completion',async()=>{
      const opened=await state.cashA.request('/api/v1/sales',{method:'POST',body:{saleNumber:'QA-IDEM-SALE'},expected:201});
      await state.cashA.request('/api/v1/sales/'+opened.body.id+'/items',{method:'POST',body:{productId:'qa-idem',quantity:1},expected:200});
      const mutationId='qa-idempotent-complete';
      const attempts=await Promise.all([
        state.cashA.request('/api/v1/sales/'+opened.body.id+'/complete',{method:'POST',headers:{'x-mutation-id':mutationId},body:{payments:[{method:'PIX',amountCents:900}]}}),
        state.cashA.request('/api/v1/sales/'+opened.body.id+'/complete',{method:'POST',headers:{'x-mutation-id':mutationId},body:{payments:[{method:'PIX',amountCents:900}]}})
      ]);
      assert(attempts.every(item=>item.status===200),'Reenvio idempotente nao retornou resultado canonico',{attempts});
      const inventory=await state.admin.request('/api/v1/inventory/qa-idem',{expected:200});
      const movements=movementCount(runtime.db,'qa-idem');
      const payments=runtime.db.prepare('SELECT COUNT(*) AS n FROM payments WHERE sale_id=?').get(opened.body.id).n;
      const events=runtime.db.prepare("SELECT COUNT(*) AS n FROM domain_events WHERE aggregate_id=? AND type='sale.completed'").get(opened.body.id).n;
      assert(inventory.body.quantity===1,'Reenvio baixou estoque mais de uma vez',{inventory:inventory.body,movements});
      assert(movements===1,'Reenvio criou movimento de estoque duplicado',{movements});
      assert(payments===1,'Reenvio duplicou pagamento',{payments});
      assert(events===1,'Reenvio duplicou evento sale.completed',{events});
      state.idempotentSaleId=opened.body.id;
      return{statuses:attempts.map(item=>item.status),finalStock:inventory.body.quantity,movements,payments,events};
    });

    await scenario('cash-session-isolation',async()=>{
      const saleB=await state.cashB.request('/api/v1/sales',{method:'POST',body:{saleNumber:'QA-CASH-B'},expected:201});
      await state.cashB.request('/api/v1/sales/'+saleB.body.id+'/items',{method:'POST',body:{productId:'qa-price',quantity:1},expected:200});
      await state.cashB.request('/api/v1/sales/'+saleB.body.id+'/complete',{method:'POST',headers:{'x-mutation-id':'qa-cash-b-sale'},body:{payments:[{method:'CASH',amountCents:1250}]},expected:200});
      const rowA=runtime.db.prepare('SELECT cash_session_id AS cashSessionId FROM sales WHERE id=?').get(state.stockSaleId);
      const rowB=runtime.db.prepare('SELECT cash_session_id AS cashSessionId FROM sales WHERE id=?').get(saleB.body.id);
      assert(rowA.cashSessionId===state.cashSessionA.id,'Venda do Caixa A foi vinculada a sessao errada',{rowA,expected:state.cashSessionA.id});
      assert(rowB.cashSessionId===state.cashSessionB.id,'Venda do Caixa B foi vinculada a sessao errada',{rowB,expected:state.cashSessionB.id});
      const movementA=runtime.db.prepare('SELECT cash_session_id AS cashSessionId FROM cash_movements WHERE sale_id=? LIMIT 1').get(state.stockSaleId);
      const movementB=runtime.db.prepare('SELECT cash_session_id AS cashSessionId FROM cash_movements WHERE sale_id=? LIMIT 1').get(saleB.body.id);
      assert(movementA?.cashSessionId===state.cashSessionA.id,'Movimento financeiro do Caixa A caiu em outro caixa',{movementA});
      assert(movementB?.cashSessionId===state.cashSessionB.id,'Movimento financeiro do Caixa B caiu em outro caixa',{movementB});
      return{cashA:rowA.cashSessionId,cashB:rowB.cashSessionId};
    });

    await scenario('restaurant-kds-flow',async()=>{
      runtime.restaurant.upsertTable({id:'qa-table',label:'Mesa QA',seats:4,active:true},actor);
      runtime.kitchen.upsertStation({id:'qa-station',name:'Cozinha QA',active:true},actor);
      runtime.kitchen.assignProduct('qa-food','qa-station',actor);
      const waiterA=runtime.mobileDevices.createDevice({id:'qa-waiter-device',name:'Garcom QA',deviceType:'WAITER',userId:'qa-waiter'},actor);
      const waiterB=runtime.mobileDevices.createDevice({id:'qa-waiter-device-2',name:'Garcom QA 2',deviceType:'WAITER',userId:'qa-waiter-2'},actor);
      const kitchen=runtime.mobileDevices.createDevice({id:'qa-kds-device',name:'KDS QA',deviceType:'KITCHEN'},actor);
      const waiterAHttp=deviceClient(base,waiterA);
      const waiterBHttp=deviceClient(base,waiterB);
      const kitchenHttp=deviceClient(base,kitchen);
      state.waiterHttp=waiterAHttp;
      state.kitchenHttp=kitchenHttp;
      const opened=await waiterAHttp('/api/v1/mobile/tables/qa-table/open',{method:'POST',headers:{'x-mutation-id':'qa-table-open'},body:{partySize:2},expected:201});
      const [orderAResponse,orderBResponse]=await Promise.all([
        waiterAHttp('/api/v1/mobile/orders',{method:'POST',headers:{'x-mutation-id':'qa-waiter-order-a'},body:{sessionId:opened.body.id,items:[{productId:'qa-food',quantity:1}]},expected:201}),
        waiterBHttp('/api/v1/mobile/orders',{method:'POST',headers:{'x-mutation-id':'qa-waiter-order-b'},body:{sessionId:opened.body.id,items:[{productId:'qa-food',quantity:1}]},expected:201})
      ]);
      const orderA=orderAResponse.body.order;
      const orderB=orderBResponse.body.order;
      assert(orderA.id!==orderB.id,'Pedidos concorrentes de garcons colidiram',{orderA,orderB});
      const sessionAfterOrders=runtime.restaurant.getSession(opened.body.id);
      assert(sessionAfterOrders.orders.some(item=>item.id===orderA.id)&&sessionAfterOrders.orders.some(item=>item.id===orderB.id),'Um dos pedidos concorrentes foi perdido',{orders:sessionAfterOrders.orders});

      const kds=await kitchenHttp('/api/v1/mobile/context',{expected:200});
      const tickets=kds.body.tickets.filter(item=>item.orderId===orderA.id||item.orderId===orderB.id);
      assert(tickets.length===2,'Os dois pedidos nao chegaram ao KDS',{tickets:kds.body.tickets});
      for(const ticket of tickets){
        await kitchenHttp('/api/v1/mobile/kitchen/tickets/'+ticket.id,{method:'PATCH',body:{status:'PREPARING'},expected:200});
        await kitchenHttp('/api/v1/mobile/kitchen/tickets/'+ticket.id,{method:'PATCH',body:{status:'READY'},expected:200});
      }
      state.restaurantTicketId=tickets[0].id;
      const ready=runtime.restaurant.getSession(opened.body.id);
      const readyOrders=ready.orders.filter(item=>item.id===orderA.id||item.id===orderB.id);
      assert(readyOrders.length===2&&readyOrders.every(item=>item.status==='READY'),'Status READY do KDS nao voltou para todos os pedidos',{orders:readyOrders});

      const checkout=await state.cashA.request('/api/v1/restaurant/sessions/'+opened.body.id+'/checkout',{
        method:'POST',
        headers:{'x-mutation-id':'qa-restaurant-checkout'},
        body:{operatorId:'qa-cash-a'},
        expected:200
      });
      assert(checkout.body.sale.totalCents===3600,'Checkout da mesa somou valor incorreto',{sale:checkout.body.sale});
      const completed=await state.cashA.request('/api/v1/sales/'+checkout.body.sale.id+'/complete',{
        method:'POST',
        headers:{'x-mutation-id':'qa-restaurant-payment'},
        body:{payments:[{method:'PIX',amountCents:3600}]},
        expected:200
      });
      assert(completed.body.dispatch?.failed===0,'Fechamento do restaurante teve falha de efeito',{dispatch:completed.body.dispatch});
      const finalSession=runtime.restaurant.getSession(opened.body.id);
      const finalTable=runtime.restaurant.listTables({includeInactive:true}).find(item=>item.id==='qa-table');
      const finalStock=runtime.inventory.getBalance('qa-food');
      assert(finalSession.status==='CLOSED','Comanda nao fechou apos pagamento',{session:finalSession});
      assert(finalTable.status==='FREE','Mesa nao voltou a ficar livre',{table:finalTable});
      assert(finalStock===3,'Restaurante nao baixou duas unidades do estoque',{finalStock});
      state.restaurantSessionId=opened.body.id;
      return{sessionId:opened.body.id,orders:2,tickets:tickets.length,status:finalSession.status,tableStatus:finalTable.status,finalStock};
    });

    await scenario('authorization-boundaries',async()=>{
      assert(state.kitchenHttp&&state.waiterHttp&&state.restaurantTicketId,'Cenario restaurante deve preparar clientes de dispositivo.');
      const kitchenWaiter=await state.kitchenHttp('/api/v1/mobile/orders',{method:'POST',headers:{'x-mutation-id':'qa-kds-waiter-forbidden'},body:{sessionId:state.restaurantSessionId||'forbidden',items:[{productId:'qa-food',quantity:1}]}});
      assert(kitchenWaiter.status===403,'KDS conseguiu criar pedido pela rota de garçom',{response:kitchenWaiter});
      const waiterKds=await state.waiterHttp('/api/v1/mobile/kitchen/tickets/'+state.restaurantTicketId,{method:'PATCH',body:{status:'READY'}});
      assert(waiterKds.status===403,'Garcom conseguiu operar rota exclusiva de KDS',{response:waiterKds});
      return{kdsToWaiter:kitchenWaiter.status,waiterToKds:waiterKds.status};
    });

    await scenario('scale-10-cashiers-15-waiters-13-orders',async()=>{
      const cashProductId='qa-scale-cash-product';
      const foodProductId='qa-scale-food';
      runtime.catalog.upsertProduct({id:cashProductId,sku:'QA-SCALE-CASH',name:'Produto Caixa Escala',categoryId:'qa-category',salePriceCents:300,costCents:100,trackStock:true,menuEnabled:false,active:true},actor);
      runtime.catalog.upsertProduct({id:foodProductId,sku:'QA-SCALE-FOOD',name:'Prato Escala',categoryId:'qa-category',salePriceCents:450,costCents:150,trackStock:false,menuEnabled:true,active:true},actor);
      runtime.inventory.move({productId:cashProductId,type:'opening',quantityDelta:100,reason:'QA scale seed'},actor);
      runtime.kitchen.upsertStation({id:'qa-scale-station',name:'Cozinha Escala QA',active:true},actor);
      runtime.kitchen.assignProduct(foodProductId,'qa-scale-station',actor);

      const cashierFixtures=[];
      for(let i=1;i<=SCALE_CASHIERS;i+=1){
        const suffix=String(i).padStart(2,'0');
        const userId='qa-scale-cash-user-'+suffix;
        const username='qa-scale-cash-'+suffix;
        const terminal=pairTerminal('SCALE-CAIXA-'+suffix,'Caixa Escala '+suffix);
        runtime.catalog.createUser({id:userId,username,name:'Caixa Escala '+suffix,profileId:'profile-cashier',password:'qa-test-password'});
        const client=await login(base,{username,password:'qa-test-password',terminal});
        const opened=await client.request('/api/v1/cash/sessions',{method:'POST',headers:{'x-mutation-id':'qa-scale-open-cash-'+suffix},body:{initialCashCents:0},expected:201});
        cashierFixtures.push({index:i,userId,terminal,client,session:opened.body.session});
      }
      assert(cashierFixtures.length===SCALE_CASHIERS,'Quantidade de caixas preparada incorretamente',{prepared:cashierFixtures.length});

      const waiterFixtures=[];
      for(let i=1;i<=SCALE_WAITERS;i+=1){
        const suffix=String(i).padStart(2,'0');
        const userId='qa-scale-waiter-user-'+suffix;
        runtime.catalog.createUser({id:userId,username:'qa-scale-waiter-'+suffix,name:'Garcom Escala '+suffix,profileId:'profile-waiter',password:'qa-test-password'});
        const device=runtime.mobileDevices.createDevice({id:'qa-scale-waiter-device-'+suffix,name:'Garcom Escala '+suffix,deviceType:'WAITER',userId},actor);
        waiterFixtures.push({index:i,userId,device,client:deviceClient(base,device)});
      }
      assert(waiterFixtures.length===SCALE_WAITERS,'Quantidade de garcons preparada incorretamente',{prepared:waiterFixtures.length});

      const waiterConnectivity=await runSimultaneousOperations(waiterFixtures.map(item=>({
        kind:'waiter-context',index:item.index,run:()=>item.client('/api/v1/mobile/context',{expected:200})
      })));
      assert(waiterConnectivity.metrics.succeeded===SCALE_WAITERS,'Nem todos os 15 garcons autenticaram simultaneamente',{metrics:waiterConnectivity.metrics,samples:waiterConnectivity.samples.filter(sample=>!sample.ok)});

      const sessions=await Promise.all(Array.from({length:SCALE_SIMULTANEOUS_ORDERS},async(_,idx)=>{
        const n=idx+1;
        const suffix=String(n).padStart(2,'0');
        const tableId='qa-scale-table-'+suffix;
        runtime.restaurant.upsertTable({id:tableId,label:'Mesa Escala '+suffix,seats:4,active:true},actor);
        const opened=await waiterFixtures[idx].client('/api/v1/mobile/tables/'+tableId+'/open',{
          method:'POST',headers:{'x-mutation-id':'qa-scale-table-open-'+suffix},body:{partySize:2},expected:201
        });
        return{index:n,tableId,sessionId:opened.body.id,waiter:waiterFixtures[idx]};
      }));

      const preparedSales=await Promise.all(cashierFixtures.map(async fixture=>{
        const suffix=String(fixture.index).padStart(2,'0');
        const opened=await fixture.client.request('/api/v1/sales',{method:'POST',body:{saleNumber:'QA-SCALE-CASH-SALE-'+suffix},expected:201});
        await fixture.client.request('/api/v1/sales/'+opened.body.id+'/items',{method:'POST',body:{productId:cashProductId,quantity:1},expected:200});
        return{...fixture,saleId:opened.body.id};
      }));

      const simultaneousOperations=[
        ...preparedSales.map(fixture=>({
          kind:'cash-sale',index:fixture.index,saleId:fixture.saleId,
          run:()=>fixture.client.request('/api/v1/sales/'+fixture.saleId+'/complete',{
            method:'POST',headers:{'x-mutation-id':'qa-scale-cash-complete-'+String(fixture.index).padStart(2,'0')},
            body:{payments:[{method:'PIX',amountCents:300}]},expected:200
          })
        })),
        ...sessions.map(session=>({
          kind:'restaurant-order',index:session.index,sessionId:session.sessionId,
          run:()=>session.waiter.client('/api/v1/mobile/orders',{
            method:'POST',headers:{'x-mutation-id':'qa-scale-order-'+String(session.index).padStart(2,'0')},
            body:{sessionId:session.sessionId,items:[{productId:foodProductId,quantity:1}]},expected:201
          })
        })),
        ...waiterFixtures.slice(SCALE_SIMULTANEOUS_ORDERS).map(waiter=>({
          kind:'waiter-context-during-burst',index:waiter.index,
          run:()=>waiter.client('/api/v1/mobile/context',{expected:200})
        }))
      ];

      const burst=await runSimultaneousOperations(simultaneousOperations);
      const failed=burst.samples.filter(sample=>!sample.ok);
      assert(failed.length===0,'A rajada 10 caixas + 15 garcons + 13 pedidos teve falhas',{metrics:burst.metrics,failed});

      const cashSamples=burst.samples.filter(sample=>sample.kind==='cash-sale');
      const orderSamples=burst.samples.filter(sample=>sample.kind==='restaurant-order');
      assert(cashSamples.length===SCALE_CASHIERS&&cashSamples.every(sample=>sample.ok),'Nem todas as 10 vendas simultaneas concluiram',{cashSamples});
      assert(orderSamples.length===SCALE_SIMULTANEOUS_ORDERS&&orderSamples.every(sample=>sample.ok),'Nem todos os 13 pedidos simultaneos foram aceitos',{orderSamples});

      const orderIds=orderSamples.map(sample=>sample.result.body.order.id);
      assert(new Set(orderIds).size===SCALE_SIMULTANEOUS_ORDERS,'Pedidos simultaneos geraram IDs duplicados',{orderIds});
      const placeholders=orderIds.map(()=>'?').join(',');
      const persistedOrders=runtime.db.prepare('SELECT COUNT(*) AS n FROM restaurant_orders WHERE id IN ('+placeholders+')').get(...orderIds).n;
      const routedTickets=runtime.db.prepare('SELECT COUNT(*) AS n FROM kitchen_tickets WHERE order_id IN ('+placeholders+')').get(...orderIds).n;
      assert(persistedOrders===SCALE_SIMULTANEOUS_ORDERS,'Nem todos os 13 pedidos foram persistidos',{persistedOrders,expected:SCALE_SIMULTANEOUS_ORDERS});
      assert(routedTickets===SCALE_SIMULTANEOUS_ORDERS,'Nem todos os 13 pedidos chegaram ao KDS',{routedTickets,expected:SCALE_SIMULTANEOUS_ORDERS});

      const completedSales=runtime.db.prepare("SELECT id,cash_session_id AS cashSessionId FROM sales WHERE id IN ("+preparedSales.map(()=>'?').join(',')+") AND status='COMPLETED'").all(...preparedSales.map(item=>item.saleId));
      assert(completedSales.length===SCALE_CASHIERS,'Nem todas as 10 vendas ficaram COMPLETED',{completed:completedSales.length});
      const expectedSessionBySale=new Map(preparedSales.map(item=>[item.saleId,item.session.id]));
      const wrongCashSession=completedSales.filter(row=>expectedSessionBySale.get(row.id)!==row.cashSessionId);
      assert(wrongCashSession.length===0,'Venda simultanea caiu na sessao de outro caixa',{wrongCashSession});
      assert(new Set(completedSales.map(row=>row.cashSessionId)).size===SCALE_CASHIERS,'As 10 vendas nao ficaram isoladas em 10 sessoes',{sessions:completedSales.map(row=>row.cashSessionId)});

      const finalStock=runtime.inventory.getBalance(cashProductId);
      const movements=movementCount(runtime.db,cashProductId);
      assert(finalStock===90,'As 10 vendas simultaneas nao baixaram exatamente 10 unidades',{finalStock});
      assert(movements===SCALE_CASHIERS,'Quantidade de movimentos das 10 vendas esta incorreta',{movements});

      const details={
        cashiers:SCALE_CASHIERS,
        waiters:SCALE_WAITERS,
        simultaneousOrders:SCALE_SIMULTANEOUS_ORDERS,
        operationsInBurst:simultaneousOperations.length,
        waiterConnectivity:waiterConnectivity.metrics,
        burst:burst.metrics,
        completedSales:completedSales.length,
        persistedOrders,
        routedTickets,
        finalStock,
        stockMovements:movements
      };
      fs.writeFileSync(path.join(outputDir,'scale-10x15x13.json'),JSON.stringify(details,null,2));
      return details;
    });

    await scenario('aggressive-order-ramp',async()=>{
      const foodProductId='qa-ramp-food';
      runtime.catalog.upsertProduct({id:foodProductId,sku:'QA-RAMP-FOOD',name:'Prato Rampa',categoryId:'qa-category',salePriceCents:250,costCents:80,trackStock:false,menuEnabled:true,active:true},actor);
      runtime.kitchen.upsertStation({id:'qa-ramp-station',name:'Cozinha Rampa QA',active:true},actor);
      runtime.kitchen.assignProduct(foodProductId,'qa-ramp-station',actor);

      const waiters=[];
      for(let i=1;i<=SCALE_WAITERS;i+=1){
        const suffix=String(i).padStart(2,'0');
        const userId='qa-ramp-waiter-user-'+suffix;
        runtime.catalog.createUser({id:userId,username:'qa-ramp-waiter-'+suffix,name:'Garcom Rampa '+suffix,profileId:'profile-waiter',password:'qa-test-password'});
        const device=runtime.mobileDevices.createDevice({id:'qa-ramp-waiter-device-'+suffix,name:'Garcom Rampa '+suffix,deviceType:'WAITER',userId},actor);
        waiters.push({index:i,client:deviceClient(base,device)});
      }

      const levels=[];
      for(const level of AGGRESSIVE_ORDER_LEVELS){
        const tableId='qa-ramp-table-'+level;
        runtime.restaurant.upsertTable({id:tableId,label:'Mesa Rampa '+level,seats:4,active:true},actor);
        const opened=await waiters[0].client('/api/v1/mobile/tables/'+tableId+'/open',{
          method:'POST',headers:{'x-mutation-id':'qa-ramp-open-'+level},body:{partySize:4},expected:201
        });
        const sessionId=opened.body.id;
        const operations=Array.from({length:level},(_,idx)=>{
          const waiter=waiters[idx%waiters.length];
          const orderNumber=idx+1;
          return{
            kind:'ramp-order',index:orderNumber,
            run:()=>waiter.client('/api/v1/mobile/orders',{
              method:'POST',
              headers:{'x-mutation-id':'qa-ramp-'+level+'-'+String(orderNumber).padStart(4,'0')},
              body:{sessionId,items:[{productId:foodProductId,quantity:1}]},
              expected:201,
              timeoutMs:LOAD_REQUEST_TIMEOUT_MS
            })
          };
        });

        const batch=await runSimultaneousOperations(operations);
        const orderIds=batch.samples.filter(sample=>sample.ok).map(sample=>sample.result.body.order.id);
        const uniqueOrders=new Set(orderIds).size;
        const persisted=runtime.db.prepare('SELECT COUNT(*) AS n FROM restaurant_orders WHERE table_session_id=?').get(sessionId).n;
        const tickets=runtime.db.prepare('SELECT COUNT(*) AS n FROM kitchen_tickets kt JOIN restaurant_orders ro ON ro.id=kt.order_id WHERE ro.table_session_id=?').get(sessionId).n;
        const levelResult={level,...batch.metrics,uniqueOrders,persistedOrders:persisted,kdsTickets:tickets};
        levels.push(levelResult);
        fs.writeFileSync(path.join(outputDir,'load-metrics.json'),JSON.stringify({levels},null,2));

        assert(batch.metrics.failed===0,'Rampa de '+level+' pedidos teve falhas',{levelResult,failures:batch.samples.filter(sample=>!sample.ok).slice(0,20)});
        assert(uniqueOrders===level,'Rampa de '+level+' pedidos gerou IDs duplicados ou perdeu respostas',{levelResult});
        assert(persisted===level,'Rampa de '+level+' pedidos perdeu persistencia',{levelResult});
        assert(tickets===level,'Rampa de '+level+' pedidos perdeu roteamento ao KDS',{levelResult});
      }

      const highestPassed=levels.filter(item=>item.failed===0&&item.persistedOrders===item.level&&item.kdsTickets===item.level).reduce((max,item)=>Math.max(max,item.level),0);
      assert(highestPassed===Math.max(...AGGRESSIVE_ORDER_LEVELS),'Rampa agressiva nao homologou o nivel maximo',{highestPassed,levels});
      return{waiters:SCALE_WAITERS,levels,highestPassed};
    });

    await scenario('stress-last-unit-races',async()=>{
      const iterations=50;
      let winners=0;
      for(let i=0;i<iterations;i+=1){
        const productId='qa-stress-'+i;
        runtime.catalog.upsertProduct({id:productId,sku:'QA-S-'+i,name:'Stress '+i,categoryId:'qa-category',salePriceCents:100,costCents:20,trackStock:true,menuEnabled:false,active:true},actor);
        runtime.inventory.move({productId,type:'opening',quantityDelta:1,reason:'QA stress'},actor);
        const a=await state.cashA.request('/api/v1/sales',{method:'POST',body:{saleNumber:'QA-STRESS-A-'+i},expected:201});
        const b=await state.cashB.request('/api/v1/sales',{method:'POST',body:{saleNumber:'QA-STRESS-B-'+i},expected:201});
        await state.cashA.request('/api/v1/sales/'+a.body.id+'/items',{method:'POST',body:{productId,quantity:1},expected:200});
        await state.cashB.request('/api/v1/sales/'+b.body.id+'/items',{method:'POST',body:{productId,quantity:1},expected:200});
        const attempts=await Promise.all([
          state.cashA.request('/api/v1/sales/'+a.body.id+'/complete',{method:'POST',headers:{'x-mutation-id':'qa-stress-a-'+i},body:{payments:[{method:'PIX',amountCents:100}]}}),
          state.cashB.request('/api/v1/sales/'+b.body.id+'/complete',{method:'POST',headers:{'x-mutation-id':'qa-stress-b-'+i},body:{payments:[{method:'PIX',amountCents:100}]}})
        ]);
        const success=attempts.filter(item=>item.status===200).length;
        const stock=runtime.inventory.getBalance(productId);
        const movements=movementCount(runtime.db,productId);
        assert(success===1&&stock===0&&movements===1,'Stress detectou sobrevenda',{iteration:i,attempts,stock,movements});
        winners+=success;
      }
      return{iterations,winners};
    });

    await scenario('database-invariants',async()=>{
      const integrity=runtime.db.prepare('PRAGMA integrity_check').all().map(row=>Object.values(row)[0]);
      const foreignKeys=runtime.db.prepare('PRAGMA foreign_key_check').all();
      const negative=runtime.db.prepare('SELECT COUNT(*) AS n FROM inventory_location_balances WHERE quantity<0').get().n;
      const orphanPayments=runtime.db.prepare('SELECT COUNT(*) AS n FROM payments p LEFT JOIN sales s ON s.id=p.sale_id WHERE s.id IS NULL').get().n;
      const completedWithoutPayment=runtime.db.prepare("SELECT COUNT(*) AS n FROM sales s WHERE s.status='COMPLETED' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.sale_id=s.id)").get().n;
      const completedWithoutCashSession=runtime.db.prepare("SELECT COUNT(*) AS n FROM sales WHERE status='COMPLETED' AND cash_session_id IS NULL").get().n;
      const duplicateEffects=runtime.db.prepare('SELECT COUNT(*) AS n FROM (SELECT event_id,effect_key,COUNT(*) AS c FROM domain_event_effects GROUP BY event_id,effect_key HAVING c>1)').get().n;
      assert(integrity.length===1&&integrity[0]==='ok','SQLite integrity_check falhou',{integrity});
      assert(foreignKeys.length===0,'SQLite foreign_key_check encontrou inconsistencias',{foreignKeys});
      assert(negative===0,'Existe estoque negativo no banco',{negative});
      assert(orphanPayments===0,'Existem pagamentos orfaos',{orphanPayments});
      assert(completedWithoutPayment===0,'Existe venda concluida sem pagamento',{completedWithoutPayment});
      assert(completedWithoutCashSession===0,'Existe venda concluida sem sessao de caixa',{completedWithoutCashSession});
      assert(duplicateEffects===0,'Existem efeitos de dominio duplicados',{duplicateEffects});
      return{integrity:'ok',foreignKeyViolations:foreignKeys.length,negativeStockRows:negative,orphanPayments,completedWithoutPayment,completedWithoutCashSession,duplicateEffects};
    });
  }finally{
    await server.stop().catch(()=>{});
    runtime.close();
  }

  const failed=results.filter(item=>item.status==='FAIL');
  const report={schemaVersion:1,profile,generatedAt:new Date().toISOString(),passed:results.length-failed.length,failed:failed.length,scenarios:results};
  fs.writeFileSync(path.join(outputDir,'report.json'),JSON.stringify(report,null,2));
  const stressEvidence=results.filter(item=>['scale-10-cashiers-15-waiters-13-orders','aggressive-order-ramp','stress-last-unit-races'].includes(item.name));
  if(stressEvidence.length)fs.writeFileSync(path.join(outputDir,'stress-evidence.json'),JSON.stringify(stressEvidence,null,2));
  const lines=[
    '# QA Multi-Device LAN',
    '',
    '- Perfil: **'+profile+'**',
    '- Cenarios aprovados: **'+report.passed+'**',
    '- Cenarios com falha: **'+report.failed+'**',
    '',
    '| Cenario | Resultado | Duracao |',
    '|---|---:|---:|',
    ...results.map(item=>'| '+item.name+' | '+item.status+' | '+item.durationMs+' ms |'),
    ''
  ];
  for(const item of failed){
    lines.push('## Falha: '+item.name,'','**'+item.error+'**','',JSON.stringify(item.details,null,2),'');
  }
  fs.writeFileSync(path.join(outputDir,'summary.md'),lines.join('\n'));
  if(failed.length)throw new Error('QA multi-device falhou em '+failed.length+' cenario(s): '+failed.map(item=>item.name).join(', '));
  return report;
}

const invoked=process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url));
if(invoked){
  const options=parseArgs(process.argv.slice(2));
  runMultiDeviceQa(options).then(report=>{
    console.log('QA multi-device '+report.profile+': '+report.passed+' PASS, '+report.failed+' FAIL');
  }).catch(error=>{
    console.error(error.message||error);
    process.exitCode=1;
  });
}

export {PROFILE_SCENARIOS,parseArgs,runMultiDeviceQa};
