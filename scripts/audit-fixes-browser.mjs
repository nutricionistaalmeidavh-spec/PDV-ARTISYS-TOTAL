// Regression of the published application's active UI against the real local
// API and all migrations. This never connects to a production environment.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {openLocalDatabase} from '../apps/api/src/local-db.mjs';
import {createApi} from '../apps/api/src/worker.mjs';
import {serveLocalPwa} from '../apps/api/src/local-static.mjs';
import {hashPassword} from '../apps/api/src/password.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
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
const browser=await chromium.launch({headless:true});
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
  assert.deepEqual(errors,[]);assert.deepEqual(badRequests,[]);
  console.log('Audit fixes browser: navigation, contrast, master -> recipe -> menu -> canonical sale/stock, returns, settings, access, purchases and logistics passed.');
}catch(error){
  await page.screenshot({path:resolve(artifacts,'failure.png')}).catch(()=>{});
  console.error('UI heading:',await main.locator('h1').allTextContents());console.error('Browser errors:',errors);console.error('API failures:',badRequests);throw error;
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));db.close();}
