import test from'node:test';import assert from'node:assert/strict';import{quoteLine}from'../src/index.mjs';
test('applies quantity tier and discount',()=>{assert.deepEqual(quoteLine({basePrice:3.99,quantity:3,tiers:[{minQuantity:3,unitPrice:10/3}]}),{quantity:3,unitPrice:3.33,subtotal:9.99,total:9.99})});
