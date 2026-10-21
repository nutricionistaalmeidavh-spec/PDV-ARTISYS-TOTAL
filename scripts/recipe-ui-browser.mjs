// Focused UI contract test; API is the boundary, database behavior is tested separately.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setContent('<main id="route-content"></main>');
 await page.evaluate(()=>{
  const products=[{id:'bread',name:'Pão preparado',trackStock:false,unit:'UN',salePriceCents:1000},{id:'flour',name:'Farinha de trigo',unit:'KG',trackStock:true,lastCostCents:300},{id:'pizza',name:'Pizza tradicional',trackStock:false,unit:'UN',salePriceCents:3000}];
  const recipe={version:1,yieldQuantity:10,yieldUnit:'UN',portionQuantity:1,prepTimeMinutes:30,preparationNotes:'Assar',notes:'Interno',capacity:36,components:[{productId:'flour',quantity:500,unit:'G',conversionFactor:0.001,lossPercent:10}]};
  window.recipeCalls=[];window.recipeToasts=[];
  window.PdvApiClient={ApiClient:class{
   webMode=true;
   async products(){if(window.deferProducts)await new Promise(resolve=>{window.releaseProducts=resolve;});return products;}
   async modules(){return [];}
   async productConfiguration(id){return id==='pizza'?{pizzaProfile:{productId:'pizza',flavors:[{code:'CAL',name:'Calabresa'}],sizes:[],crusts:[],addons:[]}}:{};}
   async request(path,options={}){
    window.recipeCalls.push({path,...options});
    if(window.deferRecipe&&path==='/api/v1/recipes/pizza')await new Promise(resolve=>{window.releaseRecipe=resolve;});
    if(options.method==='PUT')return {recipe:{version:2}};
    if(path==='/api/v1/recipes/bread')return {recipe};
    if(path.includes('/options/'))return {recipe:null};
    if(path.endsWith('/pizzeria/profiles'))return {profiles:[{productId:'pizza',flavors:[{code:'CAL',name:'Calabresa'}],sizes:[],crusts:[],addons:[]}]};
    if(path.endsWith('/pizzeria/products/pizza'))return {profile:{productId:'pizza',policy:'HIGHEST_FLAVOR',pricingMode:'DESKTOP_DELTAS',maxFlavors:2,sizes:[{code:'M',name:'Média',priceCents:100}],flavors:[{code:'CAL',name:'Calabresa',priceCents:200}],crusts:[],addons:[]}};
    return {};
   }
  }};
  window.PdvAccessPolicy={hasCapability:()=>true};window.PdvCurrentAccess={};
  window.PdvToast={show:message=>window.recipeToasts.push(message)};
 });
 await page.addScriptTag({content:readFileSync(new URL('../apps/web/r4-advanced-ui.js',import.meta.url),'utf8')});
 await page.evaluate(()=>window.PdvR4AdvancedUi.show({section:'recipe',productId:'bread'}));
 assert.equal(await page.locator('h1').innerText(),'Fichas técnicas');
 assert.equal(await page.evaluate(()=>window.recipeCalls.some(x=>/kitchen|\/orders|\/tables|onboarding/.test(x.path))),false,'recipe editing must not depend on restaurant administration');
 const form=page.locator('[data-r4-advanced="recipe"]');
 assert.equal(await form.locator('[name="yieldQuantity"]').inputValue(),'10');
 assert.equal(await form.locator('[name="preparationNotes"]').inputValue(),'Assar');
 assert.match(await form.locator('[data-recipe-cost]').innerText(),/165|1,65/);
 assert.match(await form.locator('[data-recipe-cost]').innerText(),/0,17/);
 await form.locator('[name="ingredientUnit"]').selectOption('KG');
 assert.equal(await form.locator('[name="conversionFactor"]').inputValue(),'1');
 await form.locator('[name="ingredientUnit"]').selectOption('G');
 assert.equal(await form.locator('[name="conversionFactor"]').inputValue(),'0.001');
 await form.locator('[name="ingredientQuantity"]').fill('1000');
 assert.match(await form.locator('[data-recipe-cost]').innerText(),/3,30/);
 await form.locator('button[type="submit"],button.primary-button').click();
 await page.waitForFunction(()=>window.recipeCalls.some(x=>x.path==='/api/v1/recipes/bread'&&x.method==='PUT'));
 const saved=await page.evaluate(()=>window.recipeCalls.find(x=>x.path==='/api/v1/recipes/bread'&&x.method==='PUT'));
 assert.equal(saved.body.components[0].quantity,1000);
 assert.equal(saved.body.components[0].productId,'flour');
 assert.equal(saved.body.components[0].conversionFactor,0.001);
 assert.equal(saved.body.yieldQuantity,10);assert.equal(saved.body.prepTimeMinutes,30);
 assert.equal(await page.locator('[data-r4-section]').count(),0,'a recipe editor must not contain restaurant or unrelated product tabs');
 assert.equal(await page.locator('[data-r4-advanced="option-recipe"]').count(),0,'bread must not show pizza recipes');
 await page.locator('[data-r4-advanced="recipe"] [name="productId"]').selectOption('pizza');
 await page.locator('[data-r4-advanced="option-recipe"]').waitFor({state:'attached'});
 await page.locator('summary').click();
 const option=page.locator('[data-r4-advanced="option-recipe"]');
 await option.locator('[name="productId"]').selectOption('pizza');
 assert.match(await option.locator('[name="code"]').innerText(),/Calabresa/);
 await option.locator('[name="code"]').selectOption('CAL');
 await option.locator('[name="ingredientId"]').selectOption('flour');
 await option.locator('[name="ingredientQuantity"]').fill('0.125');
 await option.locator('button.primary-button').click();
 await page.waitForFunction(()=>window.recipeCalls.some(x=>x.path==='/api/v1/recipes/pizza/options/FLAVOR/CAL'&&x.method==='PUT'));
 const optionSaved=await page.evaluate(()=>window.recipeCalls.find(x=>x.path==='/api/v1/recipes/pizza/options/FLAVOR/CAL'&&x.method==='PUT'));
 assert.deepEqual(optionSaved.body.ingredients,[{ingredientId:'flour',quantity:0.125}]);
 await page.evaluate(()=>window.PdvR4AdvancedUi.show({section:'pizza',productId:'pizza'}));
 const pizza=page.locator('[data-r4-advanced="pizza"]');
 assert.equal(await pizza.locator('select[name=productId]').count(),0,'product must stay fixed to prevent overwriting another profile');
 assert.equal(await pizza.locator('input[name=productId]').inputValue(),'pizza');
 assert.match(await pizza.locator('[name=flavors]').inputValue(),/Calabresa=2,00/);
 assert.equal(await page.locator('[data-r4-section]').count(),0);
 await page.evaluate(()=>window.PdvR4AdvancedUi.show({section:'recipe',productId:'bread'}));
 await page.evaluate(()=>{window.deferRecipe=true;});
 await page.locator('[data-r4-advanced="recipe"] [name=productId]').selectOption('pizza');
 await page.waitForFunction(()=>typeof window.releaseRecipe==='function');
 await page.evaluate(()=>{document.body.dataset.activeRoute='home';document.querySelector('#route-content').innerHTML='<h1>Página seguinte</h1>';window.releaseRecipe();});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await page.locator('h1').innerText(),'Página seguinte','an old recipe must not replace the new page');
 await page.evaluate(()=>{window.deferProducts=true;window.pendingShow=window.PdvR4AdvancedUi.show({section:'recipe',productId:'bread'});});
 await page.waitForFunction(()=>typeof window.releaseProducts==='function');
 await page.evaluate(async()=>{document.body.dataset.activeRoute='checkout';document.querySelector('#route-content').innerHTML='<h1>Balcão seguinte</h1>';window.releaseProducts();await window.pendingShow;});
 assert.equal(await page.locator('h1').innerText(),'Balcão seguinte');
 assert.deepEqual(errors,[]);
 console.log('Recipe UI: existing recipe, named ingredients/options, conversion, costs and save payload passed.');
}finally{await browser.close();}
