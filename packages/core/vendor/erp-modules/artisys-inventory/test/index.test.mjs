import test from 'node:test';
import assert from 'node:assert/strict';
import {createInventory,applyMovement,reserveStock,releaseStock,availableQuantity,createInventoryMovement,applyTrackedMovement,traceInventory} from '../src/index.mjs';

test('tracks movements and reservations',()=>{let s=createInventory([{sku:'A',onHand:10}]);s=applyMovement(s,{sku:'A',delta:2});s=reserveStock(s,'A',5);assert.equal(availableQuantity(s.A),7);s=releaseStock(s,'A',2);assert.equal(s.A.reserved,3)});

test('tracks lot balances and expiry metadata',()=>{let s=createInventory();const movement=createInventoryMovement({id:'m1',sku:'MED',kind:'in',quantity:10,lotNumber:'L1',expiresAt:'2027-01-01'});s=applyTrackedMovement(s,movement);assert.equal(s.MED.onHand,10);assert.deepEqual(traceInventory(s,'MED').lots,[{lotNumber:'L1',onHand:10,expiresAt:'2027-01-01T00:00:00.000Z'}]);});

test('enforces serialized lifecycle',()=>{let s=createInventory();const incoming=createInventoryMovement({id:'m1',sku:'TOOL',kind:'in',quantity:1,serialNumber:'SN1'});s=applyTrackedMovement(s,incoming);assert.throws(()=>applyTrackedMovement(s,incoming),/already in stock/);s=applyTrackedMovement(s,createInventoryMovement({id:'m2',sku:'TOOL',kind:'out',quantity:1,serialNumber:'SN1'}));assert.equal(traceInventory(s,'TOOL').serials[0].status,'issued');});

test('requires explicit delta for adjustments',()=>{const s=createInventory([{sku:'A',onHand:5}]);const movement=createInventoryMovement({id:'m3',sku:'A',kind:'adjustment',quantity:1});assert.throws(()=>applyTrackedMovement(s,movement),/adjustmentDelta/);});
