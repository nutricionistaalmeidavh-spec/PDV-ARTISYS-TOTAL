'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');

function fixture(){
  let seq=0;
  const now=()=>new Date(Date.UTC(2026,9,3,16,0,seq++)).toISOString();
  const idFactory=prefix=>`${prefix}-${++seq}`;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-restaurant-main-clean-'));
  const runtime=createPdvRuntime({dbPath:path.join(dir,'pdv.sqlite'),now,idFactory});
  const operator=runtime.catalog.createUser({id:'op1',username:'op1-clean',name:'Operador',profileId:'profile-cashier',password:'senha-forte-123'});
  const waiter=runtime.catalog.createUser({id:'w1',username:'w1-clean',name:'Garçom',profileId:'profile-cashier',password:'senha-forte-456'});
  const customer=runtime.catalog.upsertCustomer({id:'c1',name:'Cliente Mesa'});
  const product=runtime.catalog.upsertProduct({id:'p1',name:'Prato',sku:'P1',salePriceCents:2500,costCents:1000,trackStock:false,menuEnabled:true});
  const table=runtime.restaurant.upsertTable({id:'t1',label:'Mesa 1',seats:4});
  const station=runtime.kitchen.upsertStation({id:'k1',name:'Cozinha'});
  runtime.kitchen.assignProduct(product.id,station.id);
  return {runtime,operator,waiter,customer,product,table,close(){runtime.close();fs.rmSync(dir,{recursive:true,force:true});}};
}

test('mesa preserva operador, garçom responsável, pessoas e cliente até o checkout',async()=>{
  const fx=fixture();
  try{
    const session=fx.runtime.restaurant.openTable(fx.table.id,{
      operatorId:fx.operator.id,
      waiterId:fx.waiter.id,
      partySize:3,
      customerId:fx.customer.id,
      actor:{userId:fx.operator.id,profileId:'profile-cashier'}
    });
    assert.equal(session.openedBy,fx.operator.id);
    assert.equal(session.waiterId,fx.waiter.id);
    assert.equal(session.partySize,3);
    assert.equal(session.customerId,fx.customer.id);

    fx.runtime.restaurant.addOrder(session.id,{items:[{productId:fx.product.id,quantity:2}],actor:{userId:fx.operator.id,profileId:'profile-cashier'}});
    await fx.runtime.dispatchPending();

    const table=fx.runtime.restaurant.listTables().find(row=>row.id===fx.table.id);
    assert.equal(table.productionStatus,'NEW');
    assert.equal(table.newItems,2);

    const reassigned=fx.runtime.restaurant.assignWaiter(session.id,fx.operator.id,{userId:fx.operator.id,profileId:'profile-cashier'});
    assert.equal(reassigned.waiterId,fx.operator.id);

    const result=fx.runtime.restaurant.checkoutToSale(session.id,{
      terminalId:'PDV-01',
      operatorId:fx.operator.id,
      actor:{userId:fx.operator.id,profileId:'profile-cashier',terminalId:'PDV-01'}
    },fx.runtime.sales);
    assert.equal(result.sale.customerId,fx.customer.id);
  }finally{fx.close();}
});

test('desktop expõe compositor multi-item e movimentações sem regredir Operação/Configuração',()=>{
  const root=path.join(__dirname,'..');
  const ui=fs.readFileSync(path.join(root,'desktop/renderer/restaurant-ui.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'desktop/renderer/index.html'),'utf8');
  assert.match(ui,/data-restaurant-view-target="operation"/);
  assert.match(ui,/data-restaurant-view-target="management"/);
  assert.match(ui,/PdvOrderComposer/);
  assert.match(ui,/restaurant-open-table-form/);
  assert.match(ui,/restaurant-add-draft-form/);
  assert.match(ui,/data-send-order/);
  assert.match(ui,/restaurant-split-form/);
  assert.match(ui,/restaurant-transfer-item-form/);
  assert.match(ui,/restaurant-cancel-item-form/);
  assert.match(ui,/restaurant-merge-form/);
  assert.match(html,/shared\/order-composer\.js/);
});
