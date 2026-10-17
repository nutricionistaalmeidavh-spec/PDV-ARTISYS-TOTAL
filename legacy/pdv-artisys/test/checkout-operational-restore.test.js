'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ui=require('../desktop/renderer/ui-model');

test('checkout restore ignores open sales already linked to operational documents',()=>{
  const openSales=[
    {id:'sale-delivery',terminalId:'PDV-01',operatorId:'cashier-1',status:'OPEN',items:[{id:'i1'}]},
    {id:'sale-manual',terminalId:'PDV-01',operatorId:'cashier-1',status:'OPEN',items:[{id:'i2'}]}
  ];
  const documents=[{type:'DELIVERY',id:'delivery-1',saleId:'sale-delivery'}];

  assert.equal(
    ui.selectCheckoutRestoreSale(openSales,documents,'PDV-01','cashier-1')?.id,
    'sale-manual'
  );
});

test('checkout restore stays empty when every matching open sale belongs to an operational document',()=>{
  const openSales=[
    {id:'sale-pickup',terminalId:'PDV-01',operatorId:'cashier-1',status:'OPEN',items:[{id:'i1'}]},
    {id:'sale-delivery',terminalId:'PDV-01',operatorId:'cashier-1',status:'OPEN',items:[{id:'i2'}]}
  ];
  const documents=[
    {type:'DELIVERY',id:'pickup-1',saleId:'sale-pickup'},
    {type:'DELIVERY',id:'delivery-1',saleId:'sale-delivery'}
  ];

  assert.equal(ui.selectCheckoutRestoreSale(openSales,documents,'PDV-01','cashier-1'),null);
});

test('checkout keeps the manual-sale protection but allows switching between operational documents',()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','desktop','renderer','app.js'),'utf8');

  assert.match(app,/api\.checkoutDocuments\(''\)/);
  assert.match(app,/selectCheckoutRestoreSale/);
  assert.match(app,/state\.checkoutDocumentContext/);
  assert.match(app,/currentOperationalDocument/);
  assert.match(app,/!currentOperationalDocument/);
  assert.match(app,/Finalize, suspenda ou cancele a venda atual antes de abrir uma comanda ou pedido/);
});
