import {spawn,spawnSync} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {existsSync,mkdirSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require('playwright');

const origin='http://127.0.0.1:8789';
let wranglerCli=process.env.PDV_WRANGLER_CLI;
if(!wranglerCli){try{wranglerCli=require.resolve('wrangler/bin/wrangler.js');}catch{}}
// Preserve localhost cookie semantics in the browser QA without modifying
// the production Worker config or public custom-domain routing.
const devConfig=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8')
 .split(String.fromCharCode(10)).filter(line=>!line.trimStart().startsWith('//')).join(String.fromCharCode(10)));
delete devConfig.routes;
const devConfigPath=fileURLToPath(new URL('../.wrangler-browser-'+process.pid+'.json',import.meta.url));
writeFileSync(devConfigPath,JSON.stringify(devConfig,null,2),{flag:'wx',mode:0o600});
const devArgs=['dev','--local','--config',devConfigPath,'--ip','127.0.0.1','--port','8789','--var','AUTH_ENABLED:true','--var','COOKIE_SECURE:false','--var','EMAIL_FROM:disabled-in-local-e2e'];
if(process.env.PDV_WORKERD_STATE_PATH)devArgs.push('--persist-to',process.env.PDV_WORKERD_STATE_PATH);
const windowsNpx=resolve(dirname(process.execPath),'node_modules','npm','bin','npx-cli.js');
const useWindowsNpx=!wranglerCli&&process.platform==='win32'&&existsSync(windowsNpx);
const packageRunner=useWindowsNpx?process.execPath:'npx';
const packageArgs=useWindowsNpx?[windowsNpx,'--yes','wrangler@4.137.0',...devArgs]:['--yes','wrangler@4.137.0',...devArgs];
const worker=spawn(wranglerCli?process.execPath:packageRunner,wranglerCli?[wranglerCli,...devArgs]:packageArgs,{
  stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32',
  env:{...process.env,CI:'true'}
});
let stderr='',stdout='';
worker.stderr.on('data',v=>stderr=(stderr+v.toString()).slice(-6000));
worker.stdout.on('data',v=>stdout=(stdout+v.toString()).slice(-6000));
const errors=[];
let browser;
// Traverse the same visible hubs as an operator; never bypass permissions with
// PdvAppNavigation or synthesize hidden sidebar entries in the test.
async function navigateUi(page,route){
  await page.locator('#auth-overlay').waitFor({state:'hidden',timeout:30000});
  const parents={products:'catalog',inventory:'catalog',customers:'catalog',suppliers:'catalog',sellers:'catalog',
    sales:'post-sale',returns:'post-sale',finance:'financial-management','finance-banks':'financial-management',
    'finance-recurrences':'financial-management',management:'financial-management',reports:'financial-management',
    credit:'financial-management',commissions:'financial-management'};
  const parent=parents[route];
  if(route==='saas-admin'){
    await navigateUi(page,'settings');
    await page.locator('#web-settings-tab-team').click();
    await page.locator('#route-content [data-settings-route=saas-admin]').click();
  }else if(parent){
    await page.locator('#sidebar-nav [data-route='+parent+']').click();
    await page.locator('#route-content [data-flow-route='+route+']').click();
  }else if(route==='settings') await page.locator('#app-sidebar > [data-route=settings]').click();
  else await page.locator('#sidebar-nav [data-route='+route+']').click();
  await page.locator('body[data-active-route='+route+']').waitFor({timeout:12000});
}
try{
  let ready=false;
  for(let i=0;i<65;i++){
    if(worker.exitCode!==null)break;
    try{
      const r=await fetch(origin+'/api/v1/health',{signal:AbortSignal.timeout(900)});
      if(r.status===200){ready=true;break;}
    }catch{}
    await sleep(250);
  }
  assert.ok(ready,'Workerd cannot serve browser QA: '+stderr);
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1366,height:860},deviceScaleFactor:1});
  const page=await context.newPage();
  const unexpectedHttp=[];
  const navigationTrace=[];
  page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigationTrace.push({url:frame.url(),at:Date.now()});});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',async response=>{
    if(response.status()<400)return;
    const pathname=new URL(response.url()).pathname;
    if(response.status()===401&&pathname==='/api/v1/auth/session')return; // expected on initial unauthenticated render
    unexpectedHttp.push(response.status()+' '+pathname);
    if(response.status()>=500)console.error('HTTP failure',response.status(),pathname,
      await response.text().catch(()=>''));
  });
  page.on('console',message=>{
    if(message.type()!=='error')return;
    // Chrome emits a generic 401 console error with no URL. All such responses
    // are independently inspected above, so this isn't a blanket status waiver.
    if(message.text().includes('status of 401 (Unauthorized)'))return;
    errors.push(message.text());
  });
  // Public marketing landing is separate from the canonical cashier renderer.
  await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
  await page.locator('#hero-title').waitFor({timeout:12000});
  assert.equal(await page.locator('#web-login-form').count(),0,'marketing must not render the cashier overlay');
  // Full-page screenshots do not inherently trigger IntersectionObserver offscreen entries.
  // Drive the real scroll lifecycle first, verify every reveal fired, then return to hero.
  const revealTargets=page.locator('[data-reveal]');
  for(let i=0,n=await revealTargets.count();i<n;i++){
    await revealTargets.nth(i).scrollIntoViewIfNeeded({timeout:10000});
    await page.waitForTimeout(65);
  }
  assert.equal(await page.locator('[data-reveal]:not(.in-view)').count(),0,
    'scroll reveal must not leave invisible landing content');
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  await page.waitForTimeout(900);
  // Scroll through each reveal target before full-page screenshots, then wait for all transitions.
  // A fullPage screenshot alone does not fire IntersectionObserver for sections outside the viewport.
  await page.evaluate(async()=>{
    const root=document.documentElement;
    const previousBehavior=root.style.scrollBehavior;
    root.style.scrollBehavior='auto';
    const targets=[...document.querySelectorAll('[data-reveal]')];
    for(const node of targets){
      node.scrollIntoView({block:'center',behavior:'instant'});
      await new Promise(resolve=>setTimeout(resolve,85));
    }
    window.scrollTo({top:0,behavior:'instant'});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    root.style.scrollBehavior=previousBehavior;
  });
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-reveal]')]
    .every(node=>node.classList.contains('in-view')),null,{timeout:10000});
  await page.waitForTimeout(900);
  await page.screenshot({path:'qa-artifacts/pdv-landing-desktop.png',fullPage:true});
  // Verify pointer/arrow gallery navigation, readable zoom and preserved account entry.
  await page.locator('[data-gallery-next]').click();
  assert.equal(await page.locator('#tab-cardapio').getAttribute('aria-selected'),'true','gallery next must select menu');
  assert.equal((await page.locator('[data-gallery-counter]').textContent()).trim(),'2 de 4');
  await page.locator('#painel-cardapio img').evaluate(img=>img.decode());
  assert.ok(await page.locator('#painel-cardapio img').evaluate(img=>img.naturalWidth>750),
    'menu photography must be fully loaded and readable');
  await page.locator('[data-gallery-expand]').click();
  assert.equal(await page.locator('#demo-gallery-zoom').evaluate(el=>el.open),true,'gallery preview should enlarge');
  assert.equal(await page.locator('[data-gallery-zoom-content] .demo-panel').count(),1,'zoom contains selected panel');
  await page.locator('#demo-gallery-zoom').screenshot({path:'qa-artifacts/pdv-landing-gallery-zoom-desktop.png'});
  await page.locator('[data-gallery-zoom-close]').click();
  assert.equal(await page.locator('#demo-gallery-zoom').evaluate(el=>el.open),false);
  await page.locator('#tab-cozinha').click();
  await page.locator('.demo-frame .demo-panel:not([hidden])').evaluate(element=>{
    const rect=element.getBoundingClientRect();
    const x=rect.left+rect.width*0.75,y=rect.top+rect.height*0.5;
    element.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:9,pointerType:'touch',clientX:x,clientY:y}));
    element.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:9,pointerType:'touch',clientX:x-120,clientY:y}));
  });
  assert.equal(await page.locator('#tab-caixa').getAttribute('aria-selected'),'true','swipe left must select cashier preview');
  await page.locator('[data-gallery-prev]').click();
  assert.equal(await page.locator('#tab-cozinha').getAttribute('aria-selected'),'true','previous arrow must work');
  await page.locator('#tab-mesas').click();

  // Premium surface visual QA, deliberately before any authenticated session.
  const mainPhoto=page.locator('.photo-hero img');
  assert.equal(await mainPhoto.count(),1,'photo hero must use a real local product image');
  await mainPhoto.evaluate(img=>img.decode());
  assert.ok(await mainPhoto.evaluate(img=>img.naturalWidth>=900),'photographic mockup should load at source resolution');
  assert.equal(await page.locator('.demo-photo-figure img').count(),4,'four photo-led feature previews');
  const premiumStyles=await page.locator('.hero').evaluate(el=>getComputedStyle(el).color);
  assert.ok(premiumStyles,'premium hero must be styled');
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  await page.locator('#hero-title').waitFor();
  await page.waitForTimeout(450);
  await page.screenshot({path:'qa-artifacts/pdv-landing-mobile.png',fullPage:true});
  await page.locator('[data-gallery-next]').click();
  await page.locator('.demo-frame .demo-photo-panel:not([hidden]) img').evaluate(img=>img.decode());
  await page.waitForTimeout(650); // Record settled visual state, not its entry fade.
  await page.locator('.demo-frame').screenshot({path:'qa-artifacts/pdv-landing-gallery-mobile.png'});
  await page.locator('#tab-mesas').click();
  const landingMobileGeometry=await page.evaluate(()=>({
    viewport:innerWidth,scroll:document.documentElement.scrollWidth,
    loginVisible:!!document.querySelector('[data-open-login]')?.getBoundingClientRect().width,
    registerVisible:!!document.querySelector('[data-open-register]')?.getBoundingClientRect().width
  }));
  assert.ok(landingMobileGeometry.scroll<=landingMobileGeometry.viewport+2,
    'premium mobile landing horizontal overflow '+JSON.stringify(landingMobileGeometry));
  assert.ok(landingMobileGeometry.loginVisible&&landingMobileGeometry.registerVisible,
    'mobile login and registration CTAs must remain accessible');
  await page.setViewportSize({width:1366,height:860});

  await page.locator('[data-open-register]').first().click();
  assert.equal(await page.locator('#registration-dialog').evaluate(el=>el.open),true);
  await page.locator('[data-close-register]').click();
  await page.locator('[data-open-login]').first().click();
  assert.equal(await page.locator('#login-dialog').evaluate(el=>el.open),true);
  await page.locator('#landing-login-form input[name=email]').fill('owner@example.test');
  await page.locator('#landing-login-form input[name=password]').fill('DummyStrongPassOnlyForCI2026');
  await page.locator('#landing-login-form button[type=submit]').click();
  await page.waitForURL(origin+'/app/',{timeout:12000});
  await page.locator('body[data-active-route=home]').waitFor({timeout:12000});
  await page.getByRole('heading',{name:'Início',exact:true}).waitFor();
  await page.locator('#web-home-live').waitFor({timeout:30000});
  assert.equal(await page.evaluate(()=>{
    const menu=document.querySelector('.classic-home-section'),indicators=document.querySelector('#web-home-live');
    return Boolean(menu&&indicators&&(menu.compareDocumentPosition(indicators)&Node.DOCUMENT_POSITION_FOLLOWING));
  }),true,'operational shortcuts must precede indicators on mobile and desktop');
  // Optional areas are enabled deliberately in Settings. A business-profile
  // preference remains optional and must never activate another area itself.
  assert.equal(await page.locator('#r4-segment-first-run').count(),0,
    'first login must reach Home without requiring a business segment');
  await navigateUi(page,'settings');
  await page.locator('#web-settings-tab-modules').click();
  for(const moduleId of ['FOOD','WHOLESALE']){
    const checkbox=page.locator('[data-settings-module='+moduleId+']');
    if(!await checkbox.isChecked()){
      assert.equal(await checkbox.isEnabled(),true,'owner must be allowed to configure '+moduleId);
      const [changed]=await Promise.all([page.waitForResponse(response=>response.request().method()==='PATCH'&&
        new URL(response.url()).pathname.endsWith('/modules/'+moduleId),{timeout:12000}),checkbox.check({timeout:12000})]);
      assert.equal(changed.status(),200);
      await page.locator('#web-settings-tab-modules').click();
    }
  }
  const modulesBeforePreference=await page.evaluate(async()=>{
    const api=new window.PdvApiClient.ApiClient();return (await api.modules()).map(({id,enabled})=>({id,enabled}));
  });
  await navigateUi(page,'FOOD');
  await page.locator('[data-r4-action=advanced]').first().click();
  await page.locator('[data-r4-advanced=station]').waitFor();
  assert.equal(await page.locator('[data-r4-advanced=route]').count(),0,
    'KDS settings must not duplicate the canonical product destination editor');
  await page.locator('[data-r4-product-destinations]').waitFor();
  assert.equal(await page.locator('[data-r4-section=pizza],[data-r4-section=weight],[data-r4-section=recipe],[data-r4-section=segments]').count(),0);
  await navigateUi(page,'WHOLESALE');
  await page.locator('#wholesale-item-form').waitFor({timeout:12000});
  await page.locator('#wholesale-new-customer').click();
  await page.locator('#wholesale-customer-form').waitFor({timeout:12000});
  await page.locator('#wholesale-customer-form [name=name]').fill('Atacado QA de navegador');
  await page.locator('#wholesale-customer-form button[type=submit]').click();
  await page.locator('#wholesale-customer-form').waitFor({state:'detached',timeout:12000});
  const earlyWholesaleCustomerId=await page.locator('#wholesale-item-form [name=customerId]').inputValue();
  assert.ok(earlyWholesaleCustomerId,'quick customer creation selects the canonical saved customer');
  await navigateUi(page,'FOOD');
  await page.locator('[data-r4-action=tab][data-id=tables]').click();
  await page.locator('[data-r4-new-table]').click();
  await page.locator('[data-r4-new-table-form]').waitFor({state:'visible',timeout:12000});
  await page.locator('[data-r4-cancel-table]').click();
  await page.locator('[data-r4-new-table-form]').waitFor({state:'hidden',timeout:12000});
  console.log('PASS: canonical KDS routing, Home order, quick customer and + Mesa UI.');
  await navigateUi(page,'settings');
  await page.locator('[data-settings-profile]').click();
  await page.locator('[data-r4-advanced=segment] [name=segmentId]').selectOption('RESTAURANT');
  const preferenceSaved=page.waitForResponse(response=>response.request().method()==='PUT'&&
    new URL(response.url()).pathname.endsWith('/onboarding/segments'));
  await page.locator('[data-r4-advanced=segment] button').click();
  assert.equal((await preferenceSaved).status(),200);
  const modulesAfterPreference=await page.evaluate(async()=>{
    const api=new window.PdvApiClient.ApiClient();return (await api.modules()).map(({id,enabled})=>({id,enabled}));
  });
  assert.deepEqual(modulesAfterPreference,modulesBeforePreference,
    'choosing a business profile must preserve the independently selected areas');
  const savedSegment=await page.evaluate(async()=>{
    const api=new window.PdvApiClient.ApiClient();
    return api.request('/api/v1/onboarding/segments');
  });
  assert.equal(savedSegment.selectedId,'RESTAURANT',
    'saved first-login segment should persist across second authenticated browser session');
  assert.equal(await page.locator('#auth-overlay').isVisible(),false,
    'persisted segment must not intercept cashier pointer events');

  // Every hosted destination inherited from the desktop must have one real,
  // reachable renderer. Empty business data is valid; placeholders, errors and
  // screens left loading are not.
  const routeAudit=['catalog','customers','suppliers','sellers','post-sale','sales','returns',
    'financial-management','management','finance','finance-banks','finance-recurrences',
    'reports','credit','commissions','access'];
  for(const route of routeAudit){
    await navigateUi(page,route);
    await page.waitForFunction(expected=>{
      if(document.body.dataset.activeRoute!==expected)return false;
      const host=document.querySelector('#route-content');
      return Boolean(host?.querySelector('h1,h2'))&&!host.querySelector('.ops-loader')&&
        !/^Carregando\b/i.test(host.innerText.trim());
    },route,{timeout:20000});
    const audit=await page.evaluate(expected=>({
      route:document.body.dataset.activeRoute,
      owner:window.PdvRouteRegistry?.ownerOf?.(expected),
      text:document.querySelector('#route-content')?.innerText||''
    }),route);
    assert.equal(audit.route,route);
    assert.ok(audit.owner,'route '+route+' must have one canonical renderer');
    assert.doesNotMatch(audit.text,/Módulo previsto|Não foi possível carregar|ainda não está disponível na versão online/i,
      'route '+route+' rendered a placeholder or failed state');
  }

  await navigateUi(page,'credit');
  await page.locator('[data-credit-new-customer]').click();
  await page.locator('#credit-customer-form [name=name]').fill('Cliente crediário QA');
  await page.locator('#credit-customer-form [name=creditLimit]').fill('150,00');
  await page.locator('#credit-customer-form button[type=submit]').click();
  await page.locator('#credit-customer-form').waitFor({state:'detached',timeout:12000});
  await page.waitForFunction(expected=>
    document.querySelector('[data-credit-form] [name=customerId] option:checked')?.textContent===expected,
  'Cliente crediário QA',{timeout:20000});
  const customerReadsBefore=await page.evaluate(()=>performance.getEntriesByType('resource').filter(entry=>/\/customers(?:\?|$)/.test(new URL(entry.name).pathname+new URL(entry.name).search)).length);
  await navigateUi(page,'financial-management');
  await navigateUi(page,'credit');
  const customerReadsAfter=await page.evaluate(()=>performance.getEntriesByType('resource').filter(entry=>/\/customers(?:\?|$)/.test(new URL(entry.name).pathname+new URL(entry.name).search)).length);
  assert.equal(customerReadsAfter,customerReadsBefore,'revisiting a reference-data screen must use the short-lived scoped cache');

  // P4: exercise real hosted finance routes without changing canonical accounting.
  await navigateUi(page,'finance-banks');
  await page.locator('#cloud-bank-create').waitFor({timeout:12000});
  for(const route of ['finance','finance-recurrences','management']){
    const previousPage=await page.locator('#route-content .ops-page').first().elementHandle();
    await page.locator('.ops-page nav [data-route="'+route+'"]').click();
    await page.locator('body[data-active-route="'+route+'"]').waitFor({timeout:12000});
    await page.waitForFunction(element=>!element.isConnected,previousPage,{timeout:20000});
    await page.waitForFunction(expected=>{
      const host=document.querySelector('#route-content');
      return document.body.dataset.activeRoute===expected&&Boolean(host?.querySelector('h1'))&&
        !host.querySelector('.ops-loader')&&!/^Carregando\b/i.test(host.innerText.trim());
    },route,{timeout:20000});
    const previousDestination=await page.locator('#route-content .ops-page').first().elementHandle();
    const backLoaded=page.waitForResponse(response=>response.request().method()==='GET'&&
      new URL(response.url()).pathname.endsWith('/finance-advanced/accounts'),{timeout:20000});
    await navigateUi(page,'finance-banks');await backLoaded;
    await page.waitForFunction(element=>!element.isConnected,previousDestination,{timeout:20000});
  }
  const bankPage=await page.locator('#route-content .ops-page').first().elementHandle();
  await navigateUi(page,'finance-recurrences');await page.waitForFunction(element=>!element.isConnected,bankPage,{timeout:20000});
  const financePage=await page.locator('#route-content .ops-page').first().elementHandle();
  const reconciliationLoaded=page.waitForResponse(response=>response.request().method()==='GET'&&
    new URL(response.url()).pathname.endsWith('/finance-advanced/accounts'),{timeout:20000});
  await page.locator('.ops-page nav [data-route="finance-banks"]').click();
  await reconciliationLoaded;await page.waitForFunction(element=>!element.isConnected,financePage,{timeout:20000});
  await page.locator('#cloud-bank-create').waitFor({timeout:20000});
  assert.doesNotMatch(await page.locator('#route-content').innerText(),/enviar ao D1/i);
  await page.locator('[data-bank-page=previous]').waitFor();
  await page.locator('[data-bank-page=next]').waitFor();
  console.log('PASS: credit quick customer and finance navigation buttons.');
  const walletSuffix=Date.now().toString(36);
  const primaryWalletName=`Carteira P4 QA ${walletSuffix}`;
  const supportWalletName=`Carteira B P4 QA ${walletSuffix}`;
  await page.locator('#cloud-bank-create [name=name]').fill(primaryWalletName);
  await page.locator('#cloud-bank-create [name=walletKind]').selectOption('CASH');
  const walletCreated=page.waitForResponse(response=>response.request().method()==='POST'&&
    new URL(response.url()).pathname.endsWith('/finance-advanced/accounts'),{timeout:20000});
  await page.locator('#cloud-bank-create button[type=submit]').click();
  const walletResponse=await walletCreated;
  assert.equal(walletResponse.status(),201,await walletResponse.text());
  await page.locator('.ops-card').filter({hasText:primaryWalletName}).first().waitFor({timeout:20000});

  // P0: two independent non-bank wallets, a genuine opening and atomic transfer.
  await page.locator('#cloud-bank-create [name=name]').fill(supportWalletName);
  await page.locator('#cloud-bank-create [name=walletKind]').selectOption('OTHER');
  await page.locator('#cloud-bank-create button[type=submit]').click();
  await page.locator('.ops-card strong').filter({hasText:supportWalletName}).first().waitFor({timeout:12000});
  await page.locator('#cloud-wallet-ops').waitFor({timeout:12000});
  await page.locator('#cloud-wallet-adjust [name=accountId]').selectOption({label:primaryWalletName});
  await page.locator('#cloud-wallet-adjust [name=kind]').selectOption('OPENING');
  await page.locator('#cloud-wallet-adjust [name=amount]').fill('25,00');
  await page.locator('#cloud-wallet-adjust [name=reason]').fill('Fundo operacional contado');
  const openedWallet=page.waitForResponse(response=>response.request().method()==='POST'&&
    new URL(response.url()).pathname.endsWith('/finance-advanced/wallets/movement'),{timeout:12000});
  await page.locator('#cloud-wallet-adjust button[type=submit]').click();
  const openingResponse=await openedWallet;
  assert.equal(openingResponse.status(),201,await openingResponse.text());
  await page.waitForFunction(()=>/R\$\s*25,00/.test(document.querySelector('#route-content')?.innerText||''),
    null,{timeout:12000});
  await page.locator('#cloud-wallet-transfer [name=fromAccountId]').selectOption({label:primaryWalletName});
  await page.locator('#cloud-wallet-transfer [name=toAccountId]').selectOption({label:supportWalletName});
  await page.locator('#cloud-wallet-transfer [name=amount]').fill('10,00');
  await page.locator('#cloud-wallet-transfer [name=reason]').fill('Transferência para carteira de apoio');
  await page.locator('#cloud-wallet-transfer button[type=submit]').click();
  await page.waitForFunction(()=>/R\$\s*15,00/.test(document.querySelector('#route-content')?.innerText||'')&&
    /R\$\s*10,00/.test(document.querySelector('#route-content')?.innerText||''),null,{timeout:12000});
  await page.locator('#cloud-wallet-history-form [name=accountId]').selectOption({label:primaryWalletName});
  await page.locator('#cloud-wallet-history-form button[type=submit]').click();
  await page.locator('#cloud-wallet-history tr').filter({hasText:'Transferência para carteira de apoio'}).waitFor({timeout:12000});
  await page.screenshot({path:'qa-artifacts/pdv-p0-wallet-ledger-transfer.png',fullPage:true});
  const bankFilter=page.locator('#cloud-bank-filters');
  await bankFilter.locator('select[name=status]').selectOption('UNMATCHED');
  await bankFilter.locator('input[name=query]').fill('Teste de conciliação');
  await bankFilter.locator('button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#cloud-bank-filters [name=query]')?.value==='Teste de conciliação',
    null,{timeout:12000});
  assert.equal(await page.locator('#cloud-bank-filters [name=status]').inputValue(),'UNMATCHED');
  await page.locator('#cloud-chart-of-accounts summary').click();
  await page.locator('#cloud-plan-group').waitFor({timeout:12000});
  await page.screenshot({path:'qa-artifacts/pdv-p4-wallets-bank-filters-plan.png',fullPage:true});
  await navigateUi(page,'finance-recurrences');
  await page.getByRole('heading',{name:'Alertas de vencimento e recorrência'}).waitFor({timeout:12000});
  await page.screenshot({path:'qa-artifacts/pdv-p4-recurrence-alerts.png',fullPage:true});
  await navigateUi(page,'finance');
  await page.getByRole('heading',{name:'Vencimentos — próximos 30 dias'}).waitFor({timeout:12000});
  await page.locator('#web-finance-filters select[name=status]').selectOption('OVERDUE');
  await page.locator('#web-finance-filters button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#web-finance-filters select[name=status]')?.value==='OVERDUE',
    null,{timeout:12000});
  await page.screenshot({path:'qa-artifacts/pdv-p4-finance-due-dates.png',fullPage:true});

  // SaaS owner administration: live Workerd/D1, real cookie, browser and server checks.
  await navigateUi(page,'saas-admin');
  await page.locator('#saas-admin #saas-branch-form').waitFor({timeout:12000});
  assert.match(await page.locator('#saas-admin').innerText(),/Seu estabelecimento/);
  await page.screenshot({path:'qa-artifacts/pdv-saas-admin-desktop.png',fullPage:true});
  await page.locator('#saas-branch-form [name=code]').fill('WEBQA02');
  await page.locator('#saas-branch-form [name=name]').fill('Filial browser QA');
  await page.locator('#saas-branch-form button[type=submit]').click();
  await page.locator('#saas-admin .saas-list').filter({hasText:'Filial browser QA'}).first().waitFor({timeout:12000});
  const invitedEmail=`web-employee-${Date.now()}@example.test`;
  await page.locator('#saas-invite-form [name=email]').fill(invitedEmail);
  await page.locator('#saas-invite-form [name=profileKey]').selectOption('CASHIER');
  const inviteResponse=page.waitForResponse(response=>response.request().method()==='POST'&&
    new URL(response.url()).pathname.endsWith('/invitations'),{timeout:12000});
  await page.locator('#saas-invite-form button[type=submit]').click();
  assert.equal((await inviteResponse).status(),201,'owner creates a unique employee invitation');
  await page.locator('#saas-invite-secret:not([hidden])').waitFor({timeout:12000});
  const code=await page.locator('#saas-invite-code').inputValue();
  assert.match(code,/^[a-f0-9]{64}$/,'browser gets exactly one private invitation code');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'qa-artifacts/pdv-saas-admin-mobile.png',fullPage:true});
  await page.setViewportSize({width:1366,height:860});

  // An invited employee creates a distinct identity without inheriting OWNER permissions.
  const staffContext=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
  const staffPage=await staffContext.newPage();
  try{
    await staffPage.goto(origin+'/app/',{waitUntil:'domcontentloaded'});
    await staffPage.locator('.web-invite-activation summary').click();
    await staffPage.locator('#web-invite-form').waitFor({timeout:12000});
    await staffPage.locator('#web-invite-form [name=token]').fill(code);
    await staffPage.locator('#web-invite-form [name=email]').fill(invitedEmail);
    await staffPage.locator('#web-invite-form [name=displayName]').fill('Funcionario QA');
    await staffPage.locator('#web-invite-form [name=password]').fill('Employee-Strong-2026-Pass!');
    await staffPage.locator('#web-invite-form button[type=submit]').click();
    await staffPage.getByText('Conta ativada. Entre com seu e-mail e senha.').waitFor({timeout:12000});
    await staffPage.locator('#web-login-form').waitFor({timeout:12000});
    await staffPage.locator('#web-email').fill(invitedEmail);
    await staffPage.locator('#web-password').fill('Employee-Strong-2026-Pass!');
    await staffPage.locator('#web-login-form button[type=submit]').click();
    await staffPage.locator('body[data-active-route=home]').waitFor({timeout:12000});
    await navigateUi(staffPage,'settings');
    await staffPage.locator('#web-settings-tab-team').click();
    assert.equal(await staffPage.locator('#route-content [data-settings-route=saas-admin]').count(),0,
      'merchant SaaS administrator must not appear for a cashier');
  }finally{await staffContext.close();}
  await navigateUi(page,'checkout');
  await page.locator('body[data-active-route=checkout]').waitFor();
  await page.locator('#product-search').waitFor({state:'visible',timeout:12000});

  assert.equal(await page.locator('#product-search').count(),1,'only the canonical checkout renderer should exist');
  await navigateUi(page,'inventory');
  await page.locator('#web-catalog-master [data-master-product]').click();
  await page.locator('#web-product-name').fill('Produto Web QA');
  const sku='BROWSER-'+Date.now();
  const barcodeBase=`789${String(Date.now()).slice(-9)}`;
  const barcodeCheck=(10-(barcodeBase.split('').reduce((sum,digit,index)=>
    sum+Number(digit)*(index%2===0?1:3),0)%10))%10;
  const barcode=barcodeBase+barcodeCheck;
  await page.locator('#web-product-sku').fill(sku);
  await page.locator('#web-product-form [name=barcode]').fill(barcode);
  await page.locator('#web-product-price').fill('12,90');
  await page.locator('#web-product-form button[type=submit]').click();
  await page.locator('#web-product-form').waitFor({state:'detached',timeout:12000});
  const masterRow=page.locator('#web-catalog-master [data-master-rows] tr').filter({hasText:sku});
  await masterRow.waitFor({timeout:12000});
  const masterId=await masterRow.locator('[data-master-edit]').getAttribute('data-master-edit');
  assert.ok(masterId,'new product belongs to the master stock register');
  await navigateUi(page,'products');
  assert.equal(await page.locator('.web-product-row').filter({hasText:sku}).count(),0,
    'a new master product must not become sellable before the operator adds it to Cardápio');
  await page.locator('#web-new-product').click();
  await page.locator('#web-menu-select [name=productId]').selectOption(masterId);
  await page.locator('#web-menu-select button[type=submit]').click();
  await page.locator('#web-menu-select').waitFor({state:'detached',timeout:12000});
  await page.locator('.web-product-row').filter({hasText:sku}).waitFor();
  // P1 category management regression: category rename must stay operable in
  // the canonical web UI and category filtering must not hide uncategorized goods.
  await page.locator('#web-new-category').click();
  await page.locator('#web-category-form input[name=name]').fill('Categoria QA');
  await page.locator('#web-category-form button[type=submit]').click();
  await page.locator('#web-category-form').waitFor({state:'detached',timeout:12000});
  await page.locator('#web-new-category').click();
  await page.locator('[data-edit-web-category]').filter({hasText:'Renomear'}).first().click();
  await page.locator('#web-category-form input[name=name]').fill('Categoria testada');
  await page.locator('#web-category-form button[type=submit]').click();
  await page.locator('#web-category-form').waitFor({state:'detached',timeout:12000});
  const category=page.locator('#web-products-category-filter option').filter({hasText:'Categoria testada'});
  const categoryId=await category.getAttribute('value');
  assert.ok(categoryId,'renamed category must be available to the filter');
  await page.locator('#web-products-category-filter').selectOption(categoryId);
  assert.equal(await page.locator('.web-product-row').filter({hasText:sku}).count(),0,
    'unassigned product must not leak into a different category');
  await page.locator('#web-products-category-filter').selectOption('uncategorized');
  await page.locator('.web-product-row').filter({hasText:sku}).waitFor({timeout:12000});
  await page.locator('#web-products-category-filter').selectOption('');

  const row=page.locator('.web-product-row').filter({hasText:sku});
  const openProductOptions=async productRow=>{
    const details=productRow.locator('.web-product-options');
    if(!await details.evaluate(element=>element.open))await details.locator('summary').click();
  };
  await row.locator('[data-web-edit]').click();
  await page.locator('#web-edit-product-form').waitFor({timeout:12000});
  await page.locator('#web-edit-product-name').fill('Produto Web QA');
  await page.locator('#web-edit-product-form button[type=submit]').click();
  await page.locator('#web-edit-product-form').waitFor({state:'detached',timeout:12000});
  await openProductOptions(row);
  await row.locator('[data-web-transfer]').waitFor({state:'visible',timeout:12000});
  await row.locator('[data-web-stock]').click();
  await page.locator('#web-stock-qty').fill('2');
  await page.locator('#web-stock-form button[type=submit]').click();
  await page.locator('.web-product-row').filter({hasText:sku}).getByText('2',{exact:true}).waitFor();
  // Parity: signed stock adjustment and immutable movement audit in the SAME products UI.
  await openProductOptions(row);
  await row.locator('[data-web-adjust]').click();
  await page.locator('#web-adjust-qty').fill('-0.5');
  await page.locator('#web-adjust-reason').fill('Contagem física QA no balcão');
  await page.locator('#web-adjust-form button[type=submit]').click();
  await page.locator('#web-adjust-form').waitFor({state:'detached',timeout:12000});
  await openProductOptions(row);
  await row.locator('[data-web-moves]').click();
  await page.getByText('Contagem física QA no balcão').waitFor({timeout:12000});
  await page.screenshot({path:'qa-artifacts/pdv-parity-stock-history.png',fullPage:true});
  await page.locator('.web-stock-history [data-close-modal]').click();

  // P2: a real deflated OOXML spreadsheet goes through the SAME preview/commit
  // pipeline as CSV. No external conversion service or client-side catalog.
  await page.locator('#web-import-csv').click();
  const workbook=Buffer.from('UEsDBBQAAAAIAPsKUl0O+t6SBQEAAKQCAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbK2STU7DMBCFrxJ5W8VOWSCEknRRYAlIlAMM9iSx4j953BJuj5sWhFChm65G9rx539No6tVkTbHDSNq7hi15xQp00ivt+oa9bh7KG7Zq681HQCqy1FHDhpTCrRAkB7RA3Ad0udP5aCHlZ+xFADlCj+Kqqq6F9C6hS2Xae7C2vsMOtiYV91P+PmAjGmLF+iDcsxoGIRgtIeW+2Dn1i1IeCTxPzhoadKBFFjBxkrDv/A04zj3lPUStsHiGmB7BZpWYjHj3cXzzfuT/m5xI6btOS1Rebm0e4RQigqIBMVnD58otaLc4z5/FJOayvHCQb/8zOWiAiOolxXwbdPFl/PD+yiHms2s/AVBLAwQUAAAACAD7ClJdHEn3vqQAAAAWAQAACwAAAF9yZWxzLy5yZWxzjc/BDsIgDAbgVyG9O6YHY8zYLsZkVzMfAFnHyAYlgDrfXo7OePDY9P+/plWz2Jk9MERDTsC2KIGhU9QbpwVcu/PmAE1dXXCWKSfiaHxkueKigDElf+Q8qhGtjAV5dHkzULAy5TFo7qWapEa+K8s9D58GrE3W9gJC22+BdS+P/9g0DEbhidTdoks/TnwlsiyDxiRgmfmTwnQjmoqMAq8rvnqwfgNQSwMEFAAAAAgA+wpSXU+lbXewAAAADAEAAA8AAAB4bC93b3JrYm9vay54bWyNj8EOgjAMhl9l6V2GHowhgBdjws2DPsBkRRbZStqhPr4LyN1T27/t1/7l8eMH9UIWR6GCbZaDwtCSdeFRwe163hzgWJdv4ued6KnSdJAK+hjHQmtpe/RGMhoxpE5H7E1MJT+0jIzGSo8Y/aB3eb7X3rgAC6HgfxjUda7FE7WTxxAXCONgYvpVejcK1OV8QX5RBeOxgguTnSIJqFltbDIGiguXEm7sFnRd6nVRr97qL1BLAwQUAAAACAD7ClJd8KZigaYAAAAXAQAAGgAAAHhsL19yZWxzL3dvcmtib29rLnhtbC5yZWxzjc9LCsIwEADQq4TZ22ldiEjTbkToVuoBQjpNSpsPSfzd3uBCLLhwNczvDVO3D7OwG4U4OcuhKkpgZKUbJqs4XPrTZg9tU59pESlPRD35yPKKjRx0Sv6AGKUmI2LhPNncGV0wIuU0KPRCzkIRbstyh+HbgLXJuoFD6IYKWP/09I/txnGSdHTyasimHyfw7sIcNVHKqAiKEodPKeI7VEVWAZsaVx82L1BLAwQUAAAACAD7ClJdvcTU17cAAAAKAQAAFAAAAHhsL3NoYXJlZFN0cmluZ3MueG1sXY/BasMwEER/RehuSymklCLLFENOPbQ0AV+FvbFFrJWrXZVe+235saiUEvDxzRsYxrTfYRFfkMhHbOSu1lIADnH0ODXydDxUT7K1hohFKSI1cmZen5WiYYbgqI4rYDHnmILjgmlStCZwI80AHBb1oPWjCs6jFEPMyI3cS5HRf2bo/rkMeGvY0iUbxdaoX/yL0AXYZuQWeEt+gA6QaWv714++en+ptN5t1fVnyk4Ej5Dccpeq3LM3UEsDBBQAAAAIAPsKUl2SUUGotgAAAFwBAAAYAAAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sXZBbDsIgEEW3Qvi3Q/ERNUDjI65AF0BabBsLNEBaly82psH+MffMcDLDirfu0KCcb63hOM8IRsqUtmpNzfHjflvtcSHYaN3LN0oFFNuN57gJoT8C+LJRWvrM9spE8rROyxBLV4PvnZLVNKQ7oITsQMvWYMGm7CqDFMzZEbmojWn5fZxyjALHPtaDIAwGwaD8sXPK8n92SRmdGcT/ZwmdJTRpXi8kKdssJHRKtweyEECyEcynEh9QSwECFAMUAAAACAD7ClJdDvrekgUBAACkAgAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAPsKUl0cSfe+pAAAABYBAAALAAAAAAAAAAAAAACAATYBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIAPsKUl1PpW13sAAAAAwBAAAPAAAAAAAAAAAAAACAAQMCAAB4bC93b3JrYm9vay54bWxQSwECFAMUAAAACAD7ClJd8KZigaYAAAAXAQAAGgAAAAAAAAAAAAAAgAHgAgAAeGwvX3JlbHMvd29ya2Jvb2sueG1sLnJlbHNQSwECFAMUAAAACAD7ClJdvcTU17cAAAAKAQAAFAAAAAAAAAAAAAAAgAG+AwAAeGwvc2hhcmVkU3RyaW5ncy54bWxQSwECFAMUAAAACAD7ClJdklFBqLYAAABcAQAAGAAAAAAAAAAAAAAAgAGnBAAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sUEsFBgAAAAAGAAYAhwEAAJMFAAAAAA==','base64');
  await page.locator('#web-import-file').setInputFiles({
    name:'products.xlsx',
    mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer:workbook
  });
  await page.locator('#web-import-preview').getByText('XLSX-QA-001').waitFor({timeout:12000});
  assert.equal(await page.locator('#web-import-confirm').isEnabled(),true,
    'valid XLSX must enable canonical previewed import');
  await page.locator('#web-import-confirm').click();
  await page.locator('.web-product-row').filter({hasText:'XLSX-QA-001'}).waitFor({timeout:12000});

  // R1 regression: Excel can reorder/delete sheets; the first workbook sheet
  // is not necessarily physically named sheet1.xml. Never import decoy content.
  const reorderedWorkbook=Buffer.from('UEsDBBQAAAAIALF0Ul0aGetelAAAAOcAAAAPAAAAeGwvd29ya2Jvb2sueG1sjY/RDoIwDEV/ZdkHWGKMJgR40Rc+o0JhC9u6tDP6+RKQd5/ae296btq8WZYn82I+MSRtrSsl1wA6OIqoJ86U1mRiiVhWKTNoFsJRHVGJAc5VdYWIPtmdUMs/DJ4mP9CDh1ekVHaIUMDiOanzWW3XbA36myZhpNbesWDgma3Z3H5s7c0aqf26SD9ezha6Bo5LOJ7rvlBLAwQUAAAACACxdFJdBVfOko4AAADyAAAAGgAAAHhsL19yZWxzL3dvcmtib29rLnhtbC5yZWxzjc9NCsIwEAXgq5QcoFOCuJCkKzfdihcI6SQpbX7IjKi3N7iQCi5cDfMGvseoC26Gl5woLIW6R9wSaRGYywmAbMBoqM8FU7u4XKPhtlYPxdjVeAQ5DEeoe0OMam9206xFneaDFN31WfAfPDu3WDxne4uY+EcH3HNdKSByQ031yFp8IoL3kH1TBYwKvl4cX1BLAwQUAAAACACxdFJd+zlSupUAAADdAAAAFAAAAHhsL3NoYXJlZFN0cmluZ3MueG1sXY+xDoJAEAV/5UKvSygszHmJMSQWFhgsaFdY4CK3R26XxM8XY2FCOTOveVZEzTtMLKdsVJ2PANKOFFD2cSZeSx9TQF0xDSBzIuxkJNIwQZHnBwjoOXNWvLPq5LVYUGfhiz/FGGjrBCeqkm/pQqyyrc2tbnb1tSwfxe5+3tYqxW7RaBiN0LBwhwafaHovvsX/GNZf7gNQSwMEFAAAAAgAsXRSXQqWELaXAAAANwEAABgAAAB4bC93b3Jrc2hlZXRzL3NoZWV0Mi54bWxdkG0OwiAMQK9COIAFZkw0QOLHRQiiGMcgQDaPL05DkH9tX9uXli8+PpM1JqOXG6cksM05HACStsaptPHBTIXcfHQqlzTeIYVo1HUdciMwQnbg1GPCkq+1i8pK8ugXFAWmpao/wZFilAVOJZ8l4TBLDvrHTi2j/+zcMlYZlP1VwqqENc1DJ2nZtpOwr3rYk84AzUlQfyXfUEsDBBQAAAAIALF0Ul1yr67FhwAAALIAAAAYAAAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sTY5NCgIxDIWvUnoAM+PChbQFYW7gCUqNttg/0sCMtzczC3GR8N4X3iNmbfQeEZHVVnIdVkfmfgUYIWLx49Q6Vrk8GxXPYukFoxP6xxEqGc7TdIHiU9XOHGzx7J2htiqyehYadnGbtWKrU82p4p1JeBrOsFswtI8BdgZ2AEFGwrL/2uD3pvsCUEsBAhQDFAAAAAgAsXRSXRoZ616UAAAA5wAAAA8AAAAAAAAAAAAAAIABAAAAAHhsL3dvcmtib29rLnhtbFBLAQIUAxQAAAAIALF0Ul0FV86SjgAAAPIAAAAaAAAAAAAAAAAAAACAAcEAAAB4bC9fcmVscy93b3JrYm9vay54bWwucmVsc1BLAQIUAxQAAAAIALF0Ul37OVK6lQAAAN0AAAAUAAAAAAAAAAAAAACAAYcBAAB4bC9zaGFyZWRTdHJpbmdzLnhtbFBLAQIUAxQAAAAIALF0Ul0KlhC2lwAAADcBAAAYAAAAAAAAAAAAAACAAU4CAAB4bC93b3Jrc2hlZXRzL3NoZWV0Mi54bWxQSwECFAMUAAAACACxdFJdcq+uxYcAAACyAAAAGAAAAAAAAAAAAAAAgAEbAwAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sUEsFBgAAAAAFAAUAUwEAANgDAAAAAA==','base64');
  const parsedSecond=await page.evaluate(async input=>{
    const bytes=Uint8Array.from(atob(input),c=>c.charCodeAt(0));
    return window.PdvCatalogXlsx.toCsv(bytes);
  },reorderedWorkbook.toString('base64'));
  assert.match(parsedSecond,/XLSX-SHEET2-QA/,'read first logical workbook tab from relationships');
  assert.doesNotMatch(parsedSecond,/Decoy/,'never select unrelated sheet1.xml by filename');
  // External relationship targets must never be dereferenced or accepted as
  // a fallback to an unrelated worksheet bundled in the same file.
  const externalSheet=await page.evaluate(async input=>{
    try{
      await window.PdvCatalogXlsx.toCsv(Uint8Array.from(atob(input),c=>c.charCodeAt(0)));
      return 'accepted';
    }catch(error){return error.message;}
  },'UEsDBBQAAAAIALF0Ul0aGetelAAAAOcAAAAPAAAAeGwvd29ya2Jvb2sueG1sjY/RDoIwDEV/ZdkHWGKMJgR40Rc+o0JhC9u6tDP6+RKQd5/ae296btq8WZYn82I+MSRtrSsl1wA6OIqoJ86U1mRiiVhWKTNoFsJRHVGJAc5VdYWIPtmdUMs/DJ4mP9CDh1ekVHaIUMDiOanzWW3XbA36myZhpNbesWDgma3Z3H5s7c0aqf26SD9ezha6Bo5LOJ7rvlBLAwQUAAAACACxdFJdq2b+IqIAAAAPAQAAGgAAAHhsL19yZWxzL3dvcmtib29rLnhtbC5yZWxzjc/BCsIwDAbgVxl9gGUM8SDbTnrYwYv4AqHL1rG2KW3U+fYWRJjgwWPIz5c/zYUsysw+mTmkYnXWp1YZkXAASNqQw1RyIJ83I0eHksc4QUC94ERQV9Ue4tZQXbM1i35oVeyHXa2K6zPQPziP46zpyPrmyMuPG/DguCRDJBnFOJG82ZRdWtEFS6VmB3SfbZnxT+rMQy5wWoWiR6uga+Dr/+4FUEsDBBQAAAAIALF0Ul37OVK6lQAAAN0AAAAUAAAAeGwvc2hhcmVkU3RyaW5ncy54bWxdj7EOgkAQBX/lQq9LKCzMeYkxJBYWGCxoV1jgIrdHbpfEzxdjYUI5M695VkTNO0wsp2xUnY8A0o4UUPZxJl5LH1NAXTENIHMi7GQk0jBBkecHCOg5c1a8s+rktVhQZ+GLP8UYaOsEJ6qSb+lCrLKtza1udvW1LB/F7n7e1irFbtFoGI3QsHCHBp9oei++xf8Y1l/uA1BLAwQUAAAACACxdFJdCpYQtpcAAAA3AQAAGAAAAHhsL3dvcmtzaGVldHMvc2hlZXQyLnhtbF2QbQ7CIAxAr0I4gAVmTDRA4sdFCKIYxyBANo8vTkOQf21f25eWLz4+kzUmo5cbpySwzTkcAJK2xqm08cFMhdx8dCqXNN4hhWjUdR1yIzBCduDUY8KSr7WLykry6BcUBaalqj/BkWKUBU4lnyXhMEsO+sdOLaP/7NwyVhmU/VXCqoQ1zUMnadm2k7CvetiTzgDNSVB/Jd9QSwMEFAAAAAgAsXRSXXKvrsWHAAAAsgAAABgAAAB4bC93b3Jrc2hlZXRzL3NoZWV0MS54bWxNjk0KAjEMha9SegAz48KFtAVhbuAJSo222D/SwIy3NzMLcZHw3hfeI2Zt9B4RkdVWch1WR+Z+BRghYvHj1DpWuTwbFc9i6QWjE/rHESoZztN0geJT1c4cbPHsnaG2KrJ6Fhp2cZu1YqtTzaninUl4Gs6wWzC0jwF2BnYAQUbCsv/a4Pem+wJQSwECFAMUAAAACACxdFJdGhnrXpQAAADnAAAADwAAAAAAAAAAAAAAgAEAAAAAeGwvd29ya2Jvb2sueG1sUEsBAhQDFAAAAAgAsXRSXatm/iKiAAAADwEAABoAAAAAAAAAAAAAAIABwQAAAHhsL19yZWxzL3dvcmtib29rLnhtbC5yZWxzUEsBAhQDFAAAAAgAsXRSXfs5UrqVAAAA3QAAABQAAAAAAAAAAAAAAIABmwEAAHhsL3NoYXJlZFN0cmluZ3MueG1sUEsBAhQDFAAAAAgAsXRSXQqWELaXAAAANwEAABgAAAAAAAAAAAAAAIABYgIAAHhsL3dvcmtzaGVldHMvc2hlZXQyLnhtbFBLAQIUAxQAAAAIALF0Ul1yr67FhwAAALIAAAAYAAAAAAAAAAAAAACAAS8DAAB4bC93b3Jrc2hlZXRzL3NoZWV0MS54bWxQSwUGAAAAAAUABQBTAQAA7AMAAAAA');
  assert.match(externalSheet,/referências externas/i,
    'XLSX must reject external sheet targets without importing unrelated data');


  // R1 actual import: this repaired sheet selection must reach the canonical
  // server-side preview and atomic SQLite/D1 commit, not merely parse in JS.
  await page.locator('#web-import-csv').click();
  await page.locator('#web-import-file').setInputFiles({
    name:'reordered-catalog.xlsx',
    mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer:reorderedWorkbook
  });
  await page.locator('#web-import-preview').getByText('XLSX-SHEET2-QA').waitFor({timeout:12000});
  assert.equal(await page.locator('#web-import-confirm').isEnabled(),true,
    'valid reordered Excel worksheet must pass server-side preview');
  await page.locator('#web-import-confirm').click();
  await page.locator('.web-product-row').filter({hasText:'XLSX-SHEET2-QA'}).waitFor({timeout:12000});
  assert.equal(await page.locator('.web-product-row').filter({hasText:'Decoy'}).count(),0,
    'unrelated physical sheet1.xml must not create a product');

  // P2 counted inventory: exercise the actual canonical stock screen in Chromium.
  await navigateUi(page,'inventory');
  const countForm=page.locator('#web-stock-count');
  await countForm.waitFor({timeout:12000});
  const productChoice=await countForm.locator('select[name=productId] option').filter({hasText:sku})
    .first().getAttribute('value');
  assert.ok(productChoice,'counted inventory must expose the catalogued product from the canonical API');
  await countForm.locator('select[name=productId]').selectOption(productChoice);
  await countForm.locator('select[name=operation]').selectOption('purchase');
  await countForm.locator('[name=quantity]').fill('1');
  await countForm.locator('[name=reason]').fill('Entrada de lote para teste');
  await countForm.locator('[name=lotCode]').fill('QA-LOTE-01');
  await countForm.locator('[name=manufacturedAt]').fill('2026-10-01');
  await countForm.locator('[name=expiresAt]').fill('2026-11-01');
  await countForm.locator('button[type=submit]').click();
  await page.getByText('QA-LOTE-01',{exact:true}).waitFor({timeout:12000});
  // Historical lot intake must not display a fabricated per-lot balance.
  assert.match(await page.getByText(/Entradas anteriores à migração continuam históricas/).innerText(),/conciliação física/);
  await countForm.locator('select[name=productId]').selectOption(productChoice);
  await countForm.locator('select[name=operation]').selectOption('count');
  await countForm.locator('[name=quantity]').fill('2.25');
  await countForm.locator('[name=reason]').fill('Conferência física no navegador QA');
  await countForm.locator('button[type=submit]').click();
  await page.locator('#web-stock-balances tbody tr').filter({hasText:sku}).getByText('2,25',{exact:true}).waitFor({timeout:12000});
  // P1 bin/shelf address E2E. The assignment never adds or subtracts stock.
  await page.locator('#web-storage-location-create [name=code]').fill('SHELF-QA-01');
  await page.locator('#web-storage-location-create [name=name]').fill('Prateleira de testes');
  await page.locator('#web-storage-location-create button[type=submit]').click();
  await page.locator('#web-storage-location-assign select[name=locationId] option')
    .filter({hasText:'SHELF-QA-01'}).waitFor({state:'attached',timeout:12000});
  await page.locator('#web-storage-location-assign select[name=productId]').selectOption(productChoice);
  const locationId=await page.locator('#web-storage-location-assign select[name=locationId] option')
    .filter({hasText:'SHELF-QA-01'}).getAttribute('value');
  assert.ok(locationId,'new shelf belongs to the branch');
  await page.locator('#web-storage-location-assign select[name=locationId]').selectOption(locationId);
  await page.locator('#web-storage-location-assign button[type=submit]').click();
  await page.locator('#web-storage-locations table tbody tr')
    .filter({hasText:'SHELF-QA-01'}).first().waitFor({timeout:12000});
  await page.screenshot({path:'qa-artifacts/pdv-parity-storage-address.png',fullPage:true});
  await page.screenshot({path:'qa-artifacts/pdv-parity-inventory-count.png',fullPage:true});

  await navigateUi(page,'checkout');
  const product=page.locator('[data-add-product]').filter({hasText:'Produto Web QA'});
  await product.waitFor({timeout:12000});
  // USB HID scanners normally send the barcode followed by Enter. Exercise
  // that full browser flow without claiming physical reader certification.
  await page.locator('#product-search').fill('0000000000000');
  await page.locator('#product-search').press('Enter');
  assert.equal(await page.locator('.cart-line').count(),0,'unknown barcode must never charge a different product');
  await page.locator('#product-search').fill(barcode);
  await page.locator('#product-search').press('Enter');
  await page.locator('.cart-line').filter({hasText:'Produto Web QA'}).waitFor({timeout:12000});
  assert.equal(await page.locator('#product-search').inputValue(),'','accepted scanner input clears for the next scan');
  await page.locator('.cart-line').filter({hasText:'Produto Web QA'}).locator('[data-remove]').click();
  await page.locator('.cart-line').filter({hasText:'Produto Web QA'}).waitFor({state:'detached',timeout:12000});
  await page.locator('#product-search').fill('Web QA');
  await product.click();
  const cart=page.locator('.cart-line').filter({hasText:'Produto Web QA'});
  await cart.waitFor({timeout:12000});
  assert.equal(await page.locator('#product-search').inputValue(),'Web QA','search query survives cart mutation');
  // Parity: manager price override keeps the original catalog price and reason.
  await cart.locator('[data-price-item]').click();
  await page.locator('#price-override-form [name=unitPrice]').fill('11,90');
  await page.locator('#price-override-form [name=reason]').fill('Autorizado pelo gerente no teste de paridade');
  await page.locator('#price-override-form button[type=submit]').click();
  await page.locator('#price-override-form').waitFor({state:'detached',timeout:12000});
  assert.match(await cart.innerText(),/11,90/);

  await page.locator('#finalize-sale').click();
  const cashButton=page.locator('#confirm-open-cash'),paymentButton=page.locator('#confirm-payment');
  await cashButton.or(paymentButton).first().waitFor({timeout:12000});
  if(await cashButton.isVisible())await cashButton.click();
  await paymentButton.waitFor({timeout:12000});
  // Payment has already been seeded with initial method. Replace that line.
  await page.locator('[data-remove-payment]').first().click();
  await page.locator('#new-payment-method').selectOption('PIX');
  // Use the full remaining sale total; the prior browser smoke leaves a legitimate open draft.
  // The canonical payment modal pre-fills the exact server-calculated remainder.
  await page.locator('#add-payment').click();
  const completionResponse=page.waitForResponse(response=>
    response.request().method()==='POST'&&new URL(response.url()).pathname.endsWith('/complete')&&
    new URL(response.url()).pathname.includes('/sales/'),{timeout:12000});
  // Arm the assertion before clicking: success notifications are ephemeral
  // (2s) and can disappear before the API response body is parsed.
  const completionToastWait=page.getByText(/venda .* finalizada/i).waitFor({timeout:12000});
  await page.locator('#confirm-payment').click();
  const completedPayload=await (await completionResponse).json();
  const completedSaleNumber=completedPayload.sale?.saleNumber;
  const expectedTerminalId=await page.evaluate(()=>localStorage.getItem('artisys.pdv.webTerminalId.v1'));
  assert.equal(completedPayload.sale?.terminalId,expectedTerminalId,'browser must never silently complete a draft inherited from another terminal');
  assert.ok(completedSaleNumber,'completion response must identify the exact sale for parity follow-up');
  await completionToastWait;
  await page.waitForFunction(()=>document.querySelectorAll('.cart-line').length===0,null,{timeout:12000});
  // Post-sale receipt dialog is part of the original renderer. Dismiss it
  // through the same accessible close action an operator uses, not force-clicking
  // through its modal overlay or disabling it in production.
  const closePostSale=page.locator('#post-sale-close');
  await closePostSale.waitFor({state:'visible',timeout:1400}).catch(()=>{});
  if(await closePostSale.isVisible())await closePostSale.click();

  assert.equal(await page.locator('.cart-line').count(),0,'completed sale clears the cart once');

  // P3 terminal parity: TWO actual browser profiles, not just server-side fixtures.
  // A suspended sale on one device must not be resumable from another device.
  await product.click();
  await page.locator('.cart-line').filter({hasText:'Produto Web QA'}).waitFor({timeout:12000});
  await page.locator('#suspend-sale').click();
  await page.locator('#modal-root .suspended-item').first().waitFor({timeout:12000});
  const originalSuspendedNumber=(await page.locator('#modal-root .suspended-item strong').first().innerText()).trim();
  assert.ok(originalSuspendedNumber,'terminal A has a suspended draft');
  await page.locator('#modal-root [data-close-modal]').first().click();
  const secondContext=await browser.newContext({viewport:{width:1366,height:860}});
  const secondPage=await secondContext.newPage();
  secondPage.on('pageerror',error=>errors.push('second-terminal: '+error.message));
  await secondPage.goto(origin+'/app/',{waitUntil:'domcontentloaded'});
  await secondPage.locator('#web-login-form').waitFor({timeout:12000});
  await secondPage.locator('#web-email').fill('owner@example.test');
  await secondPage.locator('#web-password').fill('DummyStrongPassOnlyForCI2026');
  await secondPage.locator('#web-login-form button[type=submit]').click();
  await secondPage.locator('body[data-active-route=home]').waitFor({timeout:12000});
  await secondPage.locator('#auth-overlay').waitFor({state:'hidden',timeout:12000});
  assert.equal(await secondPage.evaluate(async()=>{
    const api=new window.PdvApiClient.ApiClient();return (await api.request('/api/v1/onboarding/segments')).selectedId;
  }),'RESTAURANT','the optional business preference persists for a second authenticated browser');
  const secondTerminal=await secondPage.evaluate(()=>localStorage.getItem('artisys.pdv.webTerminalId.v1'));
  assert.ok(secondTerminal?.startsWith('WEB-'));
  assert.notEqual(secondTerminal,expectedTerminalId,'two independent browser profiles must have different terminals');
  const firstBranchId=await page.evaluate(()=>new window.PdvApiClient.ApiClient().branchId);
  const secondBranchId=await secondPage.evaluate(()=>new window.PdvApiClient.ApiClient().branchId);
  assert.equal(secondBranchId,firstBranchId,
    'two terminals must not silently switch filial merely because a new branch sorts first by name');
  await navigateUi(secondPage,'cash');
  await secondPage.locator('#web-cash-open').waitFor({timeout:12000});
  await secondPage.locator('#web-cash-open button[type=submit]').click();
  await secondPage.locator('[data-cash-web=close]').waitFor({timeout:30000});
  const [firstCash,secondCash]=await Promise.all([
    page.evaluate(async()=>{
      const api=new window.PdvApiClient.ApiClient();
      return (await api.openCash(localStorage.getItem('artisys.pdv.webTerminalId.v1')))?.id;
    }),
    secondPage.evaluate(async()=>{
      const api=new window.PdvApiClient.ApiClient();
      return (await api.openCash(localStorage.getItem('artisys.pdv.webTerminalId.v1')))?.id;
    })
  ]);
  assert.ok(firstCash&&secondCash&&firstCash!==secondCash,'two browsers must have independent open cash sessions');
  await navigateUi(secondPage,'checkout');
  await secondPage.locator('[data-add-product]').filter({hasText:'Produto Web QA'}).click();
  await secondPage.locator('.cart-line').filter({hasText:'Produto Web QA'}).waitFor({timeout:12000});
  await secondPage.locator('#suspend-sale').click();
  await secondPage.locator('#modal-root .suspended-item').first().waitFor({timeout:12000});
  const suspendedVisible=await secondPage.locator('#modal-root .suspended-item strong').allTextContents();
  assert.equal(suspendedVisible.length,1,'terminal B must show only its own suspended sale');
  assert.ok(!suspendedVisible.includes(originalSuspendedNumber),'terminal B must not resume terminal A sale');
  await secondPage.locator('#modal-root [data-close-modal]').first().click();
  await navigateUi(secondPage,'cash');
  await secondPage.locator('[data-cash-web=close]').waitFor({timeout:30000});
  await secondPage.locator('[data-cash-web=close]').click();
  await secondPage.locator('.ux-dialog [name=amount]').waitFor({timeout:12000});
  await secondPage.locator('.ux-dialog__confirm').click();
  await secondPage.locator('#web-cash-open').waitFor({timeout:12000});
  const firstStillOpen=await page.evaluate(async()=>{
    const api=new window.PdvApiClient.ApiClient();
    return (await api.openCash(localStorage.getItem('artisys.pdv.webTerminalId.v1')))?.id;
  });
  assert.equal(firstStillOpen,firstCash,'closing terminal B cannot close terminal A');
  await secondContext.close();

  // A suspended sale must remain reachable after its automatic dialog is
  // closed. Refresh the terminal-scoped list through the permanent checkout
  // action, resume the exact draft, and then cancel it to keep later cases
  // independent.
  await page.locator('#show-suspended-sales').click();
  const originalSuspended=page.locator('#modal-root .suspended-item').filter({hasText:originalSuspendedNumber});
  await originalSuspended.waitFor({timeout:12000});
  await originalSuspended.locator('[data-resume]').click();
  await page.locator('#modal-root').waitFor({state:'hidden',timeout:12000}).catch(()=>{});
  await page.locator('.cart-line').filter({hasText:'Produto Web QA'}).waitFor({timeout:12000});
  assert.equal(await page.locator('.cart-line').filter({hasText:'Produto Web QA'}).count(),1,
    'terminal A can reopen and resume its suspended sale after closing the first dialog');
  await page.locator('#cancel-sale').click();
  await page.locator('#confirm-cancel').click();
  await page.locator('#confirm-cancel').waitFor({state:'detached',timeout:12000});

  // P3 configured catalogue E2E: edit a real product's options in the existing
  // product screen, select variant+required addition in the original composer,
  // and verify the configured snapshot is present in the canonical sale row.
  await navigateUi(page,'products');
  const configuredProductRow=page.locator('.web-product-row').filter({hasText:'Produto Web QA'});
  await openProductOptions(configuredProductRow);
  await configuredProductRow.locator('[data-web-customize]').click();
  await page.locator('#web-config-product-form [data-add-variant]').click();
  const variantRow=page.locator('#web-config-product-form [data-variant-row]').first();
  await variantRow.locator('[name=variantName]').fill('Família');
  await variantRow.locator('[name=variantPrice]').fill('2,50');
  await page.locator('#web-config-product-form [data-add-group]').click();
  const group=page.locator('#web-config-product-form [data-group-row]').first();
  await group.locator('[name=groupName]').fill('Adicionais');
  await group.locator('[name=minSelections]').fill('1');
  await group.locator('[name=maxSelections]').fill('1');
  await group.locator('[data-add-option]').click();
  const option=group.locator('[data-option-row]').first();
  await option.locator('[name=optionName]').fill('Queijo extra');
  await option.locator('[name=optionPrice]').fill('1,20');
  await page.locator('#web-config-product-form button[type=submit]').click();
  await page.locator('#web-config-product-form').waitFor({state:'detached',timeout:12000});

  await navigateUi(page,'checkout');
  await page.locator('[data-add-product]').filter({hasText:'Produto Web QA'}).click();
  await page.locator('#restaurant-config-product-form').waitFor({timeout:12000});
  await page.locator('#restaurant-config-product-form input[name=variantId]').first().check();
  await page.locator('#restaurant-config-product-form [data-option]').first().check();
  await page.locator('#restaurant-config-product-form textarea[name=note]').fill('Adicionar queijo à parte');
  await page.locator('#restaurant-config-product-form button[type=submit]').click();
  await page.locator('#restaurant-config-product-form').waitFor({state:'detached',timeout:12000});
  const configuredCart=page.locator('.cart-line').filter({hasText:'Produto Web QA'});
  await configuredCart.waitFor({timeout:12000});
  assert.match(await configuredCart.innerText(),/Queijo extra|Família/);
  const snap=await page.evaluate(async()=>{
    const client=new window.PdvApiClient.ApiClient();
    const opened=await client.sales('OPEN',25);
    const terminal=localStorage.getItem('artisys.pdv.webTerminalId.v1');
    return opened.find(s=>s.terminalId===terminal)?.items?.find(item=>item.configuration?.variant);
  });
  assert.equal(snap?.configuration?.variant?.name,'Família');
  assert.equal(snap?.configuration?.options?.[0]?.name,'Queijo extra');
  await page.locator('#cancel-sale').click();
  await page.locator('#confirm-cancel').click();
  await page.locator('#confirm-cancel').waitFor({state:'detached',timeout:12000});

  // Parity: the original sales-history route now offers server-side search and paging.
  await navigateUi(page,'sales');
  await page.locator('#web-sales-filter').waitFor({timeout:12000});
  // Filter by the sale actually completed above; prior Workerd smoke leaves
  // legitimate independent sales in the same test D1.
  await page.locator('#web-sales-filter [name=query]').fill(completedSaleNumber);
  // This route previously erased the details after a click during a pending
  // history query. Assert the GET has completed, rather than matching an old row.
  const filteredHistoryResponse=page.waitForResponse(response=>{
    const url=new URL(response.url());
    return response.request().method()==='GET'&&url.pathname.endsWith('/sales/history')&&
      url.searchParams.get('query')===completedSaleNumber;
  },{timeout:12000});
  await page.locator('#web-sales-filter button[type=submit]').click();
  const filterResult=await filteredHistoryResponse;
  assert.equal(filterResult.status(),200,'filtered history API must succeed');
  const historyDownloadEvent=page.waitForEvent('download');
  await page.locator('#web-sales-export').click();
  const historyDownload=await historyDownloadEvent;
  assert.match(historyDownload.suggestedFilename(),/^historico-vendas-.*\.csv$/,
    'filtered immutable history is exportable from its own screen');
  const historyCsv=await readFile(await historyDownload.path(),'utf8');
  assert.match(historyCsv,new RegExp(completedSaleNumber),
    'history export preserves the exact active sale filter');
  assert.doesNotMatch(historyCsv,/Produto de outra venda inexistente/,
    'history export cannot silently ignore the active filter');
  // Network completion does not imply the async view was committed. A matching
  // sale can already be visible in the *old* unfiltered table and its click
  // listener will be destroyed when the filter response later replaces the DOM.
  await page.waitForFunction(reference=>
    document.querySelector('#ops-sales-body')?.dataset.historyQuery===reference,
    completedSaleNumber,{timeout:12000});
  // Wait for the requested sale to replace any pre-filter row before clicking.
  // A prior smoke sale can also make the row COUNT equal to one while filtering
  // is still in flight, causing the old detail pane to be cleared on re-render.
  const matchingSale=page.locator('#ops-sales-body tr[data-search]').filter({hasText:completedSaleNumber});
  await matchingSale.waitFor({state:'visible',timeout:12000});
  assert.equal(await matchingSale.count(),1,'filtered history shows the exact completed sale');
  await page.evaluate(()=>{
    const trace=[];window.__saleDetailTrace=trace;
    trace.push({event:'installed',href:location.href,origin:performance.timeOrigin,buttonType:document.querySelector('[data-sale-details]')?.type,formId:document.querySelector('[data-sale-details]')?.form?.id||null});
    const proto=window.PdvApiClient.ApiClient.prototype;
    const original=proto.sale;
    proto.sale=async function(id){
      trace.push({event:'api-sale-start',id});
      try{const result=await original.call(this,id);trace.push({event:'api-sale-ok',id,status:result?.status});return result;}
      catch(error){trace.push({event:'api-sale-error',id,message:error.message});throw error;}
    };
    // Diagnose pointer dispatch as well as re-render races. A locator click can
    // finish after the target was replaced between pointerdown and pointerup.
    for(const name of ['pointerdown','pointerup','click']){
      window.addEventListener(name,event=>{
        if(trace.length>35)return;
        const el=event.target;
        trace.push({event:name,tag:el?.tagName,buttonId:el?.closest?.('[data-sale-details]')?.dataset.saleDetails||null});
      },true);
    }
    const observer=new MutationObserver(()=>{
      if(trace.length>35)return;
      trace.push({event:'history-dom-mutation',filter:document.querySelector('#ops-sales-body')?.dataset.historyQuery,
        buttons:document.querySelectorAll('[data-sale-details]').length});
    });
    observer.observe(document.getElementById('route-content'),{childList:true,subtree:true});
    const identities=new WeakMap();let serial=0;
    const identity=element=>{if(!identities.has(element))identities.set(element,++serial);return identities.get(element);};
    for(const type of ['pointerdown','mousedown','pointerup','mouseup','click']){
      document.addEventListener(type,event=>{
        const target=event.target;
        const button=target.closest?.('[data-sale-details]');
        trace.push({event:type,tag:target.tagName,id:button?.dataset.saleDetails||null,node:identity(target),
          disabled:button?.disabled??null,connected:target.isConnected,prevented:event.defaultPrevented});
      },true);
    }
    const host=document.getElementById('route-content');
    new MutationObserver(records=>{
      const count=records.filter(r=>r.removedNodes?.length||r.addedNodes?.length).length;
      if(count)trace.push({event:'dom-mutation',count,present:Boolean(document.querySelector('#ops-sales-body [data-sale-details]')),
       disabled:document.querySelector('#ops-sales-body [data-sale-details]')?.disabled});
    }).observe(host,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
  });
  const buttonGeometry=await page.evaluate(()=>{const el=document.querySelector('#ops-sales-body [data-sale-details]');if(!el)return null;const r=el.getBoundingClientRect();return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},display:getComputedStyle(el).display,visibility:getComputedStyle(el).visibility,centerElement:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,210)}});console.log('SALE_DETAILS_BUTTON_GEOMETRY',JSON.stringify(buttonGeometry));
  await matchingSale.locator('[data-sale-details]').click();
  const postClick=await page.evaluate(()=>({trace:window.__saleDetailTrace||null,origin:performance.timeOrigin,href:location.href,route:document.body.dataset.activeRoute}));
  console.log('SALE_DETAIL_CLICK_RESULT',JSON.stringify(postClick));
  try {
    await page.getByText('Autorizado pelo gerente no teste de paridade').waitFor({timeout:12000});
  } catch (error) {
    const debug={
      reference:completedSaleNumber,
      results:await page.locator('#ops-sales-body').innerText(),
      details:await page.locator('#ops-sale-detail').innerText(),
      route:await page.locator('body').getAttribute('data-active-route'),
      notices:await page.locator('[role="alert"],.toast,[role="status"]').allTextContents(),
      trace:await page.evaluate(()=>window.__saleDetailTrace||[]),
      traceDefined:await page.evaluate(()=>Object.hasOwn(window,'__saleDetailTrace')),
      navigations:navigationTrace,
      apiSale:await page.evaluate(async()=>{
        const id=document.querySelector('[data-sale-details]')?.dataset.saleDetails;
        try{
          const client=new window.PdvApiClient.ApiClient();
          const sale=await client.sale(id);
          return {id,number:sale?.saleNumber,items:sale?.items?.map(i=>({
            productName:i.productName,unitPriceCents:i.unitPriceCents,
            catalogUnitPriceCents:i.catalogUnitPriceCents,priceOverrideReason:i.priceOverrideReason
          }))};
        }catch(e){return {id,error:e.message,status:e.status};}
      })
    };
    console.error('HISTORY_PRICE_OVERRIDE_DIAGNOSTIC',JSON.stringify(debug));
    throw error;
  }
  // Sale history must expose a receipt reprint after the canonical sale loads.
  await page.locator('#ops-sale-detail [data-history-print-sale]').waitFor({state:'visible',timeout:12000});
  await page.screenshot({path:'qa-artifacts/pdv-parity-sales-history.png',fullPage:true});

  mkdirSync('qa-artifacts',{recursive:true});
  await page.screenshot({path:'qa-artifacts/pdv-web-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'qa-artifacts/pdv-web-mobile.png',fullPage:true});
  const geometry=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(geometry.scroll<=geometry.width+12,'mobile layout has horizontal overflow '+JSON.stringify(geometry));

  // P3: Close the very same cash session used by checkout.
  await navigateUi(page,'cash');
  await page.getByRole('heading',{name:'Caixa',exact:true}).waitFor({timeout:12000});
  try{
    await page.locator('[data-cash-web=close]').waitFor({timeout:12000});
  }catch(error){
    const diagnostic=await page.evaluate(async()=>{
      const terminalId=localStorage.getItem('artisys.pdv.webTerminalId.v1');
      const client=new window.PdvApiClient.ApiClient();
      const values=await Promise.allSettled([
        client.openCash(terminalId),
        client.cashSessions({terminalId}),
        client.cashSessions()
      ]);
      return {terminalId,screen:document.querySelector('#route-content')?.innerText.slice(0,1200),
        values:values.map(result=>result.status==='fulfilled'
          ?{success:true,value:result.value}
          :{success:false,error:result.reason?.message})};
    });
    console.error('CASH_TERMINAL_E2E_DIAGNOSTIC',JSON.stringify(diagnostic).slice(0,3600));
    throw error;
  }
  await page.locator('[data-cash-web=close]').click();
  await page.locator('.ux-dialog [name=amount]').waitFor();
  await page.locator('.ux-dialog__confirm').click();
  await page.locator('[data-cash-web=close]').waitFor({state:'detached',timeout:12000});
  assert.match(await page.locator('#route-content').innerText(),/Histórico de fechamento/);

  // P4: Create and partially settle a manual payable with the existing UX dialog.
  await navigateUi(page,'finance');
  await page.getByRole('heading',{name:'Financeiro',exact:true}).waitFor({timeout:12000});
  await page.locator('#web-finance-new').click();
  await page.locator('.ux-dialog [name=description]').fill('Energia QA P4');
  await page.locator('.ux-dialog [name=amount]').fill('12,00');
  await page.locator('.ux-dialog [name=dueDate]').fill('2026-10-25');
  await page.locator('.ux-dialog__confirm').click();
  const energyRow=page.locator('#route-content tr').filter({hasText:'Energia QA P4'})
    .filter({has:page.locator('[data-web-settle]')});
  await energyRow.waitFor({timeout:12000});
  await energyRow.locator('[data-web-settle]').click();
  await page.locator('.ux-dialog [name=amount]').fill('5,00');
  await page.locator('.ux-dialog__confirm').click();
  await page.locator('.ux-dialog').waitFor({state:'detached',timeout:12000});
  await page.getByText('Energia QA P4',{exact:true}).first().waitFor();
  await page.waitForFunction(()=>document.querySelector('#route-content')?.innerText.includes('7,00'),null,{timeout:12000});
  assert.match(await page.locator('#route-content').innerText(),/7,00/);
  await page.screenshot({path:'qa-artifacts/pdv-finance-mobile.png',fullPage:true});

  // P5: authorized home indicators are scoped and link back to the one report route.
  await navigateUi(page,'home');
  await page.locator('#web-home-live [data-home-open-report]').waitFor({timeout:30000});
  assert.match(await page.locator('#web-home-live').innerText(),/Terminais com caixa aberto/i);
  // home-003: real PWA shows authorized canonical alerts, not a fake fixture.
  await page.locator('#web-home-operational-alerts').waitFor({timeout:12000});
  assert.match(await page.locator('#web-home-operational-alerts').innerText(),/Alertas operacionais/);
  await page.locator('#web-home-live [data-home-open-report]').click();
  // P4: Shared ReportsV2 owner, no duplicate report rendering pipeline.
  await page.getByRole('heading',{name:'Relatórios comerciais'}).waitFor({timeout:12000});
  const report=await page.locator('#route-content').innerText();
  assert.match(report,/Faturamento registrado/i);
  await page.locator('[data-report-web=overview]').click();
  await page.getByRole('heading',{name:'Evolução diária de vendas líquidas'}).waitFor({timeout:12000});
  await page.locator('[data-report-web=coverage]').click();
  await page.locator('#web-stock-minimum').waitFor({timeout:12000});
  const minimumForm=page.locator('#web-stock-minimum');
  await minimumForm.locator('[name=minimum]').fill('2');
  const minimumMutation=page.waitForResponse(resp=>resp.url().includes('/reports/stock-minimum')&&resp.request().method()==='PUT',{timeout:12000});
  await minimumForm.locator('[type=submit]').click();
  const minimumResponse=await minimumMutation;
  assert.equal(minimumResponse.status(),200,'Stock minimum mutation failed: '+(await minimumResponse.text()));
  await page.waitForFunction(()=>document.querySelector('#report-v2-body')?.textContent.includes('Mínimo 2'),null,{timeout:12000}).catch(async(error)=>{
    const diagnostic=await page.evaluate(()=>({
      form:document.querySelector('#web-stock-minimum')?.textContent,
      body:document.querySelector('#report-v2-body')?.textContent?.slice(-2500),
      lastToast:document.querySelector('[role=alert]')?.textContent
    }));
    throw new Error('P5 minimum view did not refresh: '+JSON.stringify(diagnostic)+'; '+error.message);
  });
  assert.match(await page.locator('#report-v2-body').innerText(),/Abaixo do mínimo|No mínimo|Acima do mínimo/);
  await page.screenshot({path:'qa-artifacts/pdv-minimum-stock-mobile.png',fullPage:true});
  await page.locator('#web-stock-minimum-clear').click();
  await page.waitForFunction(()=>document.querySelector('#report-v2-body')?.textContent.includes('Sem mínimo'),null,{timeout:12000});
  await page.locator('[data-report-web=finance]').click();
  await page.getByText('A pagar').first().waitFor();
  await page.screenshot({path:'qa-artifacts/pdv-reports-mobile.png',fullPage:true});
  await page.locator('[data-report-web=targets]').click();
  await page.locator('#web-seller-target-form').waitFor({timeout:12000});
  await page.locator('#web-seller-target-form [name=target]').fill('9.000,00');
  await page.locator('#web-seller-target-form button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#report-v2-body')?.textContent.includes('9.000,00'),
    null,{timeout:12000});
  assert.match(await page.locator('#report-v2-body').innerText(),/Metas e vendas líquidas|Metas e ranking|Meta mensal/);
  await page.screenshot({path:'qa-artifacts/pdv-seller-targets.png',fullPage:true});
  await page.locator('[data-report-web=overview]').click();
  // P5 comparisons use the canonical API and do not invent rates without a base.
  await page.locator('#web-report-filter [name=from]').fill('2026-10-17');
  await page.locator('#web-report-filter [name=to]').fill('2026-10-17');
  await page.locator('#web-report-filter button[type=submit]').click();
  await page.locator('[data-report-web=overview][aria-selected=true]').waitFor();
  await page.locator('[data-report-web=comparison]').click();
  await page.locator('[data-report-web=comparison][aria-selected=true]').waitFor();
  assert.match(await page.locator('#report-v2-body').innerText(),/Receita líquida|Variação de receita/i);
  assert.match(await page.locator('#report-v2-body').innerText(),/Sem base comparativa anterior/i);
  await page.locator('[data-report-web=comparison]').focus();
  await page.keyboard.press('ArrowRight');
  await page.locator('[data-report-web=products][aria-selected=true]').waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset.reportWeb),'products',
    'keyboard tab navigation must restore focus after asynchronous report render');
  // home-004: Reports scroll and selected period survive a round trip through checkout.
  const reportScroll=await page.evaluate(()=>{
    const e=document.querySelector('#route-content');
    e.scrollTop=Math.min(250,e.scrollHeight-e.clientHeight);
    return e.scrollTop;
  });
  assert.ok(reportScroll>0,'mobile reports must be scrollable to verify restoration');
  await navigateUi(page,'checkout');
  await navigateUi(page,'reports');
  await page.locator('[data-report-web=products][aria-selected=true]').waitFor();
  await page.waitForFunction(top=>document.querySelector('#route-content').scrollTop>=top-8,reportScroll,{timeout:12000});
  // home-004: the canonical report tab regains focus, not just CSS-selected state.
  await page.waitForFunction(()=>document.activeElement?.dataset.reportWeb==='products',null,{timeout:12000});
  assert.equal(await page.locator('#web-report-filter [name=from]').inputValue(),'2026-10-17');
  assert.equal(await page.locator('#web-report-filter [name=to]').inputValue(),'2026-10-17');
  await page.locator('[data-report-web=overview]').click();
  const downloadEvent=page.waitForEvent('download');
  await page.locator('#web-report-export').click();
  const download=await downloadEvent;
  assert.match(download.suggestedFilename(),/vendas-.*\.csv$/);
  // P5: XLSX must be generated by the browser from the canonical report data.
  const spreadsheetEvent=page.waitForEvent('download');
  await page.locator('#web-report-xlsx').click();
  const spreadsheet=await spreadsheetEvent;
  assert.match(spreadsheet.suggestedFilename(),/relatorio-overview-.*\.xlsx$/);
  const spreadsheetBytes=await import('node:fs/promises').then(async fs=>fs.readFile(await spreadsheet.path()));
  assert.equal(spreadsheetBytes.readUInt32LE(0),0x04034b50,'export must be a real ZIP-based XLSX');
  await page.locator('[data-report-web=finance]').click();
  await page.getByText('A pagar').first().waitFor();
  await navigateUi(page,'checkout');
  await navigateUi(page,'reports');
  await page.locator('[data-report-web=finance][aria-selected=true]').waitFor({timeout:12000});
  await page.locator('[data-report-web=overview]').click();
  const manifest=await page.evaluate(async()=>fetch('/manifest.webmanifest').then(r=>r.json()));
  assert.equal(manifest.display,'standalone');
  assert.equal(manifest.icons.length,2);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  const cachesFound=await page.evaluate(async()=> (await caches.keys()).filter(x=>x.startsWith('pdv-total-shell-')));
  assert.equal(cachesFound.length,1,'only the current public shell may be cached');
  await page.setViewportSize({width:1366,height:860});
  await page.screenshot({path:'qa-artifacts/pdv-reports-desktop.png',fullPage:true});

  // R1: the Atacado page must consume unwrapped API objects, allow editing
  // a customer policy, price the cart and confirm a quote in the same PWA.
  await navigateUi(page,'WHOLESALE');
  await page.locator('#wholesale-item-form').waitFor({timeout:12000});
  const wholesaleCustomer={id:earlyWholesaleCustomerId};
  await page.locator('#wholesale-item-form [name=customerId]').selectOption(wholesaleCustomer.id);
  await page.locator('[name=policyCustomerId]').selectOption(wholesaleCustomer.id);
  await page.locator('#wholesale-edit-policy').click();
  await page.locator('#wholesale-policy-form').waitFor({timeout:12000});
  assert.match(await page.locator('#wholesale-policy-form').innerText(),/Atacado QA de navegador/);
  await page.locator('#wholesale-policy-form [name=minimumOrder]').fill('10,00');
  for(const method of ['CASH','DEBIT_CARD','CREDIT_CARD'])
    await page.locator(`#wholesale-policy-form [name=paymentMethod][value=${method}]`).uncheck();
  await page.locator('#wholesale-policy-form button[type=submit]').click();
  await page.locator('#wholesale-policy-form').waitFor({state:'detached',timeout:12000});
  await page.locator('#wholesale-item-form [name=customerId]').selectOption(wholesaleCustomer.id);
  const saleProductOption=await page.locator('#wholesale-item-form [name=productId] option')
    .filter({hasText:'Produto Web QA'}).first().getAttribute('value');
  assert.ok(saleProductOption,'the canonical catalog product must be selectable for wholesale');
  await page.locator('#wholesale-item-form [name=productId]').selectOption(saleProductOption);
  await page.locator('#wholesale-item-form [name=quantity]').fill('2');
  await page.locator('#wholesale-item-form button[type=submit]').click();
  await page.locator('[data-wholesale-cart]').getByText('Produto Web QA').waitFor({timeout:12000});
  assert.match(await page.locator('[data-wholesale-cart]').innerText(),/25,80/,
    'tier-quote browser UI must display the actual extended total in reais');
  await page.locator('#wholesale-create-order').click();
  await page.locator('[data-wholesale-orders] [data-order]').first().waitFor({timeout:12000});
  assert.match(await page.locator('[data-wholesale-orders]').innerText(),/Atacado QA de navegador/);
  await page.locator('[data-wholesale-orders] [data-order-action=confirm]').first().click();
  await page.locator('[data-wholesale-orders]').getByText('Confirmado').first().waitFor({timeout:12000});
  await page.screenshot({path:'qa-artifacts/pdv-wholesale-policy-r1.png',fullPage:true});
  // R4 browser acceptance: multiple different products compose one kitchen
  // order. Every line must remain editable and the order uses the same API.
  const foodProduct=await page.evaluate(async()=>{
    const client=new window.PdvApiClient.ApiClient();await client.initialize();
    return client.saveProduct({name:'Salgado QA R4',sku:'R4-FOOD-'+Date.now(),salePriceCents:900,trackStock:false});
  });
  assert.ok(foodProduct.id);
  await navigateUi(page,'FOOD');
  await page.locator('[data-r4-action=tab][data-id=tables]').click();
  await page.locator('[data-r4-action=tab][data-id=orders]').click();
  const foodForm=page.locator('[data-r4-form=order]');
  await foodForm.waitFor({state:'visible',timeout:12000});
  await foodForm.locator('[name=fulfillment]').selectOption('PICKUP');
  await foodForm.locator('[data-r4-order-item]').first().locator('[name=productId]').selectOption(foodProduct.id);
  await foodForm.locator('[data-r4-action=add-line]').click();
  await foodForm.locator('[data-r4-order-item]').nth(1).locator('[name=productId]').selectOption(saleProductOption);
  await foodForm.locator('[data-r4-order-item]').nth(1).locator('[name=quantity]').fill('2');
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-r4-order-item]')].every(row=>['none','configured'].includes(row.dataset.r4PizzaState)),null,{timeout:12000});
  await foodForm.locator('button.primary-button[type=submit]').click();
  await page.locator('[data-r4-web] .restaurant-list').getByText('Salgado QA R4',{exact:false}).first().waitFor({timeout:12000});
  await page.screenshot({path:'qa-artifacts/pdv-r4-multiline-food.png',fullPage:true});


  assert.deepEqual(unexpectedHttp,[],'unexpected online HTTP errors');
  assert.deepEqual(errors,[],'online browser console or script failures');
  // P5: An offline reload may display only cached public UI. Never queue or cache sales.
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  // ready only guarantees an active registration; wait for this page to be
  // actually controlled before testing offline navigation via the shell.
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller),null,{timeout:12000});
  // Chromium's Playwright network emulation can abort top-level navigations
  // before the Service Worker handles them. Verify the already-installed
  // public shell exists, then simulate offline API failure on the same page.
  const publicShell=await page.evaluate(async()=>{
    const found=await caches.match('/index.html');
    return Boolean(found?.ok&&(await found.text()).includes('PDV Total'));
  });
  assert.equal(publicShell,true,'public offline shell missing from versioned SW cache');
  await context.setOffline(true);
  await page.locator('#web-offline-alert').waitFor({state:'visible',timeout:8000});
  const apiOffline=await page.evaluate(()=>fetch('/api/v1/auth/session')
    .then(()=>false,()=>true));
  assert.equal(apiOffline,true,'offline API fetch must fail, never serve cached private JSON');
  await context.setOffline(false);
  console.log('PASS: P3 cash close, P4 manual finance + partial settlement, ReportsV2 CSV and P5 safe offline PWA.');
  // Network errors after explicit offline toggle are expected; no state writes are queued.
  console.log('PASS: real Chromium login -> canonical product -> stock -> checkout -> cash -> payment -> sale, responsive 390px.');
}catch(error){
  const diagnostic=browser?.contexts()?.[0]?.pages()?.[0];
  if(diagnostic){
    await diagnostic.screenshot({path:'qa-artifacts/pdv-browser-failure.png',fullPage:true}).catch(()=>{});
    console.error('Browser failure state:',await diagnostic.evaluate(()=>({route:document.body.dataset.activeRoute,
      headings:[...document.querySelectorAll('#route-content h1')].map(n=>n.textContent),
      focus:document.activeElement?.outerHTML?.slice(0,500),
      feedback:document.querySelector('[data-module-feedback]')?.textContent,
      modules:[...document.querySelectorAll('[data-settings-module]')].map(n=>({id:n.dataset.settingsModule,checked:n.checked,disabled:n.disabled}))})).catch(()=>({})));
  }
  const traces=await fetch(origin+'/cdn-cgi/local/explorer/api/local/observability/query',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({sql:'SELECT * FROM logs ORDER BY timestamp DESC LIMIT 20'})
  }).then(response=>response.text()).catch(()=> '');
  if(traces)console.error('Workerd observability:',traces);
  if(stderr||stdout)console.error('Workerd failure log:',stderr+'\n'+stdout);
  throw error;
}finally{
  await browser?.close();
  const stop=signal=>{try{if(process.platform==='win32')spawnSync('taskkill',['/pid',String(worker.pid),'/T','/F'],{stdio:'ignore'});else process.kill(-worker.pid,signal);}catch{}};
  stop('SIGTERM');await sleep(400);if(worker.exitCode===null)stop('SIGKILL');
  unlinkSync(devConfigPath);
}
