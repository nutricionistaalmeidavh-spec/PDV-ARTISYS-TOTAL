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
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.locator('#web-login-form').waitFor({timeout:12000});
  await page.locator('#web-email').fill('owner@example.test');
  await page.locator('#web-password').fill('DummyStrongPassOnlyForCI2026');
  await page.locator('#web-login-form button[type=submit]').click();
  await page.locator('body[data-active-route=checkout]').waitFor({timeout:12000});
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
  await page.locator('#app-sidebar [data-route=checkout]').click();
  const product=page.locator('[data-add-product]').filter({hasText:'Produto Web QA'});
  await product.waitFor({timeout:12000});
  await page.locator('#product-search').fill('Web QA');
  await product.click();
  const cart=page.locator('.cart-line').filter({hasText:'Produto Web QA'});
  await cart.waitFor({timeout:12000});
  assert.equal(await page.locator('#product-search').inputValue(),'Web QA','search query survives cart mutation');
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
  mkdirSync('qa-artifacts',{recursive:true});
  await page.screenshot({path:'qa-artifacts/pdv-web-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'qa-artifacts/pdv-web-mobile.png',fullPage:true});
  const geometry=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(geometry.scroll<=geometry.width+12,'mobile layout has horizontal overflow '+JSON.stringify(geometry));
  assert.deepEqual(errors,[],'browser console or script failures');
  console.log('PASS: real Chromium login -> canonical product -> stock -> checkout -> cash -> payment -> sale, responsive 390px.');
}finally{
  await browser?.close();
  const stop=signal=>{try{if(process.platform==='win32')worker.kill(signal);else process.kill(-worker.pid,signal);}catch{}};
  stop('SIGTERM');await sleep(400);if(worker.exitCode===null)stop('SIGKILL');
}
