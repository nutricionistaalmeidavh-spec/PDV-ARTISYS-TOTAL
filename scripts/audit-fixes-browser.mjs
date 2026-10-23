// Regression of the published application's active UI against the real local
// API and all migrations. This never connects to a production environment.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {openLocalDatabase} from '../apps/api/src/local-db.mjs';
import {createApi} from '../apps/api/src/worker.mjs';
import {serveLocalPwa} from '../apps/api/src/local-static.mjs';
import {hashPassword} from '../apps/api/src/password.mjs';
const engines=createRequire(import.meta.url)('playwright');
const db=openLocalDatabase(),stamp=new Date().toISOString(),password='Somente-teste-123!';
for(const file of readdirSync(new URL('../apps/api/migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())
  db.exec(readFileSync(new URL('../apps/api/migrations/'+file,import.meta.url),'utf8'));
await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind('audit','audit-local','Auditoria local',stamp).run();
await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)').bind('branch','audit','MAIN','Matriz',stamp).run();
await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').bind('owner','audit@example.com','Operador de teste',await hashPassword(password),stamp).run();
await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)').bind('audit','owner','OWNER',stamp).run();
const api=createApi({DB:db,AUTH_ENABLED:'true',COOKIE_SECURE:'false'});
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1:'+server.address().port);
    let result;
    if(url.pathname.startsWith('/api/')){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      result=await api.fetch(new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}));
    }else result=await serveLocalPwa(url.pathname,{rootDir:resolve('dist/web'),method:req.method});
    res.writeHead(result.status,Object.fromEntries(result.headers.entries()));res.end(Buffer.from(await result.arrayBuffer()));
  }catch(error){res.writeHead(500);res.end(String(error));}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const browser=await engines[process.env.PDV_TEST_BROWSER||'chromium'].launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],badRequests=[];
page.setDefaultTimeout(10000);
page.on('pageerror',error=>errors.push(error.message));
page.on('response',response=>{const path=new URL(response.url()).pathname;if(path.startsWith('/api/')&&response.status()>=400&&!(path==='/api/v1/auth/session'&&response.status()===401))badRequests.push({url:path,status:response.status()});});
const artifacts=resolve('qa-artifacts/audit-fixes');mkdirSync(artifacts,{recursive:true});
const main=page.locator('#route-content'),modal=page.locator('#modal-root');
const sidebar=label=>page.locator('#sidebar-nav').getByRole('button',{name:label,exact:true});
const waitHeading=label=>main.getByRole('heading',{name:label,exact:true}).waitFor();
const inventory=async()=>{await sidebar('Cadastros').click();await main.getByRole('button',{name:/Estoque e fichas técnicas/}).click();await main.locator('#web-catalog-master [data-master-product]').waitFor();};
try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/app/');
  await page.locator('#web-email').fill('audit@example.com');await page.locator('#web-password').fill(password);
  await page.locator('#web-login-form').getByRole('button',{name:'Entrar no PDV',exact:true}).click();
  await waitHeading('Início');await main.locator('#web-home-live .ops-metric strong').first().waitFor();
  await page.waitForFunction(()=>document.querySelector('#web-home-live .ops-metric strong')?.textContent.trim());
  const metric=await main.locator('#web-home-live .ops-metric strong').first().evaluate(node=>({text:node.textContent,color:getComputedStyle(node).color}));
  assert.notEqual(metric.color,'rgb(255, 255, 255)');assert.ok(metric.text.trim());
  assert.ok((await main.locator('[data-home-route="catalog"]').count())>0);
  await page.screenshot({path:resolve(artifacts,'inicio.png')});

  await inventory();
  await main.getByRole('button',{name:'+ Produto / insumo',exact:true}).click();
  await modal.locator('[name=name]').fill('Farinha de teste');await modal.locator('[name=sku]').fill('FARINHA');
  await modal.locator('[name=price]').fill('3,00');await modal.locator('[name=usageType]').selectOption('INGREDIENT');
  await modal.locator('[name=unit]').selectOption('KG');await modal.getByRole('button',{name:'Salvar produto',exact:true}).click();
  await modal.waitFor({state:'hidden'});await main.locator('#web-catalog-master').getByText('Farinha de teste',{exact:true}).waitFor();
  const flour=await db.prepare("SELECT id,menu_enabled FROM products WHERE sku='FARINHA'").bind().first();assert.equal(flour.menu_enabled,0);
  // A real stock receipt supplies the recipe; seeding stock is not the UI under test.
  const cookie=await page.context().cookies();
  const call=async(path,body,method='POST')=>{
    const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/v1/tenants/audit/'+path,{method,headers:{cookie:cookie.map(x=>x.name+'='+x.value).join('; '),origin:'http://127.0.0.1:'+server.address().port,'content-type':'application/json','x-mutation-id':crypto.randomUUID()},body:JSON.stringify({branchId:'branch',...body})});
    const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;
  };
  await call('inventory/receipts',{productId:flour.id,quantity:2,unitCostCents:300});
  await main.getByRole('button',{name:'+ Ficha técnica',exact:true}).click();
  await main.getByRole('button',{name:'Criar produto preparado',exact:true}).click();
  await modal.locator('[name=name]').fill('Pão de teste');await modal.locator('[name=sku]').fill('PAO');await modal.locator('[name=price]').fill('1,00');
  assert.equal(await modal.locator('[name=track]').isChecked(),false);
  await modal.getByRole('button',{name:'Salvar produto',exact:true}).click();await modal.waitFor({state:'hidden'});
  await main.locator('#web-catalog-master [data-master-rows]').getByText('Pão de teste',{exact:true}).waitFor();
  const bread=await db.prepare("SELECT id,menu_enabled FROM products WHERE sku='PAO'").bind().first();assert.equal(bread.menu_enabled,0);
  await main.locator('tr').filter({has:page.getByText('Pão de teste',{exact:true})}).getByRole('button',{name:'Criar ficha',exact:true}).click();
  const recipe=main.locator('[data-r4-advanced="recipe"]');await recipe.waitFor();
  await recipe.locator('[name=yieldQuantity]').fill('10');await recipe.locator('[name=portionQuantity]').fill('1');
  await recipe.locator('[name=ingredientId]').selectOption(flour.id);await recipe.locator('[name=ingredientUnit]').selectOption('G');
  await recipe.locator('[name=ingredientQuantity]').fill('500');await recipe.locator('[name=lossPercent]').fill('10');
  await recipe.getByRole('button',{name:/Salvar/}).click();
  await page.waitForFunction(()=>/Ficha técnica versão \d+ salva/.test(document.querySelector('#toast-root')?.textContent||''));
  await page.screenshot({path:resolve(artifacts,'ficha-tecnica.png')});
  await inventory();await main.getByRole('button',{name:'Abrir Cardápio',exact:true}).click();await waitHeading('Cardápio');
  assert.equal(await main.locator('[data-web-edit]').count(),0);
  await main.getByRole('button',{name:'+ Adicionar ao Cardápio',exact:true}).click();
  assert.equal(await modal.locator('[name=productId] option').count(),2); // placeholder + bread, no ingredient
  await modal.locator('[name=productId]').selectOption(bread.id);await modal.getByRole('button',{name:'Adicionar ao Cardápio',exact:true}).click();
  await modal.waitFor({state:'hidden'});await main.getByText('Pão de teste',{exact:true}).waitFor();
  assert.equal(await main.getByText('Farinha de teste',{exact:true}).count(),0);

  await sidebar('Balcão').click();await waitHeading('Balcão');
  await main.getByRole('button',{name:'Comandas e pedidos',exact:true}).click();
  await modal.getByText('Nenhuma comanda ou pedido encontrado.',{exact:true}).waitFor();await modal.getByRole('button',{name:'Fechar',exact:true}).last().click();
  await main.locator('[data-add-product="'+bread.id+'"]').click();await main.locator('.cart-line').first().waitFor();
  await main.getByRole('button',{name:/Finalizar venda/}).click();await modal.getByRole('button',{name:'Abrir caixa',exact:true}).click();
  await modal.getByRole('button',{name:'Concluir venda',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#route-content .cart-list')?.textContent.includes('Nenhum item na venda.'));
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM sales WHERE status='COMPLETED'").bind().first()).n,1);
  assert.equal((await db.prepare('SELECT balance_milli AS n FROM stock_positions WHERE product_id=?').bind(flour.id).first()).n,1945);
  await page.locator('#post-sale-new-sale').click();

  // A pizza profile is another configuration of the SAME menu product and POS.
  await call('restaurant/pizzeria/profiles',{productId:bread.id,policy:'HIGHEST_FLAVOR',pricingMode:'DESKTOP_DELTAS',maxFlavors:2,
    sizes:[{code:'M',name:'Média',priceCents:100}],flavors:[{code:'C',name:'Calabresa',priceCents:200}],crusts:[],addons:[]});
  await main.locator('[data-add-product="'+bread.id+'"]').click();
  const pizzaForm=modal.locator('#restaurant-config-product-form');await pizzaForm.waitFor();
  await pizzaForm.locator('[name=variantId]').check();await pizzaForm.locator('[data-option]').check();
  await pizzaForm.getByRole('button',{name:'Adicionar ao pedido',exact:true}).click();await modal.waitFor({state:'hidden'});
  await main.locator('.cart-line').getByText(/Média.*Calabresa/).waitFor();
  assert.equal((await db.prepare("SELECT SUM(si.quantity_milli*si.unit_price_cents/1000) AS n FROM sale_configured_lines si JOIN sales s ON s.id=si.sale_id WHERE s.status='OPEN'").bind().first()).n,400);
  await page.screenshot({path:resolve(artifacts,'pizza-balcao.png')});
  await main.getByRole('button',{name:/Finalizar venda/}).click();await modal.getByRole('button',{name:'Concluir venda',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#route-content .cart-list')?.textContent.includes('Nenhum item na venda.'));
  assert.equal((await db.prepare('SELECT balance_milli AS n FROM stock_positions WHERE product_id=?').bind(flour.id).first()).n,1890);
  await page.locator('#post-sale-new-sale').click();

  await sidebar('Vendas e devoluções').click();await main.getByRole('button',{name:/Devoluções/}).click();await waitHeading('Devoluções');
  await page.locator('#app-sidebar [data-route=settings]').click();await waitHeading('Configurações');
  assert.equal(await page.locator('#app-sidebar .nav-button.active').count(),1);
  await main.getByRole('tab',{name:'Áreas',exact:true}).click();await main.getByText('Alimentação',{exact:true}).first().waitFor();
  await page.screenshot({path:resolve(artifacts,'configuracoes.png')});
  await sidebar('Acessos e equipe').click();await waitHeading('Acessos e equipe');
  await inventory();await main.getByRole('button',{name:'Compras',exact:true}).click();await waitHeading('Compras e recebimentos');
  assert.equal(await main.getByText('Este módulo ainda não está disponível na versão online.',{exact:true}).count(),0);
  await main.locator('[data-purchase-manage]').click();await modal.getByRole('heading',{name:'Pedidos a fornecedores',exact:true}).waitFor();
  await modal.getByRole('button',{name:'Fechar',exact:true}).last().click();
  await inventory();await main.getByRole('button',{name:'Logística',exact:true}).click();await waitHeading('Logística de estoque');
  await page.screenshot({path:resolve(artifacts,'logistica.png')});
  await page.setViewportSize({width:390,height:844});
  await page.locator('#app-sidebar [data-route=settings]').click();await waitHeading('Configurações');
  assert.equal(await page.locator('#app-sidebar [data-route=settings]').isVisible(),true);
  await main.getByRole('tab',{name:'Áreas',exact:true}).click();
  const area=main.locator('[data-settings-module=WHOLESALE]');
  let areaWrites=0;page.on('request',request=>{if(request.method()==='PATCH'&&new URL(request.url()).pathname.endsWith('/modules/WHOLESALE'))areaWrites++;});
  const [enabled]=await Promise.all([page.waitForResponse(response=>response.request().method()==='PATCH'&&new URL(response.url()).pathname.endsWith('/modules/WHOLESALE')),area.check()]);
  assert.equal(enabled.status(),200);assert.equal(areaWrites,1,'one gesture must issue one mutation after repeated navigation');
  const [disabled]=await Promise.all([page.waitForResponse(response=>response.request().method()==='PATCH'&&new URL(response.url()).pathname.endsWith('/modules/WHOLESALE')),area.uncheck()]);
  assert.equal(disabled.status(),200);assert.equal(areaWrites,2);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  await page.screenshot({path:resolve(artifacts,'configuracoes-mobile.png')});
  const weighed=await call('products',{name:'Queijo por peso',sku:'PESO',unit:'KG',salePriceCents:2000,trackStock:false,menuEnabled:true});
  await page.reload();await waitHeading('Início');
  for(const width of [375,390,430,768]){
    await page.setViewportSize({width,height:844});
    await sidebar('Balcão').click();await main.locator('.checkout-layout').waitFor();
    assert.equal(await page.locator('#app-sidebar .nav-button.active').count(),1,'the previous settings tab must not remain active');
    const layout=await page.evaluate(()=>{const a=document.querySelector('.checkout-main').getBoundingClientRect(),b=document.querySelector('.sale-panel').getBoundingClientRect();return {main:{left:a.left,right:a.right,top:a.top,bottom:a.bottom},sale:{left:b.left,right:b.right,top:b.top,bottom:b.bottom},width:innerWidth,scroll:document.querySelector('#route-content').scrollWidth,client:document.querySelector('#route-content').clientWidth};});
    assert.ok(layout.scroll<=layout.client+2,JSON.stringify(layout));
    if(width<=680)assert.ok(layout.sale.top>=layout.main.bottom-2,'payment must follow products on mobile: '+JSON.stringify(layout));
    await page.screenshot({path:resolve(artifacts,'balcao-'+width+'.png'),fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});
  await main.locator('[data-add-product="'+weighed.product.id+'"]').click();
  await modal.locator('#weighted-product-form [name=grams]').fill('250');
  await modal.getByRole('button',{name:'Adicionar à venda',exact:true}).click();await modal.waitFor({state:'hidden'});
  await main.locator('.cart-line .qty-control').getByText(/250 g/).waitFor();
  await main.locator('[data-add-product="'+weighed.product.id+'"]').click();
  await modal.locator('#weighted-product-form [name=grams]').fill('125');await modal.getByRole('button',{name:'Adicionar à venda',exact:true}).click();await modal.waitFor({state:'hidden'});
  await main.locator('.cart-line .qty-control').getByText(/375 g/).waitFor();
  await main.getByRole('button',{name:'Remover pesagem',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#route-content .cart-list')?.textContent.includes('Nenhum item na venda.'));
  await main.locator('[data-add-product="'+weighed.product.id+'"]').click();
  await modal.locator('#weighted-product-form [name=grams]').fill('250');await modal.getByRole('button',{name:'Adicionar à venda',exact:true}).click();await modal.waitFor({state:'hidden'});
  await main.getByRole('button',{name:/Finalizar venda/}).click();
  const paymentBounds=await modal.locator('.modal-card').boundingBox();
  assert.ok(paymentBounds.x>=0&&paymentBounds.x+paymentBounds.width<=390,'payment dialog must fit mobile');
  await modal.getByRole('button',{name:'Concluir venda',exact:true}).click();await modal.waitFor({state:'hidden'});
  const weightedSale=await db.prepare("SELECT total_cents FROM sales WHERE status='COMPLETED' ORDER BY completed_at DESC LIMIT 1").bind().first();
  assert.equal(weightedSale.total_cents,500);await page.locator('#post-sale-new-sale').click();
  await page.evaluate(async()=>{const api=new window.PdvApiClient.ApiClient();await api.initialize();await api.saveSetting('modules.FOOD.enabled',true,'global');});
  await page.locator('#app-sidebar [data-route=settings]').click();await waitHeading('Configurações');
  await sidebar('Alimentação').click();
  await main.locator('[data-r4-web]').waitFor();
  await main.getByRole('button',{name:'Configurações de atendimento',exact:true}).click();
  await main.locator('[data-r4-advanced="station"]').waitFor();
  const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,main:document.querySelector('#route-content').scrollWidth,client:document.querySelector('#route-content').clientWidth,
    elements:[...document.querySelectorAll('#route-content *')].filter(e=>e.getBoundingClientRect().right>innerWidth+2).slice(0,8).map(e=>({tag:e.tagName,class:e.className,width:e.getBoundingClientRect().width}))}));
  assert.ok(overflow.main<=overflow.client+2,JSON.stringify(overflow));
  assert.equal(await main.locator('[data-r4-section=pizza], [data-r4-section=weight], [data-r4-section=recipe]').count(),0,'product setup must not be a restaurant preference tab');
  await page.screenshot({path:resolve(artifacts,'preparo-mobile.png')});
  await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) SELECT ?,?,?,password_hash,? FROM users WHERE id=?').bind('reader','reader@example.com','Leitura teste',stamp,'owner').run();
  await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)').bind('audit','reader','READ_ONLY',stamp).run();
  const readerContext=await browser.newContext({viewport:{width:390,height:844}}),reader=await readerContext.newPage(),readerErrors=[];
  reader.on('response',response=>{if(new URL(response.url()).pathname.startsWith('/api/')&&response.status()>=400&&response.status()!==401)readerErrors.push(response.status()+' '+response.url());});
  await reader.goto('http://127.0.0.1:'+server.address().port+'/app/');
  await reader.locator('#web-email').fill('reader@example.com');await reader.locator('#web-password').fill(password);
  await reader.locator('#web-login-form button[type=submit]').click();await reader.locator('#auth-overlay').waitFor({state:'hidden'});
  await reader.locator('#sidebar-nav [data-route=catalog]').click();await reader.locator('[data-flow-route=inventory]').click();
  await reader.locator('#web-catalog-master [data-master-rows]').waitFor();
  assert.equal(await reader.locator('[data-master-product]').count(),0);
  await reader.evaluate(async()=>{const api=new window.PdvApiClient.ApiClient();await api.initialize();await api.logout();});
  await db.prepare('UPDATE tenant_memberships SET profile_key=? WHERE tenant_id=? AND user_id=?').bind('CASHIER','audit','reader').run();
  await reader.reload();await reader.locator('#web-email').fill('reader@example.com');await reader.locator('#web-password').fill(password);
  await reader.locator('#web-login-form button[type=submit]').click();await reader.locator('#auth-overlay').waitFor({state:'hidden'});
  await reader.locator('#sidebar-nav [data-route=access]').click();await reader.getByRole('heading',{name:'Suas sessões',exact:true}).waitFor();
  assert.equal(await reader.getByRole('heading',{name:'Equipe e perfis',exact:true}).count(),0);
  assert.deepEqual(readerErrors,[]);await readerContext.close();
  await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) SELECT ?,?,?,password_hash,? FROM users WHERE id=?').bind('kitchen','kitchen@example.com','Cozinha teste',stamp,'owner').run();
  await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)').bind('audit','kitchen','KITCHEN',stamp).run();
  const kitchenContext=await browser.newContext({viewport:{width:390,height:844}}),kitchen=await kitchenContext.newPage(),kitchenReads=[];
  kitchen.on('response',response=>{const path=new URL(response.url()).pathname;if(path.includes('/api/v1/tenants/')&&(/\/(products|categories|cash)(\?|$|\/)/.test(path)))kitchenReads.push({path,status:response.status()});});
  await kitchen.goto('http://127.0.0.1:'+server.address().port+'/app/');
  await kitchen.locator('#web-email').fill('kitchen@example.com');await kitchen.locator('#web-password').fill(password);
  await kitchen.locator('#web-login-form button[type=submit]').click();await kitchen.locator('#auth-overlay').waitFor({state:'hidden'});
  await kitchen.locator('#route-content').getByRole('heading',{name:'Início',exact:true}).waitFor();
  assert.deepEqual(kitchenReads,[],'kitchen login must not request catalog or cash permissions');
  assert.equal(await kitchen.locator('#sidebar-nav [data-route=checkout]').count(),0);
  await kitchen.locator('#sidebar-nav [data-route=FOOD]').click();await kitchen.locator('[data-r4-action=tab][data-id=kitchen]').click();
  await kitchen.getByRole('heading',{name:'KDS · Estações e pedidos',exact:true}).waitFor();
  // Full handoff through visible controls, with three distinct identities.
  for(const role of ['WAITER','CASHIER']){
    const id=role.toLowerCase();
    await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) SELECT ?,?,?,password_hash,? FROM users WHERE id=?').bind(id,id+'@example.com','QA '+role,stamp,'owner').run();
    await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)').bind('audit',id,role,stamp).run();
  }
  const roleOrigin=new URL(page.url()).origin;
  const prepare=async(path,body)=>{
    const response=await page.request.post(roleOrigin+'/api/v1/tenants/audit/'+path,{headers:{origin:roleOrigin,'x-mutation-id':crypto.randomUUID()},data:{branchId:'branch',...body}});
    assert.equal(response.status(),201,await response.text());return response.json();
  };
  const roleProduct=(await prepare('products',{name:'Prato jornada por perfil',sku:'QA-ROLE',salePriceCents:1000,trackStock:true,menuEnabled:true})).product;
  await prepare('inventory/receipts',{productId:roleProduct.id,quantity:10,type:'opening'});
  const roleStation=(await prepare('restaurant/kitchen/stations',{name:'Cozinha jornada',printEnabled:false})).station;
  await prepare('restaurant/kitchen/routes',{productId:roleProduct.id,mode:'PRODUCTION',stationId:roleStation.id});
  const roleTable=(await prepare('restaurant/tables',{label:'Mesa jornada por perfil',seats:4})).table;
  const rolePages={};
  for(const role of ['WAITER','CASHIER']){
    const context=await browser.newContext({viewport:{width:390,height:844}}),staff=await context.newPage();
    await staff.goto(roleOrigin+'/app/');await staff.locator('#web-email').fill(role.toLowerCase()+'@example.com');await staff.locator('#web-password').fill(password);
    await staff.locator('#web-login-form button[type=submit]').click();await staff.locator('#auth-overlay').waitFor({state:'hidden'});rolePages[role]={context,page:staff};
  }
  const waiter=rolePages.WAITER.page,cashier=rolePages.CASHIER.page;
  await cashier.locator('#sidebar-nav [data-route=cash]').click();await cashier.locator('#web-cash-open [name=amount]').fill('100,00');await cashier.locator('#web-cash-open button[type=submit]').click();await cashier.locator('[data-cash-web=close]').waitFor();
  await waiter.locator('#sidebar-nav [data-route=FOOD]').click();await waiter.locator('[data-r4-action=open][data-id="'+roleTable.id+'"]').click();await waiter.locator('[data-r4-action=select]').waitFor();
  await waiter.locator('[data-r4-action=tab][data-id=orders]').click();const roleOrderForm=waiter.locator('[data-r4-form=order]');
  await roleOrderForm.locator('[name=tableSessionId]').selectOption({label:'Mesa jornada por perfil'});await roleOrderForm.locator('[name=productId]').selectOption(roleProduct.id);
  await waiter.waitForFunction(()=>document.querySelector('[data-r4-order-item]')?.dataset.r4PizzaState==='none');
  const orderCreated=waiter.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/restaurant/orders'));
  await roleOrderForm.locator('button[type=submit]').click();const orderResponse=await orderCreated;assert.equal(orderResponse.status(),201);const roleOrder=(await orderResponse.json()).order;
  await waiter.screenshot({path:resolve(artifacts,'QA-03-garcom-comanda.png'),fullPage:true});
  await kitchen.locator('[data-r4-action=refresh]').click();
  const kitchenRow=kitchen.locator('.restaurant-row').filter({hasText:roleOrder.id.slice(0,8)});
  await kitchenRow.locator('[data-r4-action=preparing-station]').click();await kitchenRow.locator('[data-r4-action=ready-station]').click();
  await kitchenRow.getByText(/Pronto/).waitFor();
  await kitchen.screenshot({path:resolve(artifacts,'QA-04-cozinha-pronto.png'),fullPage:true});
  await waiter.locator('[data-r4-action=refresh]').click();await waiter.locator('[data-r4-action=deliver][data-id="'+roleOrder.id+'"]').click();await waiter.getByText(/Entregue/).first().waitFor();
  await cashier.locator('#sidebar-nav [data-route=checkout]').click();await cashier.locator('#checkout-documents').click();
  await cashier.locator('#checkout-document-results .data-row').filter({hasText:'Mesa jornada por perfil'}).locator('[data-open-checkout-document]').click();
  await cashier.locator('[data-checkout-document-context]').waitFor();await cashier.locator('#finalize-sale').click();await cashier.locator('#confirm-payment').waitFor();
  await cashier.locator('[data-remove-payment]').first().click();await cashier.locator('#new-payment-method').selectOption('PIX');await cashier.locator('#add-payment').click();
  const rolePaid=cashier.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/complete'));await cashier.locator('#confirm-payment').click();
  const paidResponse=await rolePaid;assert.equal(paidResponse.status(),200);const roleSale=(await paidResponse.json()).sale;assert.equal(roleSale.totalCents,1000);
  await cashier.screenshot({path:resolve(artifacts,'QA-06-caixa-pagamento.png'),fullPage:true});
  await waiter.locator('[data-r4-action=tab][data-id=tables]').click();await waiter.locator('[data-r4-action=refresh]').click();
  await waiter.locator('.restaurant-table').filter({hasText:'Mesa jornada por perfil'}).locator('[data-r4-action=select]').click();await waiter.locator('[data-r4-action=close]').click();
  await waiter.locator('.restaurant-table').filter({hasText:'Mesa jornada por perfil'}).getByText('Livre',{exact:true}).waitFor();
  await waiter.screenshot({path:resolve(artifacts,'QA-06-mesa-livre.png'),fullPage:true});
  await cashier.locator('#sidebar-nav [data-route=cash]').click();await cashier.locator('[data-cash-web=close]').click();
  await cashier.locator('.ux-dialog [name=amount]').fill('100,00');await cashier.getByRole('button',{name:'Confirmar fechamento',exact:true}).click();await cashier.locator('#web-cash-open').waitFor();
  assert.equal((await db.prepare('SELECT balance_milli AS balance FROM stock_positions WHERE product_id=?').bind(roleProduct.id).first()).balance,9000);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM cash_sessions WHERE operator_id='cashier' AND status='CLOSED' AND divergence_cents=0").bind().first()).n,1);
  writeFileSync(resolve(artifacts,'QA-03-04-06-sqlite-proof.json'),JSON.stringify({
    environment:'isolated SQLite and Chromium',cases:['QA-03 nominal','QA-04 nominal','QA-06 nominal'],
    stockBalanceMilli:(await db.prepare('SELECT balance_milli AS balance FROM stock_positions WHERE product_id=?').bind(roleProduct.id).first()).balance,
    closedCashSessionsZeroDivergence:(await db.prepare("SELECT COUNT(*) AS n FROM cash_sessions WHERE operator_id='cashier' AND status='CLOSED' AND divergence_cents=0").bind().first()).n,
    paidSaleId:roleSale.id,paidSaleTotalCents:roleSale.totalCents
  },null,2)+'\\n');
  await rolePages.WAITER.context.close();await rolePages.CASHIER.context.close();await kitchenContext.close();
  assert.deepEqual(errors,[]);assert.deepEqual(badRequests,[]);
  console.log('Audit fixes browser: navigation, catalog, sale/stock, returns, settings, access, purchases, logistics and waiter -> kitchen -> cashier -> free table -> closed cash passed.');
}catch(error){
  await page.screenshot({path:resolve(artifacts,'failure.png')}).catch(()=>{});
  console.error('UI heading:',await main.locator('h1').allTextContents());console.error('Browser errors:',errors);console.error('API failures:',badRequests);throw error;
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));db.close();}
