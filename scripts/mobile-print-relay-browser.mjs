// Real Chromium smoke: mobile and desktop sending one immutable sale receipt to an authorized PC.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const script=readFileSync(new URL('../apps/web/post-sale-receipt-ui.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../apps/web/post-sale-receipt-ui.css',import.meta.url),'utf8');
mkdirSync('qa-artifacts/mobile-print-relay',{recursive:true});
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.setContent('<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>');
 await page.addStyleTag({content:css});
 await page.evaluate(()=>{
  window.remoteCalls=[];
  class Client{
   constructor(){this.tenantId='t-demo';this.branchId='b-demo';}
   async request(path,opts={}){
    window.remoteCalls.push({path,opts});
    if(path.includes('printing/remote/agents'))return {agents:[{id:'pc-demo',label:'PC do caixa',online:false}]};
    if(path.includes('printing/remote/jobs')&&opts.method==='POST')
      return {job:{id:'job-demo',status:'PENDING'}};
    if(path.includes('printing/remote/jobs'))return {jobs:[{id:'job-demo',status:'SUBMITTED'}]};
    if(path.includes('sales/'))return {sale:{id:'sale-demo',status:'COMPLETED'},branding:{name:'Loja Exemplo'},text:'CUPOM'};
    throw Error('Unexpected request '+path);
   }
   async completeSale(){return {sale:{id:'sale-demo',status:'COMPLETED'}};}
  }
  window.PdvApiClient={ApiClient:Client};
  window.PdvWebHardware={settings:()=>({printerMode:'browser'}),printSale:async()=>({dialogOpened:true})};
  window.PdvWebHardwareUtils={escapeHtml:v=>String(v).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))};
  window.PdvUiLifecycle={on(){}};
 });
 await page.addScriptTag({content:script});
 await page.evaluate(()=>window.PdvPostSaleReceiptUi.showPostSaleModal({
   id:'sale-demo',saleNumber:'1001',totalCents:13590,changeCents:0,status:'COMPLETED'
 }));
 const remote=page.locator('#post-sale-remote');
 await remote.waitFor({state:'visible'});
 assert.match(await remote.textContent(),/PC do caixa/);
 assert.match(await remote.textContent(),/desconectado/);
 await page.screenshot({path:'qa-artifacts/mobile-print-relay/iphone-remote-pc-offline.png',fullPage:true});
 await page.locator('#post-sale-remote-send').click();
 await page.getByText(/Solicitação na fila/).waitFor();
 assert.equal(await page.locator('#post-sale-remote-send').textContent(),'Reimprimir pelo PC');
 await page.locator('#post-sale-remote-check').click();
 await page.getByText(/Aceito pelo spooler/).waitFor();
 await page.screenshot({path:'qa-artifacts/mobile-print-relay/iphone-remote-queued.png',fullPage:true});
 await page.locator('#post-sale-remote-send').click();
 const calls=await page.evaluate(()=>window.remoteCalls);
 const posted=calls.filter(c=>c.opts.method==='POST'&&c.path.includes('printing/remote/jobs'));
 assert.equal(posted.length,2);
 assert.equal(posted[0].opts.body.reprint,undefined);
 assert.equal(posted[1].opts.body.reprint,true);
 assert.match(posted[1].opts.body.requestId,/^[a-f0-9-]{36}$/i);
 await page.setViewportSize({width:1280,height:900});
 await page.screenshot({path:'qa-artifacts/mobile-print-relay/desktop-remote-pc.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS P5/P6: real Chromium mobile and desktop print relay, offline queue, confirmed spooler and explicit reprint');
}finally{await browser.close();}
