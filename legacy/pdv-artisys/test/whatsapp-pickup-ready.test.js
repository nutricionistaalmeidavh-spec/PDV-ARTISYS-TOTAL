'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(ROOT,relative),'utf8');

test('WhatsApp ready action normalizes Brazilian national phones and builds a wa.me URL',async()=>{
  const {
    normalizeBrazilianNationalPhone,
    buildPickupReadyWhatsappUrl,
    registerWhatsappIpc
  }=require('../desktop/whatsapp-actions.cjs');

  assert.equal(normalizeBrazilianNationalPhone('(16) 99999-9999'),'16999999999');
  assert.equal(normalizeBrazilianNationalPhone('+55 (16) 99999-9999'),'16999999999');
  assert.equal(normalizeBrazilianNationalPhone('1633334444'),'1633334444');
  assert.throws(()=>normalizeBrazilianNationalPhone('1699999'),/10 ou 11/);
  assert.throws(()=>normalizeBrazilianNationalPhone('9916999999999'),/10 ou 11/);

  const url=buildPickupReadyWhatsappUrl({phone:'16999999999',customerName:'Evandro'});
  assert.match(url,/^https:\/\/wa\.me\/5516999999999\?text=/);
  assert.match(decodeURIComponent(url),/Olá, Evandro! Seu pedido está pronto para retirada\./);

  const handlers={};
  const opened=[];
  const ipcMain={handle(channel,handler){handlers[channel]=handler;}};
  registerWhatsappIpc({
    ipcMain,
    isTrustedSender:()=>true,
    openExternal:async target=>{opened.push(target);}
  });
  assert.equal(typeof handlers['artisys:external:whatsapp'],'function');
  const result=await handlers['artisys:external:whatsapp']({}, {phone:'16999999999',customerName:'Evandro'});
  assert.equal(result.opened,true);
  assert.equal(opened.length,1);
  assert.equal(opened[0],result.url);
  assert.match(opened[0],/^https:\/\/wa\.me\//);
});

test('pickup-ready WhatsApp action is rendered by the canonical delivery renderer',()=>{
  const preload=read('desktop/preload.cjs');
  const receipts=read('desktop/receipt-actions.cjs');
  const index=read('desktop/renderer/index.html');
  const modules=read('desktop/renderer/vertical-modules.js');
  const parity=read('desktop/renderer/vertical-parity-p1.js');

  assert.match(preload,/external:\s*\{/);
  assert.match(preload,/openWhatsapp:\s*\(input\)\s*=>\s*ipcRenderer\.invoke\('artisys:external:whatsapp'/);
  assert.match(receipts,/registerWhatsappIpc/);
  assert.doesNotMatch(index,/\.\/whatsapp-pickup-ui\.js/);
  assert.match(modules,/data-delivery-whatsapp/);
  assert.match(modules,/artisysDesktop\?\.external\?\.openWhatsapp/);
  assert.match(modules,/fulfillmentType\s*===\s*'PICKUP'/);
  assert.match(modules,/status\s*===\s*'READY'/);
  assert.doesNotMatch(modules,/shell\.openExternal/);
  assert.doesNotMatch(modules,/window\.open\s*\(/);
  assert.doesNotMatch(parity,/data-whatsapp-pickup-ready/);
  assert.doesNotMatch(modules,/scheduleDeliveryEnhancement/);
});

test('delivery phone accepts formatted input before validating 10-11 normalized digits',()=>{
  const modules=read('desktop/renderer/vertical-modules.js');

  assert.match(modules,/input\('phone','Telefone','tel'/);
  assert.match(modules,/inputmode="numeric"/);
  assert.match(modules,/pattern="\\\\d\{10,11\}"/);
  assert.match(modules,/replace\(\/\\D\/g,''\)/);
  assert.match(modules,/startsWith\('55'\)/);
  assert.doesNotMatch(modules,/maxlength="11"/);
  assert.doesNotMatch(modules,/slice\(0,11\)/);
});
