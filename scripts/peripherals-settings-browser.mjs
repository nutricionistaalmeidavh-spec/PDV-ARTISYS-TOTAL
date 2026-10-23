import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';

const {chromium}=createRequire(import.meta.url)('playwright');
const script=readFileSync(new URL('../apps/web/peripherals-web.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../apps/web/peripherals-settings.css',import.meta.url),'utf8');
mkdirSync('qa-artifacts/peripherals',{recursive:true});

const browser=await chromium.launch({headless:true});
const errors=[];
async function setup(viewport,userAgent){
  const page=await browser.newPage({viewport,userAgent});
  page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>');
  await page.addStyleTag({content:css});
  await page.evaluate(()=>{
    const memory=new Map();
    Object.defineProperty(window,'localStorage',{configurable:true,value:{
      getItem:key=>memory.get(key)||null,
      setItem:(key,value)=>memory.set(key,String(value))
    }});
    window.PdvCurrentAccess={permissions:['settings.view','settings.manage']};
    window.PdvAccessPolicy={hasCapability:(user,cap)=>user.permissions.includes(cap)};
    window.PdvReceiptBranding={read:()=>({name:'Loja Exemplo',address:'Rua 1',phone:'16 99999-9999',logoDataUrl:null})};
  });
  await page.addScriptTag({content:script});
  await page.evaluate(()=>window.PdvWebHardware.showSettings());
  return page;
}
try{
  const iphoneUA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const mobile=await setup({width:390,height:844},iphoneUA);
  const dialog=mobile.locator('#pdv-peripherals-dialog');
  assert.equal(await dialog.isVisible(),true);
  assert.equal(await mobile.locator('[name="printerMode"]').inputValue(),'browser','default must remain browser printing');
  assert.equal(await mobile.locator('[name="bridgeToken"]').isVisible(),false,'a browser print must not require pairing');
  await mobile.screenshot({path:'qa-artifacts/peripherals/mobile-browser-printing.png',fullPage:true});
  await mobile.locator('[data-peripherals-tab="scale"]').click();
  assert.equal(await mobile.locator('#pdv-peripherals-panel-scale').isVisible(),true);
  assert.equal(await mobile.locator('#pdv-peripherals-panel-printer').isVisible(),false);
  await mobile.locator('[data-peripherals-tab="drawer"]').click();
  assert.equal(await mobile.locator('#pdv-peripherals-panel-drawer').isVisible(),true);
  await mobile.locator('[data-peripherals-tab="printer"]').click();
  await mobile.locator('[name="printerMode"]').selectOption('bridge');
  assert.equal(await mobile.locator('[name="bridgeToken"]').isVisible(),true);
  assert.equal(await mobile.locator('[data-bridge-mobile-warning]').isVisible(),true);
  assert.equal(await mobile.locator('#pdv-bridge-connect').isDisabled(),true);
  await mobile.screenshot({path:'qa-artifacts/peripherals/mobile-bridge-explained.png',fullPage:true});
  await mobile.locator('[name="printerMode"]').selectOption('browser');
  assert.equal(await mobile.locator('[name="bridgeToken"]').isVisible(),false);
  await mobile.locator('[name="paperMm"]').selectOption('58');
  await mobile.locator('#pdv-peripherals-save').click();
  assert.equal(await mobile.locator('[name="paperMm"]').inputValue(),'58');
  assert.match(await mobile.locator('#pdv-peripherals-status').textContent(),/salvas neste navegador/);
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'mobile page must not overflow horizontally');
  await mobile.close();

  // Existing users who selected the optional bridge must see their saved method, not the default pane.
  const persisted=await setup({width:390,height:844},iphoneUA);
  await persisted.evaluate(()=>{window.PdvWebHardware.saveSettings({printerMode:'bridge',paperMm:58});});
  await persisted.evaluate(()=>{document.getElementById('pdv-peripherals-dialog').close();});
  await persisted.locator('#pdv-peripherals-dialog').waitFor({state:'detached'});
  await persisted.evaluate(()=>window.PdvWebHardware.showSettings());
  assert.equal(await persisted.locator('[name="printerMode"]').inputValue(),'bridge');
  assert.equal(await persisted.locator('[name="bridgeToken"]').isVisible(),true);
  assert.equal(await persisted.locator('#pdv-test-printer').isDisabled(),true);
  await persisted.close();

  const desktop=await setup({width:1280,height:900},'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36');
  await desktop.locator('[data-peripherals-tab="receipt"]').click();
  assert.equal(await desktop.locator('[name="receiptName"]').inputValue(),'Loja Exemplo');
  assert.equal(await desktop.locator('#pdv-peripherals-panel-receipt').isVisible(),true);
  await desktop.screenshot({path:'qa-artifacts/peripherals/desktop-receipt-settings.png',fullPage:true});
  await desktop.locator('[data-peripherals-tab="printer"]').click();
  await desktop.screenshot({path:'qa-artifacts/peripherals/desktop-browser-printing.png',fullPage:true});
  await desktop.locator('#pdv-peripherals-close').click();
  await desktop.locator('#pdv-peripherals-dialog').waitFor({state:'detached'});
  await desktop.close();

  assert.deepEqual(errors,[],'peripheral settings must not produce browser errors');
  console.log('Peripheral settings UI: mobile and desktop journeys passed.');
} finally{
  await browser.close();
}
