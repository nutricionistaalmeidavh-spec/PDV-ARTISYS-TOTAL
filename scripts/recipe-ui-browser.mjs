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
   async products(){return products;}
   async modules(){return [];}
   async request(path,options={}){
    window.recipeCalls.push({path,...options});
    if(options.method==='PUT')return {recipe:{version:2}};
    if(path==='/api/v1/recipes/bread')return {recipe};
    if(path.includes('/options/'))return {recipe:null};
    if(path.endsWith('/pizzeria/profiles'))return {profiles:[{productId:'pizza',flavors:[{code:'CAL',name:'Calabresa'}],sizes:[],crusts:[],addons:[]}]};
    return {};
   }
  }};
  window.PdvAccessPolicy={hasCapability:()=>true};window.PdvCurrentAccess={};
  window.PdvToast={show:message=>window.recipeToasts.push(message)};
 });
 await page.addScriptTag({content:readFileSync(new URL('../apps/web/r4-advanced-ui.js',import.meta.url),'utf8')});
 await page.evaluate(()=>window.PdvR4AdvancedUi.show({section:'recipe',productId:'bread'}));
 assert.equal(await page.locator('h1').innerText(),'Fichas técnicas');
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
 assert.deepEqual(errors,[]);
 console.log('Recipe UI: existing recipe, named ingredients/options, conversion, costs and save payload passed.');
}finally{await browser.close();}
