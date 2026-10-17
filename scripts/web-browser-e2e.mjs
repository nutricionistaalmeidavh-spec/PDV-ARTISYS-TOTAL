import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const origin='http://127.0.0.1:8789';
const worker=spawn('npx',['--yes','wrangler@4.137.0','dev','--local','--ip','127.0.0.1','--port','8789','--var','AUTH_ENABLED:true','--var','COOKIE_SECURE:false'],{
  stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32',
  env:{...process.env,CI:'true'}
});
let stderr='';
worker.stderr.on('data',v=>stderr=(stderr+v.toString()).slice(-6000));
const errors=[];
let browser;
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
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{
    if(response.status()<400)return;
    const pathname=new URL(response.url()).pathname;
    if(response.status()===401&&pathname==='/api/v1/auth/session')return; // expected on initial unauthenticated render
    unexpectedHttp.push(response.status()+' '+pathname);
  });
  page.on('console',message=>{
    if(message.type()!=='error')return;
    // Chrome emits a generic 401 console error with no URL. All such responses
    // are independently inspected above, so this isn't a blanket status waiver.
    if(message.text().includes('status of 401 (Unauthorized)'))return;
    errors.push(message.text());
  });
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.locator('#web-login-form').waitFor({timeout:12000});
  await page.locator('#web-email').fill('owner@example.test');
  await page.locator('#web-password').fill('DummyStrongPassOnlyForCI2026');
  await page.locator('#web-login-form button[type=submit]').click();
  await page.locator('body[data-active-route=checkout]').waitFor({timeout:12000});
  await page.locator('#product-search').waitFor({state:'visible',timeout:12000});
  assert.equal(await page.locator('#product-search').count(),1,'only the canonical checkout renderer should exist');
  await page.locator('#app-sidebar [data-route=products]').click();
  await page.locator('#web-new-product').click();
  await page.locator('#web-product-name').fill('Produto Web QA');
  const sku='BROWSER-'+Date.now();
  await page.locator('#web-product-sku').fill(sku);
  await page.locator('#web-product-price').fill('12,90');
  await page.locator('#web-product-form button[type=submit]').click();
  await page.locator('.web-product-row').filter({hasText:sku}).waitFor();
  const row=page.locator('.web-product-row').filter({hasText:sku});
  await row.locator('[data-web-stock]').click();
  await page.locator('#web-stock-qty').fill('2');
  await page.locator('#web-stock-form button[type=submit]').click();
  await page.locator('.web-product-row').filter({hasText:sku}).getByText('2',{exact:true}).waitFor();
  // Parity: signed stock adjustment and immutable movement audit in the SAME products UI.
  await row.locator('[data-web-adjust]').click();
  await page.locator('#web-adjust-qty').fill('-0.5');
  await page.locator('#web-adjust-reason').fill('Contagem física QA no balcão');
  await page.locator('#web-adjust-form button[type=submit]').click();
  await page.locator('#web-adjust-form').waitFor({state:'detached',timeout:12000});
  await row.locator('[data-web-moves]').click();
  await page.getByText('Contagem física QA no balcão').waitFor({timeout:12000});
  await page.screenshot({path:'qa-artifacts/pdv-parity-stock-history.png',fullPage:true});
  await page.locator('.web-stock-history [data-close-modal]').click();

  await page.locator('#app-sidebar [data-route=checkout]').click();
  const product=page.locator('[data-add-product]').filter({hasText:'Produto Web QA'});
  await product.waitFor({timeout:12000});
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
  await page.locator('#confirm-payment').click();
  await page.getByText(/venda .* finalizada/i).waitFor({timeout:12000});
  await page.waitForFunction(()=>document.querySelectorAll('.cart-line').length===0,null,{timeout:12000});
  assert.equal(await page.locator('.cart-line').count(),0,'completed sale clears the cart once');
  // Parity: the original sales-history route now offers server-side search and paging.
  await page.locator('#app-sidebar [data-route=sales]').click();
  await page.locator('#web-sales-filter').waitFor({timeout:12000});
  const saleNumber=await page.locator('#ops-sales-body tr').first().locator('td').first().innerText();
  await page.locator('#web-sales-filter [name=query]').fill(saleNumber.trim());
  await page.locator('#web-sales-filter button[type=submit]').click();
  await page.locator('#ops-sales-body tr[data-search]').first().waitFor({timeout:12000});
  assert.equal(await page.locator('#ops-sales-body tr[data-search]').count(),1);
  await page.locator('[data-sale-details]').first().click();
  await page.getByText('Autorizado pelo gerente no teste de paridade').waitFor({timeout:12000});
  await page.screenshot({path:'qa-artifacts/pdv-parity-sales-history.png',fullPage:true});

  mkdirSync('qa-artifacts',{recursive:true});
  await page.screenshot({path:'qa-artifacts/pdv-web-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'qa-artifacts/pdv-web-mobile.png',fullPage:true});
  const geometry=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(geometry.scroll<=geometry.width+12,'mobile layout has horizontal overflow '+JSON.stringify(geometry));

  // P3: Close the very same cash session used by checkout.
  await page.locator('#app-sidebar [data-route=cash]').click();
  await page.getByRole('heading',{name:'Caixa',exact:true}).waitFor({timeout:12000});
  await page.locator('[data-cash-web=close]').waitFor({timeout:12000});
  await page.locator('[data-cash-web=close]').click();
  await page.locator('.ux-dialog [name=amount]').waitFor();
  await page.locator('.ux-dialog__confirm').click();
  await page.locator('[data-cash-web=close]').waitFor({state:'detached',timeout:12000});
  assert.match(await page.locator('#route-content').innerText(),/Histórico de fechamento/);

  // P4: Create and partially settle a manual payable with the existing UX dialog.
  await page.locator('#app-sidebar [data-route=finance]').click();
  await page.getByRole('heading',{name:'Financeiro',exact:true}).waitFor({timeout:12000});
  await page.locator('#web-finance-new').click();
  await page.locator('.ux-dialog [name=description]').fill('Energia QA P4');
  await page.locator('.ux-dialog [name=amount]').fill('12,00');
  await page.locator('.ux-dialog [name=dueDate]').fill('2026-10-25');
  await page.locator('.ux-dialog__confirm').click();
  await page.getByText('Energia QA P4').waitFor({timeout:12000});
  await page.locator('[data-web-settle]').first().click();
  await page.locator('.ux-dialog [name=amount]').fill('5,00');
  await page.locator('.ux-dialog__confirm').click();
  await page.locator('.ux-dialog').waitFor({state:'detached',timeout:12000});
  await page.getByText('Energia QA P4',{exact:true}).first().waitFor();
  await page.waitForFunction(()=>document.querySelector('#route-content')?.innerText.includes('7,00'),null,{timeout:12000});
  assert.match(await page.locator('#route-content').innerText(),/7,00/);
  await page.screenshot({path:'qa-artifacts/pdv-finance-mobile.png',fullPage:true});

  // P4: Shared ReportsV2 owner, no duplicate report rendering pipeline.
  await page.locator('#app-sidebar [data-route=reports]').click();
  await page.getByRole('heading',{name:'Relatórios comerciais'}).waitFor({timeout:12000});
  const report=await page.locator('#route-content').innerText();
  assert.match(report,/Faturamento registrado/i);
  await page.locator('[data-report-web=finance]').click();
  await page.getByText('A pagar').first().waitFor();
  await page.screenshot({path:'qa-artifacts/pdv-reports-mobile.png',fullPage:true});
  await page.locator('[data-report-web=overview]').click();
  const downloadEvent=page.waitForEvent('download');
  await page.locator('#web-report-export').click();
  const download=await downloadEvent;
  assert.match(download.suggestedFilename(),/vendas-.*\.csv$/);
  const manifest=await page.evaluate(async()=>fetch('/manifest.webmanifest').then(r=>r.json()));
  assert.equal(manifest.display,'standalone');
  assert.equal(manifest.icons.length,2);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  const cachesFound=await page.evaluate(async()=> (await caches.keys()).filter(x=>x.startsWith('pdv-total-shell-')));
  assert.equal(cachesFound.length,1,'only the current public shell may be cached');
  await page.setViewportSize({width:1366,height:860});
  await page.screenshot({path:'qa-artifacts/pdv-reports-desktop.png',fullPage:true});

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
}finally{
  await browser?.close();
  const stop=signal=>{try{if(process.platform==='win32')worker.kill(signal);else process.kill(-worker.pid,signal);}catch{}};
  stop('SIGTERM');await sleep(400);if(worker.exitCode===null)stop('SIGKILL');
}
