'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {VERTICAL_SCHEMA_VERSION}=require('../js/core/database/vertical-migrations');

const admin={userId:'admin',profileId:'profile-administrator',terminalId:'PDV-01'};
function setup(){
  let seq=0;
  const rt=createPdvRuntime({
    dbPath:':memory:',
    idFactory:p=>`${p}-${++seq}`,
    now:()=>`2026-09-11T10:${String(Math.floor(seq/60)).padStart(2,'0')}:${String(seq%60).padStart(2,'0')}.000Z`,
    appVersion:'1.3.0',serverVersion:'1.3.0'
  });
  rt.catalog.createUser({id:'admin',username:'admin',name:'Admin',profileId:'profile-administrator',password:'senha-forte-123'},admin);
  rt.catalog.upsertCustomer({id:'cust-1',name:'Cliente Teste',phone:'16999999999'},admin);
  rt.cash.openSession({id:'cash-PDV-01',terminalId:'PDV-01',operatorId:'admin',initialCashCents:0,actor:admin});
  return rt;
}

test('E48-E54 advance vertical schema to v8 and expose final modular services',()=>{
  const rt=setup();
  try{
    assert.equal(VERTICAL_SCHEMA_VERSION,8);
    for(const name of ['retail','publicOrdering','onboarding','mobileAccess','hardwareCompatibility']){
      assert.ok(rt[name],`runtime.${name} deve existir`);
    }
    assert.equal(rt.modules.list().some(module=>module.id==='WORKSHOP'),false);
  }finally{rt.close();}
});

test('E48 Core variants reuse E40 data and keep stock per variant through canonical sale',async()=>{
  const rt=setup();
  try{
    rt.catalog.upsertProduct({id:'shirt',name:'Camiseta',salePriceCents:10000,costCents:3500,trackStock:false},admin);
    rt.catalogCustomization.upsertVariant({id:'shirt-red-m',productId:'shirt',name:'Vermelha M',sku:'CAM-VM',barcode:'789100000001',priceDeltaCents:1000,costCents:4000},admin);
    rt.retail.setVariantStock('shirt-red-m',5,admin);
    assert.equal(rt.retail.getVariantStock('shirt-red-m').quantity,5);
    assert.equal(rt.retail.searchVariants('CAM-VM')[0].variantId,'shirt-red-m');
    const sale=rt.sales.openSale({id:'sale-retail',saleNumber:'R1',terminalId:'PDV-01',operatorId:'admin'},admin);
    const withItem=rt.retail.addVariantToSale(sale.id,{variantId:'shirt-red-m',quantity:2},admin);
    assert.equal(withItem.totalCents,22000);
    assert.equal(withItem.items[0].configuration.retailVariant.id,'shirt-red-m');
    rt.sales.completeSale(sale.id,{payments:[{method:'PIX',amountCents:22000}],actor:admin});
    await rt.dispatchPending();
    assert.equal(rt.retail.getVariantStock('shirt-red-m').quantity,3);
  }finally{rt.close();}
});

test('E49 legacy services schema remains preserved but is not an active module/runtime surface',()=>{
  const rt=setup();
  try{
    const tables=new Set(rt.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
    for(const name of ['service_catalog','service_professionals','service_professional_links','service_appointments'])assert.equal(tables.has(name),true,name);
    assert.equal(rt.services,undefined);
    assert.equal(rt.modules.list().some(module=>module.id==='SERVICES'),false);
    assert.throws(()=>rt.modules.isEnabled('SERVICES'),/Modulo desconhecido/);
  }finally{rt.close();}
});





test('E52 onboarding recommends editable module sets and persists completion',()=>{
  const rt=setup();
  try{
    const recommended=rt.onboarding.recommend('FOOD');
    assert.deepEqual(recommended.moduleIds,['FOOD']);
    const legacy=rt.onboarding.recommend('PIZZERIA');
    assert.deepEqual(legacy.moduleIds,['FOOD']);
    const state=rt.onboarding.complete({businessName:'Alimentação Teste',segment:'FOOD',moduleIds:['FOOD']},admin);
    assert.equal(state.completed,true);
    assert.equal(state.businessName,'Alimentação Teste');
    assert.equal(rt.modules.isEnabled('FOOD'),true);
    assert.throws(()=>rt.modules.isEnabled('SERVICES'),/Modulo desconhecido/);
    assert.equal(rt.onboarding.getState().segment,'FOOD');
  }finally{rt.close();}
});

test('E53 mobile access generates local HTTP QR material without claiming HTTPS or PWA',()=>{
  const rt=setup();
  try{
    const access=rt.mobileAccess.getLanAccess({host:'192.168.1.10',port:4174,path:'/mobile'});
    assert.equal(access.url,'http://192.168.1.10:4174/mobile');
    assert.match(access.qrSvg,/^<svg/);
    assert.match(access.qrSvg,/data-qr-payload=/);
    assert.equal(access.security,'trusted-lan-http');
    assert.equal(access.installablePwa,false);
    assert.doesNotMatch(access.url,/https:/);
  }finally{rt.close();}
});

test('E54 hardware evidence separates protocol verification from untested physical models',()=>{
  const rt=setup();
  try{
    const untested=rt.hardwareCompatibility.recordEvidence({manufacturer:'Epson',model:'TM-T20',kind:'PRINTER',connection:'USB',driver:'Windows',configuration:{mode:'electron'},os:'Windows 11 x64',testedAt:'2026-09-11T12:00:00.000Z',status:'UNTESTED_MODEL',result:'Equipamento físico não disponível neste ambiente.',limitations:'Necessita teste físico.'},admin);
    assert.equal(untested.status,'UNTESTED_MODEL');
    assert.throws(()=>rt.hardwareCompatibility.recordEvidence({manufacturer:'Protocol',model:'ESC/POS',kind:'PRINTER',connection:'SIMULATED',os:'CI',testedAt:'2026-09-11T12:00:00.000Z',status:'PROTOCOL_VERIFIED',result:'Contrato automatizado passou.'},admin),/evidencia/i);
    const protocol=rt.hardwareCompatibility.recordEvidence({manufacturer:'Protocol',model:'ESC/POS',kind:'PRINTER',connection:'SIMULATED',os:'CI',testedAt:'2026-09-11T12:00:00.000Z',status:'PROTOCOL_VERIFIED',result:'Contrato automatizado passou.',evidence:'CI:test/e54-1-hardware-simulation.test.js'},admin);
    assert.equal(protocol.status,'PROTOCOL_VERIFIED');
    assert.equal(rt.hardwareCompatibility.listEvidence({status:'PROTOCOL_VERIFIED'}).length,1);
    const matrix=JSON.parse(fs.readFileSync(path.join(__dirname,'..','release','hardware-compatibility.json'),'utf8'));
    assert.ok(Array.isArray(matrix.entries));
    assert.ok(matrix.entries.every(item=>item.status!=='FIELD_VERIFIED'||Boolean(item.evidence)));
  }finally{rt.close();}
});
