import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.setContent('<main id="route-content"><section class="ops-page"><header class="ops-head"><h1>Estoque</h1></header></section></main>');
 await page.evaluate(()=>{
  document.body.dataset.activeRoute='inventory';window.masterActions=[];window.canEdit=true;
  window.recipeFailure=false;
  window.PdvApiClient={ApiClient:class{
   webMode=true;
   async products(includeInactive){
    if(!window.canEdit&&includeInactive)throw Error('Sem permissão para consultar inativos');
    if(window.deferMaster)await new Promise(resolve=>{window.releaseMaster=resolve;});
    return [{id:'flour',name:'Farinha de trigo',sku:'FAR',active:true,trackStock:true,unit:'KG',balance:2,menuEnabled:false,usageType:'INGREDIENT'},
     {id:'bread',name:'Pão preparado',sku:'PAO',active:true,trackStock:false,unit:'UN',menuEnabled:true,usageType:'DIRECT'},
     {id:'water',name:'Água mineral',sku:'AGUA',active:true,trackStock:true,unit:'UN',balance:10,menuEnabled:true,usageType:'DIRECT'}];
   }
   async request(){if(window.recipeFailure)throw Error('Servidor temporariamente indisponível');return {recipe:{yieldQuantity:10,yieldUnit:'UN',portionQuantity:1,theoreticalCostCents:165,costPerPortionCents:17,capacity:36}};}
  }};
  window.PdvAccessPolicy={hasCapability:()=>window.canEdit};window.PdvCurrentAccess={};
  window.PdvCatalogAdmin={openStockProductForm:p=>window.masterActions.push(['stock',p?.id]),openPreparedProductForm:()=>window.masterActions.push(['prepared']),openRecipeForm:p=>window.masterActions.push(['recipe',p.id])};
  window.PdvAppNavigation={navigate:route=>window.masterActions.push(['navigate',route])};
  window.PdvUiLifecycle={on:()=>{}};
 });
 await page.addScriptTag({content:readFileSync(new URL('../apps/web/web-catalog-master.js',import.meta.url),'utf8')});
 await page.evaluate(()=>window.PdvWebCatalogMaster.mount());
 assert.equal(await page.locator('[data-master-rows] tr').count(),3);
 assert.match(await page.locator('#web-catalog-master').innerText(),/10 UN por receita/);
 assert.match(await page.locator('#web-catalog-master').innerText(),/0,17/);
 await page.locator('[data-master-product]').click();
 await page.locator('[data-master-recipe]').click();
 await page.locator('[data-master-prepared]').selectOption('bread');
 await page.locator('[data-master-open-recipe]').click();
 await page.locator('[data-master-new-prepared]').click();
 await page.locator('[data-master-edit-recipe="bread"]').click();
 await page.locator('[data-master-menu]').click();
 assert.deepEqual(await page.evaluate(()=>window.masterActions),[['stock',undefined],['recipe','bread'],['prepared'],['recipe','bread'],['navigate','products']]);
 await page.locator('[data-master-search]').fill('Farinha');
 assert.equal(await page.locator('[data-master-rows] tr').count(),1);
 assert.match(await page.locator('[data-master-rows]').innerText(),/Insumo/);
 await page.evaluate(()=>{window.recipeFailure=true;});
 await page.evaluate(()=>window.PdvWebCatalogMaster.mount());
 assert.match(await page.locator('[role="alert"]').innerText(),/Servidor temporariamente indisponível/);
 await page.evaluate(()=>{window.canEdit=false;window.recipeFailure=false;});
 await page.evaluate(()=>window.PdvWebCatalogMaster.mount());
 assert.equal(await page.locator('[data-master-product]').count(),0);
 await page.evaluate(()=>{window.deferMaster=true;void window.PdvWebCatalogMaster.mount();});
 await page.waitForFunction(()=>typeof window.releaseMaster==='function');
 await page.evaluate(()=>{document.body.dataset.activeRoute='checkout';document.getElementById('route-content').innerHTML='<h1>Balcão</h1>';window.releaseMaster();});
 assert.equal(await page.locator('h1').innerText(),'Balcão');
 assert.equal(await page.locator('#web-catalog-master').count(),0);
 assert.deepEqual(errors,[]);
 console.log('Stock master UI: recipes, costs, actions, search, permissions, errors and stale navigation passed.');
}finally{await browser.close();}
