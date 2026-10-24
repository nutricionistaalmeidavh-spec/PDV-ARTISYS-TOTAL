import test from 'node:test';
import assert from 'node:assert/strict';
import {OFFLINE_MANUAL_PAYMENT_METHODS,validOfflineManualSettlement} from '../src/offline-manual-payments.mjs';

test('cashier may record PIX, debit and credit individually without TEF while offline',()=>{
 assert.deepEqual(OFFLINE_MANUAL_PAYMENT_METHODS,['CASH','PIX','DEBIT_CARD','CREDIT_CARD']);
 for(const method of OFFLINE_MANUAL_PAYMENT_METHODS){
  assert.equal(validOfflineManualSettlement({branchId:'branch',
   payments:[{method,amountCents:1500}]}),true,'manual tender '+method);
 }
});
test('cashier can split a sale across CASH, PIX, debit and credit without acquirer integration',()=>{
 const body={branchId:'branch',payments:[
  {method:'CASH',amountCents:200},{method:'PIX',amountCents:300},
  {method:'DEBIT_CARD',amountCents:400},{method:'CREDIT_CARD',amountCents:100}
 ]};
 assert.equal(validOfflineManualSettlement(body),true);
});
test('manual offline tender refuses negative or unknown payments and store credit dependencies',()=>{
 for(const payments of [[],[{method:'STORE_CREDIT',amountCents:1000}],
  [{method:'OTHER',amountCents:1000}],[{method:'CASH',amountCents:-1}],
  [{method:'PIX',amountCents:0}],[{method:'DEBIT_CARD',amountCents:1.5}],
  [{method:'CREDIT_CARD',amountCents:1_000_000_001}]]){
  assert.equal(validOfflineManualSettlement({payments}),false);
 }
 assert.equal(validOfflineManualSettlement({payments:[{method:'PIX',amountCents:1000}],shares:[{method:'PIX'}]}),false);
 assert.equal(validOfflineManualSettlement({payments:[{method:'PIX',amountCents:1000}],storeCredit:true}),false);
});
