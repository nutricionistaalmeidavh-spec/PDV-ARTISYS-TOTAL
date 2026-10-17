'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHardwareAdapters}=require('../js/hardware/hardware-adapters');
const {createHardwareController}=require('../desktop/hardware-bridge.cjs');

test('hardware adapters expose narrow scanner scale printer and drawer contracts',async()=>{
  const calls=[];
  const adapters=createHardwareAdapters({
    scanner:{status:async()=>({available:true,mode:'keyboard-wedge'}),start:async()=>calls.push('scan:start'),stop:async()=>calls.push('scan:stop')},
    scale:{status:async()=>({available:true,unit:'kg'}),readWeight:async()=>1.275,tare:async()=>calls.push('tare')},
    printer:{status:async()=>({available:true}),print:async job=>({success:true,id:job.id})},
    drawer:{status:async()=>({available:true}),open:async()=>calls.push('drawer')}
  });
  assert.deepEqual(await adapters.barcodeScanner.status(),{available:true,mode:'keyboard-wedge'});
  await adapters.barcodeScanner.start();await adapters.barcodeScanner.stop();
  assert.equal(await adapters.scale.readWeight(),1.275);await adapters.scale.tare();
  assert.deepEqual(await adapters.receiptPrinter.print({id:'j1'}),{success:true,id:'j1'});
  await adapters.cashDrawer.open();
  assert.deepEqual(calls,['scan:start','scan:stop','tare','drawer']);
});

test('hardware controller validates values and delegates only supported terminal operations',async()=>{
  const calls=[];
  const controller=createHardwareController({
    status:async()=>({scale:{available:true}}),
    readWeight:async()=>1.5,
    tare:async()=>{calls.push('tare');return true;},
    openDrawer:async()=>{calls.push('drawer');return true;},
    print:async job=>{calls.push(job);return {success:true};}
  });
  assert.deepEqual(await controller.status(),{scale:{available:true}});
  assert.equal((await controller.readWeight()).weight,1.5);
  await controller.tare();await controller.openDrawer();
  await controller.print({id:'p1',text:'Cupom',width:42});
  await assert.rejects(()=>controller.print({text:'x',width:99}),/largura/i);
  assert.equal(calls.length,3);
});

test('hardware controller returns only sanitized installed-printer fields',async()=>{
  const controller=createHardwareController({listPrinters:async()=>[
    {name:'POS80',displayName:'POS80 Printer',isDefault:true,status:0,description:'should not leak'},
    {name:'',displayName:'invalid'},
    {name:'PDF',status:'not-a-number'}
  ]});
  assert.deepEqual(await controller.listPrinters(),[
    {name:'POS80',displayName:'POS80 Printer',isDefault:true,status:0},
    {name:'PDF',displayName:'PDF',isDefault:false,status:null}
  ]);
});

test('preload exposes narrow hardware and receipt APIs without filesystem primitives',()=>{
  const preload=fs.readFileSync(path.join(__dirname,'..','desktop','preload.cjs'),'utf8');
  assert.match(preload,/hardware:/);
  assert.match(preload,/artisys:hardware:status/);
  assert.match(preload,/artisys:hardware:printers/);
  assert.match(preload,/artisys:hardware:scale-read/);
  assert.match(preload,/artisys:hardware:drawer-open/);
  assert.match(preload,/receipts:/);
  assert.match(preload,/artisys:receipts:print-sale/);
  assert.match(preload,/artisys:receipts:save-pdf/);
  assert.doesNotMatch(preload,/serial:list|serial:open|serial:write|require\(['"]node:fs/);
});