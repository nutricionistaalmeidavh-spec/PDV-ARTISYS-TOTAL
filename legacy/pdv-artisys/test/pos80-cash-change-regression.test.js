'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ui=require('../desktop/renderer/ui-model');
const {renderSaleReceipt}=require('../js/domains/printing/receipt-renderer');
const {createPromotionSaleService}=require('../js/domains/sales/promotion-sale-service');
const {createElectronPrinterDriver}=require('../vendor/artisys-printing/src/drivers/electron-printer');
const printingPreferences=require('../js/domains/printing/printing-preferences');

const root=path.resolve(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

test('cash checkout exposes received amount and computes live change',()=>{
  assert.equal(typeof ui.calculateCashChange,'function');
  assert.deepEqual(ui.calculateCashChange(199,1000),{receivedCents:1000,remainingCents:0,changeCents:801,sufficient:true});
  assert.deepEqual(ui.calculateCashChange(199,100),{receivedCents:100,remainingCents:99,changeCents:0,sufficient:false});
  const cashUi=read('desktop/renderer/cash-change-ui.js');
  const index=read('desktop/renderer/index.html');
  assert.match(cashUi,/id=\"cash-received-value\"/);
  assert.match(cashUi,/id=\"cash-change-value\"/);
  assert.match(cashUi,/Valor recebido/);
  assert.match(cashUi,/ApiClient\.prototype\.completeSale/);
  assert.match(index,/cash-change-ui\.js/);
});

test('receipt prints friendly cash label, amount received and change without leaking internal ids',()=>{
  const text=renderSaleReceipt({
    storeName:'B1 Limpe',
    sale:{
      id:'s1',saleNumber:'V-1',status:'COMPLETED',operatorName:'Administrador',sellerName:'Administrador',customerName:'Cliente Teste',
      subtotalCents:199,totalCents:199,discountCents:0,changeCents:801,completedAt:'2026-09-24T13:00:00Z',
      items:[{productName:'Prendedor',quantity:1,unitPriceCents:199,totalCents:199}],
      payments:[{method:'CASH',amountCents:1000}]
    },
    width:48
  });
  assert.match(text,/Operador: Administrador/);
  assert.match(text,/Cliente: Cliente Teste/);
  assert.match(text,/Dinheiro recebido\s+10,00/);
  assert.match(text,/Troco\s+8,01/);
  assert.doesNotMatch(text,/\bCASH\b/);

  const fallback=renderSaleReceipt({
    storeName:'B1 Limpe',
    sale:{
      id:'s2',saleNumber:'V-2',status:'COMPLETED',operatorId:'user-interno',sellerId:'user-interno',sellerName:'Administrador',customerId:'cust-interno',
      subtotalCents:199,totalCents:199,discountCents:0,changeCents:0,completedAt:'2026-09-24T13:00:00Z',
      items:[{productName:'Prendedor',quantity:1,unitPriceCents:199,totalCents:199}],payments:[{method:'CASH',amountCents:199}]
    },width:48
  });
  assert.match(fallback,/Operador: Administrador/);
  assert.doesNotMatch(fallback,/user-interno|cust-interno/);
});

test('sale receipt projection exposes readable operator and customer names from persisted ids',()=>{
  const db={
    exec(){},
    prepare(sql){
      if(sql==='PRAGMA table_info(sales)')return{all:()=>[{name:'observation'},{name:'print_observation'}]};
      if(sql.startsWith('SELECT * FROM sale_discount_states'))return{get:()=>null};
      if(sql.startsWith('SELECT observation,print_observation'))return{get:()=>({})};
      if(sql.startsWith('SELECT name FROM users'))return{get:id=>id==='u1'?{name:'Administrador'}:undefined};
      if(sql.startsWith('SELECT name FROM customers'))return{get:id=>id==='c1'?{name:'Cliente Teste'}:undefined};
      throw new Error(`SQL inesperado no teste: ${sql}`);
    }
  };
  const baseSales={getSaleDetails:()=>({id:'s1',saleNumber:'V-1',operatorId:'u1',sellerId:'u1',sellerName:'Administrador',customerId:'c1',discountCents:0,items:[]})};
  const sales=createPromotionSaleService({db,baseSales,promotionService:{}});
  const details=sales.getSaleDetails('s1');
  assert.equal(details.operatorName,'Administrador');
  assert.equal(details.customerName,'Cliente Teste');
});

test('electron POS80 receipt centers the printable sheet inside the physical 80 mm page',async()=>{
  let loaded='';let options=null;
  class FakeWindow{
    constructor(){this.webContents={executeJavaScript:async()=>600,print:(value,cb)=>{options=value;cb(true,'');}};}
    async loadURL(url){loaded=decodeURIComponent(url.slice(url.indexOf(',')+1));}
    isDestroyed(){return false;}
    close(){}
  }
  const driver=createElectronPrinterDriver({BrowserWindow:FakeWindow});
  const result=await driver.print({text:'CUPOM\n',paperMm:80,width:48},{mode:'electron',width:48,deviceName:'POS80 Printer'});
  assert.equal(result.success,true);
  assert.equal(options.pageSize.width,80000);
  assert.match(loaded,/class=\"receipt-sheet\"/);
  assert.match(loaded,/justify-content:center/);
  assert.match(loaded,/width:100%/);
});

test('known POS80 and SMX-T80E names repair legacy 58 mm / 32-column preferences',()=>{
  assert.equal(printingPreferences.suggestPaperForPrinter('POS80 Printer'),80);
  assert.equal(printingPreferences.suggestPaperForPrinter('SMX-T80E'),80);
  assert.equal(printingPreferences.suggestPaperForPrinter('Generic Printer'),null);
  const values=new Map([
    ['printing.paperMm',58],['printing.columnsMode','manual'],['printing.columns',32],['printing.deviceName','POS80 Printer']
  ]);
  const settings={get:(key,{defaultValue})=>values.has(key)?values.get(key):defaultValue};
  const resolved=printingPreferences.resolvePrintingPreferences({settings,env:{},isExistingInstall:true});
  assert.equal(resolved.paperMm,80);
  assert.equal(resolved.columnsMode,'auto');
  assert.equal(resolved.columns,48);
});
