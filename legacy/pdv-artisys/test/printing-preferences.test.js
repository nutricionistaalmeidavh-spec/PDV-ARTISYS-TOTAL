'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {columnsForPaper,resolvePrintingPreferences,validatePrintingPreferences}=require('../js/domains/printing/printing-preferences');

test('paper presets map to receipt columns',()=>{
  assert.equal(columnsForPaper(58),32);
  assert.equal(columnsForPaper(80),48);
});

test('persisted settings override legacy env',()=>{
  const values=new Map([
    ['printing.paperMm',80],
    ['printing.columnsMode','manual'],
    ['printing.columns',42],
    ['printing.autoPrint',false],
    ['printing.deviceName','POS80 Printer']
  ]);
  const settings={get:(key,{defaultValue})=>values.has(key)?values.get(key):defaultValue};
  const resolved=resolvePrintingPreferences({settings,env:{PDV_RECEIPT_WIDTH:'32',PDV_AUTO_PRINT:'true',PDV_PRINTER_NAME:'OLD'}});
  assert.equal(resolved.paperMm,80);
  assert.equal(resolved.columns,42);
  assert.equal(resolved.autoPrint,false);
  assert.equal(resolved.deviceName,'POS80 Printer');
});

test('new install defaults to manual post-sale printing',()=>{
  const settings={get:(_key,{defaultValue})=>defaultValue};
  assert.equal(resolvePrintingPreferences({settings,env:{},isExistingInstall:false}).autoPrint,false);
});

test('invalid paper and columns are rejected',()=>{
  assert.throws(()=>validatePrintingPreferences({paperMm:70,columnsMode:'auto'}),/58 ou 80/);
  assert.throws(()=>validatePrintingPreferences({paperMm:80,columnsMode:'manual',columns:40}),/32, 42 ou 48/);
});

test('legacy install keeps explicit legacy auto-print flag',()=>{
  const settings={get:(_key,{defaultValue})=>defaultValue};
  assert.equal(resolvePrintingPreferences({settings,env:{PDV_AUTO_PRINT:'true'},isExistingInstall:true}).autoPrint,true);
  assert.equal(resolvePrintingPreferences({settings,env:{PDV_AUTO_PRINT:'false'},isExistingInstall:true}).autoPrint,false);
});

test('legacy install defaults auto-print to true when flag was never configured',()=>{
  const settings={get:(_key,{defaultValue})=>defaultValue};
  assert.equal(resolvePrintingPreferences({settings,env:{},isExistingInstall:true}).autoPrint,true);
});

test('legacy silent printing maps to system dialog fallback',()=>{
  const settings={get:(_key,{defaultValue})=>defaultValue};
  assert.equal(resolvePrintingPreferences({settings,env:{PDV_PRINT_SILENT:'true'},isExistingInstall:true}).showSystemDialog,false);
  assert.equal(resolvePrintingPreferences({settings,env:{PDV_PRINT_SILENT:'false'},isExistingInstall:true}).showSystemDialog,true);
});
