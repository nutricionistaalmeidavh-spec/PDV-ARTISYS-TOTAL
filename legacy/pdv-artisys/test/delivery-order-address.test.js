'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const { createPdvRuntime }=require('../js/core/pdv-runtime');

const actor={userId:'manager',profileId:'profile-manager',terminalId:'PDV-01'};
const address={
  postalCode:'14020-010',street:'Rua das Flores',number:'123',complement:'Sala 2',
  district:'Centro',city:'Ribeirao Preto',state:'SP',reference:'Ao lado da praca'
};

function setup(){
  let seq=0;
  const runtime=createPdvRuntime({now:()=> '2026-09-20T15:00:00.000Z',idFactory:p=>`${p}-${++seq}`});
  runtime.catalog.createUser({id:'manager',username:'manager',name:'Gerente',profileId:'profile-manager',password:'senha-forte-123'},actor);
  runtime.catalog.upsertCustomer({id:'customer',name:'Cliente Entrega',phone:'16999999999',address},actor);
  runtime.catalog.upsertProduct({id:'product',name:'Produto',salePriceCents:1200,costCents:600,trackStock:false},actor);
  return runtime;
}

test('customer persists and returns a structured Brazilian delivery address',()=>{
  const runtime=setup();
  const customer=runtime.catalog.getCustomer('customer');
  assert.deepEqual(customer.address,{
    postalCode:'14020010',street:'Rua das Flores',number:'123',complement:'Sala 2',
    district:'Centro',city:'Ribeirao Preto',state:'SP',reference:'Ao lado da praca'
  });
  runtime.close();
});

test('delivery order snapshots the customer address and keeps it immutable when customer changes',()=>{
  const runtime=setup();
  const order=runtime.orders.createQuote({
    customerId:'customer',locationId:'MAIN',fulfillmentType:'DELIVERY',deliveryInstructions:'Entregar na recepcao',
    items:[{productId:'product',quantity:1}]
  },actor);
  assert.equal(order.deliveryAddress.postalCode,'14020010');
  assert.equal(order.deliveryAddress.street,'Rua das Flores');
  assert.equal(order.deliveryAddress.number,'123');
  assert.equal(order.deliveryInstructions,'Entregar na recepcao');

  runtime.catalog.upsertCustomer({id:'customer',name:'Cliente Entrega',address:{...address,street:'Avenida Nova',number:'999'}},actor);
  const persisted=runtime.orders.getOrder(order.id);
  assert.equal(persisted.deliveryAddress.street,'Rua das Flores');
  assert.equal(persisted.deliveryAddress.number,'123');
  runtime.close();
});

test('delivery requires a complete address while pickup does not',()=>{
  const runtime=setup();
  runtime.catalog.upsertCustomer({id:'without-address',name:'Sem Endereco'},actor);
  assert.throws(()=>runtime.orders.createQuote({customerId:'without-address',locationId:'MAIN',fulfillmentType:'DELIVERY',items:[{productId:'product',quantity:1}]},actor),/endereco de entrega completo/i);
  assert.doesNotThrow(()=>runtime.orders.createQuote({customerId:'without-address',locationId:'MAIN',fulfillmentType:'PICKUP',items:[{productId:'product',quantity:1}]},actor));
  runtime.close();
});

test('desktop exposes structured customer address and delivery instructions',()=>{
  const root=path.resolve(__dirname,'..');
  const deliveryUi=fs.readFileSync(path.join(root,'desktop/renderer/delivery-address-ui.js'),'utf8');
  const index=fs.readFileSync(path.join(root,'desktop/renderer/index.html'),'utf8');
  for(const label of ['CEP','Logradouro','Número','Bairro','Cidade','UF','Referência'])assert.match(deliveryUi,new RegExp(label));
  for(const marker of ['deliveryAddress','deliveryInstructions','Endereço de entrega','Instruções de entrega'])assert.match(deliveryUi,new RegExp(marker));
  assert.match(deliveryUi,/PdvUiLifecycle/);
  assert.match(deliveryUi,/modal:mounted/);
  assert.match(deliveryUi,/enterprise-orders/);
  assert.doesNotMatch(deliveryUi,/new MutationObserver/);
  assert.match(index,/delivery-address-ui\.js/);
});
