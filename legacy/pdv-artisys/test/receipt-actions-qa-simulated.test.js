'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createReceiptActions}=require('../desktop/receipt-actions.cjs');

const receipt={saleId:'sale-1',saleNumber:'V-001',paperMm:80,width:48,text:'CUPOM',logoDataUrl:null};

test('QA printer simulation keeps the audit lifecycle without touching host hardware',async()=>{
  const calls=[];let hardwareCalls=0;
  const actions=createReceiptActions({
    getReceipt:async()=>receipt,
    createPrintAttempt:async()=>({job:{id:'manual-qa'},receipt}),
    finishPrintAttempt:async(id,jobId,outcome)=>{calls.push([id,jobId,outcome]);return {job:{id:jobId,status:'PRINTED'}};},
    printReceipt:async()=>{hardwareCalls+=1;return {success:true};},
    dialog:{showSaveDialog:async()=>({canceled:true})},writeFile:async()=>{},BrowserWindow:class{},
    env:{ARTISYS_QA:'1',ARTISYS_QA_SIMULATE_PRINTER:'1'}
  });
  const result=await actions.printSale({saleId:'sale-1',sessionToken:'session'});
  assert.deepEqual(result,{success:true,driver:'qa-simulated'});
  assert.equal(hardwareCalls,0);
  assert.deepEqual(calls,[['sale-1','manual-qa',{success:true}]]);
});