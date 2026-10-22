import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const origin='http://127.0.0.1:8788';
const require=createRequire(import.meta.url);
let wranglerCli=process.env.PDV_WRANGLER_CLI;
if(!wranglerCli){try{wranglerCli=require.resolve('wrangler/bin/wrangler.js');}catch{}}
// Wrangler 4.137 rewrites the request host to the production Custom Domain
// in local dev. Keep the exact Worker/D1/assets configuration, but omit only
// route declarations from a temporary file; never mutate production config.
const rawConfig=readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');
const devConfig=JSON.parse(rawConfig.split(String.fromCharCode(10))
 .filter(line=>!line.trimStart().startsWith('//')).join(String.fromCharCode(10)));
delete devConfig.routes;
const devConfigPath=fileURLToPath(new URL('../.wrangler-smoke-'+process.pid+'.json',import.meta.url));
writeFileSync(devConfigPath,JSON.stringify(devConfig,null,2),{flag:'wx',mode:0o600});
const devArgs=['dev','--local','--config',devConfigPath,'--ip','127.0.0.1','--port','8788','--var','AUTH_ENABLED:true','--var','COOKIE_SECURE:false'];
if(process.env.PDV_WORKERD_STATE_PATH)devArgs.push('--persist-to',process.env.PDV_WORKERD_STATE_PATH);
const child=spawn(wranglerCli?process.execPath:'npx',wranglerCli?[wranglerCli,...devArgs]:['--yes','wrangler@4.137.0',...devArgs],{
  stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32',env:{...process.env,CI:'true'}
});
let stderr='',stdout='';
child.stderr.on('data',b=>stderr=(stderr+b.toString()).slice(-10000));
child.stdout.on('data',b=>stdout=(stdout+b.toString()).slice(-10000));
try {
  let ready=false,latest;
  for(let i=0;i<50;i++){
    if(child.exitCode!==null)break;
    try {
      const res=await fetch(origin+'/api/v1/health',{signal:AbortSignal.timeout(900)});
      latest=res;
      if(res.status===200&&(await res.json()).status==='identity-ready'){ready=true;break;}
    }catch{}
    await sleep(300);
  }
  assert.ok(ready,'Cloudflare Workerd did not become ready: '+(latest?.status||'no response')+'\n'+stderr+'\n'+stdout);
  const headers={'origin':origin,'content-type':'application/json'};
  const login=await fetch(origin+'/api/v1/auth/login',{
    method:'POST',headers,signal:AbortSignal.timeout(5000),body:JSON.stringify({
      email:'owner@example.test',password:'DummyStrongPassOnlyForCI2026'
    })
  });
  assert.equal(login.status,200,'Cloudflare PBKDF2 or session login failed: '+await login.text());
  const cookie=(login.headers.get('set-cookie')||'').split(';')[0];
  assert.ok(cookie.startsWith('__Host-pdvtotal_session=')||cookie.startsWith('pdvtotal_local_session='));
  const session=await fetch(origin+'/api/v1/auth/session',{headers:{cookie},signal:AbortSignal.timeout(5000)});
  assert.equal(session.status,200,'Cloudflare session failed');
  const identity=await session.json();
  assert.equal(identity.memberships.length,1);
  const tenantId=identity.memberships[0].tenantId;
  const denied=await fetch(origin+'/api/v1/tenants/another-tenant/branches',{headers:{cookie},signal:AbortSignal.timeout(5000)});
  assert.equal(denied.status,404,'Cross-tenant access was not blocked');
  const branch=await fetch(origin+'/api/v1/tenants/'+tenantId+'/branches',{headers:{cookie},signal:AbortSignal.timeout(5000)});
  assert.equal(branch.status,200,'Canonical branch read failed');
  assert.equal((await branch.json()).branches.length,1);
  const home=await fetch(origin+'/app/',{signal:AbortSignal.timeout(5000)});
  assert.equal(home.status,200,'Original PDV renderer static assets not served');
  assert.match(await home.text(),/PDV Total|ArtiSys PDV/);
  const branchId=(await (await fetch(origin+'/api/v1/tenants/'+tenantId+'/branches',{headers:{cookie}})).json()).branches[0].id;
  let sequence=0;
  const write=async(path,body,key='workerd-'+(++sequence)+'-key')=>{
    const out=await fetch(origin+'/api/v1/tenants/'+tenantId+'/'+path,{
      method:'POST',signal:AbortSignal.timeout(5000),
      headers:{...headers,cookie,'x-mutation-id':key},
      body:JSON.stringify({...body,branchId})
    });
    return {status:out.status,data:await out.json()};
  };
  const p=await write('products',{name:'Workerd Coffee',sku:'WORKERD-COFFEE',salePriceCents:1000});
  assert.equal(p.status,201,'create product in Workerd '+JSON.stringify(p.data));
  const pid=p.data.product.id;
  const stocked=await write('inventory/receipts',{productId:pid,quantity:2,type:'opening'});
  assert.equal(stocked.status,201,'stock receipt in Workerd '+JSON.stringify(stocked.data));
  const cash=await write('cash/open',{openingCents:1000});
  assert.equal(cash.status,201,'cash opening in Workerd '+JSON.stringify(cash.data));
  const sale=await write('sales',{});
  assert.equal(sale.status,201,'open sale in Workerd '+JSON.stringify(sale.data));
  const sid=sale.data.sale.id;
  const added=await write('sales/'+sid+'/items',{productId:pid,quantity:1});
  assert.equal(added.status,200,'add item in Workerd '+JSON.stringify(added.data));
  assert.equal(added.data.sale.totalCents,1000);
  const key='workerd-completion-fixed-key-123';
  const result=await write('sales/'+sid+'/complete',{payments:[{method:'PIX',amountCents:1000}]},key);
  assert.equal(result.status,200,'complete sale in Workerd '+JSON.stringify(result.data));
  assert.equal(result.data.sale.totalCents,1000);
  const replay=await write('sales/'+sid+'/complete',{payments:[{method:'PIX',amountCents:1000}]},key);
  assert.equal(replay.status,200,'replay idempotently on Workerd');
  assert.deepEqual(replay.data,result.data);
  const stockRes=await fetch(origin+'/api/v1/tenants/'+tenantId+'/inventory?branchId='+encodeURIComponent(branchId),{headers:{cookie}});
  assert.equal(stockRes.status,200);
  const stock=await stockRes.json();
  assert.equal(stock.stock.find(x=>x.productId===pid).quantity,1,'one completed sale must decrement exactly one unit');

  if(process.env.RUN_BROWSER_SMOKE==='true'){
    const {chromium}=createRequire(import.meta.url)('playwright');
    const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    try{
      const page=await browser.newPage({viewport:{width:1280,height:800},locale:'pt-BR'});
      const jsErrors=[];
      page.on('pageerror',error=>jsErrors.push(error.message));
      await page.goto(origin+'/app/',{waitUntil:'domcontentloaded'});
      await page.getByRole('heading',{name:'Entre na sua loja'}).waitFor({timeout:12000});
      await page.getByLabel('E-mail',{exact:true}).fill('owner@example.test');
      await page.getByLabel('Senha',{exact:true}).fill('SenhaIncorreta_2026');
      await page.getByRole('button',{name:'Entrar no PDV'}).click();
      await page.getByText('Credenciais inválidas.').waitFor();
      assert.equal(await page.getByLabel('E-mail',{exact:true}).inputValue(),'owner@example.test','failed login must preserve entered e-mail');
      await page.getByLabel('Senha',{exact:true}).fill('DummyStrongPassOnlyForCI2026');
      await page.getByRole('button',{name:'Entrar no PDV'}).click();
      await page.locator('#auth-overlay').waitFor({state:'hidden',timeout:12000});
      await page.getByRole('heading',{name:'Início',exact:true}).waitFor({timeout:12000});
      assert.equal(await page.locator('#r4-segment-first-run').count(),0,'an optional business profile must not block first access');
      assert.equal(await page.locator('#auth-overlay').isVisible(),false,'successful login must release operating application focus');
      await page.locator('#sidebar-nav [data-route="checkout"]').click();
      await page.getByRole('heading',{name:'Balcão',exact:true}).waitFor();
      await page.locator('[data-add-product="'+pid+'"]').waitFor({timeout:12000});
      assert.equal(await page.locator('[data-add-product="'+pid+'"]').count(),1,'canonical product should reach original checkout');
      await page.locator('[data-add-product="'+pid+'"]').click();
      await page.locator('.cart-line').first().waitFor({timeout:12000});
      assert.match(await page.locator('.cart-list').innerText(),/Workerd Coffee/);
      assert.match(await page.locator('.totals').innerText(),/R\$\s*10,00/);
      await page.locator('#sidebar-nav [data-route="catalog"]').click();
      await page.locator('[data-flow-route="inventory"]').click();
      await page.getByRole('heading',{name:'Estoque',exact:true}).waitFor();
      await page.getByRole('button',{name:'+ Produto / insumo',exact:true}).click();
      await page.getByLabel('Nome do produto').fill('Produto do navegador');
      await page.getByLabel('SKU / código').fill('BROWSER-TEST');
      await page.getByLabel('Preço de venda (R$)').fill('12,50');
      await page.getByRole('button',{name:'Salvar produto'}).click();
      await page.getByRole('heading',{name:'Estoque',exact:true}).waitFor();
      await page.locator('#sidebar-nav [data-route="catalog"]').click();
      await page.locator('[data-flow-route="products"]').click();
      await page.getByRole('heading',{name:'Cardápio',exact:true}).waitFor();
      assert.equal(await page.locator('.web-product-row').filter({hasText:'Produto do navegador'}).count(),0,'a master record is not sellable until explicitly added to the menu');
      await page.getByRole('button',{name:'+ Adicionar ao Cardápio',exact:true}).click();
      await page.locator('#web-menu-select select[name="productId"]').selectOption({label:'Produto do navegador · BROWSER-TEST'});
      await page.locator('#web-menu-select [type="submit"]').click();
      await page.getByText('Produto do navegador').first().waitFor();
      await page.locator('.web-product-row').filter({hasText:'Produto do navegador'}).getByRole('button',{name:'Registrar entrada',exact:true}).click();
      await page.getByLabel('Quantidade recebida').fill('3');
      await page.locator('#web-stock-form button[type=submit]').click();
      await page.locator('#sidebar-nav [data-route="checkout"]').click();
      await page.getByRole('heading',{name:'Balcão'}).waitFor();
      const cartAfter=await page.locator('.cart-list').innerText();
      assert.match(cartAfter,/Workerd Coffee/,'cart must survive route changes');
      await page.setViewportSize({width:390,height:844});
      const geometry=await page.evaluate(()=>({
        width:document.documentElement.scrollWidth,viewport:window.innerWidth
      }));
      assert.ok(geometry.width<=geometry.viewport+2,
        'mobile navigation caused horizontal overflow '+JSON.stringify(geometry));
      assert.deepEqual(jsErrors,[],'renderer must load without javascript errors');
      console.log('PASS: Chromium original renderer login recovery, product CRUD, stock, cart and 390px responsive layout.');
    } finally {await browser.close();}
  }
  const logout=await fetch(origin+'/api/v1/auth/session',{method:'DELETE',headers:{cookie,origin},signal:AbortSignal.timeout(5000)});
  assert.equal(logout.status,200,'Logout failed');
  const revoked=await fetch(origin+'/api/v1/auth/session',{headers:{cookie},signal:AbortSignal.timeout(5000)});
  assert.equal(revoked.status,401,'Session was not revoked');
  console.log('PASS: real Cloudflare Workerd + assets + D1 + canonical sale/stock/cash/permissions/idempotency + logout.');
}finally{
  // npx may spawn a long-lived Wrangler grandchild; kill the whole process group.
  const stop=signal=>{try{if(process.platform==='win32')child.kill(signal);else process.kill(-child.pid,signal);}catch{}};
  stop('SIGTERM');
  await sleep(400);
  if(child.exitCode===null)stop('SIGKILL');
  unlinkSync(devConfigPath);
}
