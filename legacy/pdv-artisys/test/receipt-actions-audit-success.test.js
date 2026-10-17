'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createReceiptActions}=require('../desktop/receipt-actions.cjs');

const receipt={saleId:'sale-1',saleNumber:'V-001',paperMm:80,width:48,text:'CUPOM',logoDataUrl:null};

test('successful physical print is not reclassified as failed when success audit persistence is unavailable',async()=>{
  const outcomes=[];
  const actions=createReceiptActions({
    BrowserWindow:class{},
    dialog:{showSaveDialog:async()=>({canceled:true})},
    writeFile:async()=>{},
    getReceipt:async()=>receipt,
    createPrintAttempt:async()=>({job:{id:'manual-1'},receipt}),
    finishPrintAttempt:async(_saleId,_jobId,outcome)=>{
      outcomes.push(outcome);
      throw new Error('audit endpoint unavailable');
    },
    printReceipt:async()=>({success:true,driver:'electron'}),
    env:{}
  });

  const result=await actions.printSale({saleId:'sale-1',sessionToken:'session'});
  assert.equal(result.success,true);
  assert.equal(result.auditPending,true);
  assert.match(result.auditError,/audit endpoint unavailable/);
  assert.deepEqual(outcomes,[{success:true}]);
});