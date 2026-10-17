'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const { createPdvRuntime }=require('../js/core/pdv-runtime');

function ids(){let n=0;return prefix=>`${prefix}-${++n}`;}
const admin={userId:'admin-1',profileId:'profile-administrator',terminalId:'pdv-1'};
function runtime(){return createPdvRuntime({dbPath:':memory:',idFactory:ids(),now:(()=>{let i=0;return()=>`2026-09-11T01:${String(Math.floor(i/60)).padStart(2,'0')}:${String(i++%60).padStart(2,'0')}.000Z`;})()});}
function seed(rt){
  rt.catalog.createUser({id:'admin-1',username:'admin',name:'Admin',profileId:'profile-administrator',password:'1234567890'},admin);
  rt.catalog.upsertProduct({id:'pizza',name:'Pizza',salePriceCents:3000,trackStock:false},admin);
  rt.catalog.upsertProduct({id:'burger',name:'Burger',salePriceCents:2000,trackStock:false},admin);
  rt.catalog.upsertProduct({id:'soda',name:'Refrigerante',salePriceCents:700,trackStock:true},admin);
  rt.catalog.upsertProduct({id:'ham',name:'Presunto kg',salePriceCents:4000,unit:'KG',trackStock:true},admin);
  rt.inventory.move({productId:'soda',type:'opening',quantityDelta:100,reason:'seed'},admin);
  rt.inventory.move({productId:'ham',type:'opening',quantityDelta:50,reason:'seed'},admin);
  const station=rt.kitchen.upsertStation({id:'cozinha',name:'Cozinha',printEnabled:false},admin);
  rt.kitchen.configureProductRoute('pizza',{mode:'PRODUCTION',stationId:station.id},admin);
  rt.kitchen.configureProductRoute('burger',{mode:'PRODUCTION',stationId:station.id},admin);
  rt.kitchen.configureProductRoute('soda',{mode:'DIRECT'},admin);
}

test('E43 pizza customization is a capability of Alimentação',()=>{
  const rt=runtime();seed(rt);
  rt.modules.setEnabled('FOOD',false,admin);
  assert.throws(()=>rt.pizzeria.upsertProfile({productId:'pizza'} ,admin),/Modulo FOOD desativado/);
  rt.modules.setEnabled('FOOD',true,admin);
  rt.pizzeria.upsertProfile({productId:'pizza',pricingPolicy:'HIGHEST_FLAVOR'},admin);
  const size=rt.pizzeria.upsertSize({id:'large',productId:'pizza',name:'Grande',maxFlavors:2,priceDeltaCents:500},admin);
  rt.pizzeria.upsertFlavor({id:'calabresa',productId:'pizza',name:'Calabresa',priceDeltaCents:400},admin);
  rt.pizzeria.upsertFlavor({id:'marguerita',productId:'pizza',name:'Marguerita',priceDeltaCents:200},admin);
  rt.pizzeria.upsertCrust({id:'catupiry',productId:'pizza',name:'Borda Catupiry',priceDeltaCents:600},admin);
  const priced=rt.pizzeria.pricePizza({productId:'pizza',sizeId:size.id,flavorIds:['calabresa','marguerita'],crustId:'catupiry'});
  assert.equal(priced.unitPriceCents,4500);
  assert.equal(priced.configurationSnapshot.pizza.flavors.length,2);
  assert.throws(()=>rt.pizzeria.pricePizza({productId:'pizza',sizeId:'large',flavorIds:['calabresa','marguerita','calabresa']}),/maximo 2 sabores/i);
  rt.close();
});

test('E43 configured pizza survives restaurant order and canonical checkout snapshot',()=>{
  const rt=runtime();seed(rt);rt.modules.setEnabled('FOOD',true,admin);
  rt.pizzeria.upsertProfile({productId:'pizza',pricingPolicy:'HIGHEST_FLAVOR'},admin);
  rt.pizzeria.upsertSize({id:'g',productId:'pizza',name:'Grande',maxFlavors:2,priceDeltaCents:500},admin);
  rt.pizzeria.upsertFlavor({id:'cal',productId:'pizza',name:'Calabresa',priceDeltaCents:400},admin);
  rt.pizzeria.upsertFlavor({id:'mar',productId:'pizza',name:'Marguerita',priceDeltaCents:200},admin);
  const priced=rt.pizzeria.pricePizza({productId:'pizza',sizeId:'g',flavorIds:['cal','mar']});
  rt.restaurant.upsertTable({id:'pizza-table',label:'Pizza 1'},admin);const session=rt.restaurant.openTable('pizza-table',{operatorId:'admin-1',actor:admin});
  const order=rt.restaurant.addOrder(session.id,{items:[{productId:'pizza',quantity:1,unitPriceCents:priced.unitPriceCents,configurationSnapshot:priced.configurationSnapshot}],actor:admin});
  assert.equal(order.items[0].unitPriceCents,3900);assert.equal(order.items[0].configuration.pizza.flavors.length,2);
  const checkout=rt.restaurant.checkoutToSale(session.id,{terminalId:'pdv-1',operatorId:'admin-1',actor:admin},rt.sales);
  assert.equal(checkout.sale.totalCents,3900);assert.equal(checkout.sale.items[0].configuration.pizza.size.name,'Grande');
  rt.close();
});

test('E44 advanced restaurant can split items and apply service charge into canonical sales',()=>{
  const rt=runtime();seed(rt);rt.modules.setEnabled('FOOD',true,admin);
  rt.restaurant.upsertTable({id:'t1',label:'1'},admin);const session=rt.restaurant.openTable('t1',{operatorId:'admin-1',actor:admin});
  const order=rt.restaurant.addOrder(session.id,{items:[{productId:'burger',quantity:2},{productId:'soda',quantity:1}],actor:admin});
  const burger=order.items.find(i=>i.productId==='burger');
  const result=rt.restaurantSettlement.createItemSettlement(session.id,{items:[{orderItemId:burger.id,quantity:1}],serviceChargePercent:10,terminalId:'pdv-1',operatorId:'admin-1'},admin);
  assert.equal(result.sale.totalCents,2200);
  assert.equal(rt.sales.getSale(result.sale.id).status,'OPEN');
  const balance=rt.restaurantSettlement.getRemainingBalance(session.id);
  assert.equal(balance.items.length,2);
  rt.close();
});

test('E44 transfers selected items between open table sessions without moving the whole comanda',()=>{
  const rt=runtime();seed(rt);rt.modules.setEnabled('FOOD',true,admin);
  rt.restaurant.upsertTable({id:'ta',label:'A'},admin);rt.restaurant.upsertTable({id:'tb',label:'B'},admin);
  const source=rt.restaurant.openTable('ta',{operatorId:'admin-1',actor:admin});const target=rt.restaurant.openTable('tb',{operatorId:'admin-1',actor:admin});
  const order=rt.restaurant.addOrder(source.id,{items:[{productId:'burger',quantity:2},{productId:'soda',quantity:1}],actor:admin});const burger=order.items.find(i=>i.productId==='burger');
  const moved=rt.restaurantSettlement.transferItems(source.id,target.id,[{orderItemId:burger.id,quantity:1}],admin);
  assert.equal(moved.moved.length,1);
  assert.equal(rt.restaurant.getSession(source.id).totalCents,2700);
  assert.equal(rt.restaurant.getSession(target.id).totalCents,2000);
  assert.ok(rt.db.prepare("SELECT 1 FROM audit_log WHERE action='restaurant.items.transfer'").get());
  rt.close();
});

test('E44 item cancellation requires restaurant.orders.cancel and a reason',()=>{
  const rt=runtime();seed(rt);const table=rt.restaurant.upsertTable({id:'tc',label:'C'},admin);const session=rt.restaurant.openTable(table.id,{operatorId:'admin-1',actor:admin});
  const order=rt.restaurant.addOrder(session.id,{items:[{productId:'burger',quantity:1}],actor:admin});
  assert.throws(()=>rt.restaurantSettlement.cancelOrderItem(order.items[0].id,'erro',{userId:'cash',profileId:'profile-cashier'}),/permiss/i);
  assert.throws(()=>rt.restaurantSettlement.cancelOrderItem(order.items[0].id,'',admin),/motivo/i);
  assert.equal(rt.restaurantSettlement.cancelOrderItem(order.items[0].id,'Pedido duplicado',admin).cancelled,true);
  rt.close();
});

test('E45 delivery enforces lifecycle and keeps payment manual',()=>{
  const rt=runtime();seed(rt);rt.modules.setEnabled('FOOD',true,admin);
  const order=rt.delivery.create({customerName:'Ana',phone:'16999999999',fulfillmentType:'DELIVERY',address:{street:'Rua A',number:'10'},region:'Centro',feeCents:500,paymentMethod:'PIX'},admin);
  assert.equal(order.status,'NEW');assert.equal(order.feeCents,500);assert.equal(order.paymentMethod,'PIX');
  assert.throws(()=>rt.delivery.updateStatus(order.id,'DELIVERED',admin),/Transicao de delivery invalida/);
  assert.throws(()=>rt.delivery.updateStatus(order.id,'PREPARING',admin),/KDS|producao/i);
  rt.delivery.createSale(order.id,{terminalId:'pdv-1',operatorId:'admin-1',items:[{productId:'burger',quantity:1}]},admin);
  const ticket=rt.kitchen.listTickets().find(item=>item.sourceType==='DELIVERY'&&item.sourceId===order.id);
  rt.kitchen.updateTicketStatus(ticket.id,'PREPARING',admin);assert.equal(rt.delivery.get(order.id).status,'PREPARING');
  rt.kitchen.updateTicketStatus(ticket.id,'READY',admin);assert.equal(rt.delivery.get(order.id).status,'READY');
  rt.delivery.updateStatus(order.id,'OUT_FOR_DELIVERY',admin);const done=rt.delivery.updateStatus(order.id,'DELIVERED',admin);
  assert.equal(done.status,'DELIVERED');
  rt.close();
});

test('E46 fast food generates daily sequential numbers and ready board projection',()=>{
  const rt=runtime();seed(rt);rt.modules.setEnabled('FOOD',true,admin);
  const a=rt.fastFood.create({note:'sem cebola'},admin);const b=rt.fastFood.create({},admin);
  assert.equal(a.dailyNumber,1);assert.equal(b.dailyNumber,2);
  rt.fastFood.updateStatus(a.id,'PREPARING',admin);rt.fastFood.updateStatus(a.id,'READY',admin);
  assert.deepEqual(rt.fastFood.readyBoard().map(row=>({number:row.number,status:row.status})),[{number:1,status:'READY'}]);
  rt.close();
});

test('E47 weight is Core while bakery ordering remains inside Alimentação',()=>{
  const rt=runtime();seed(rt);rt.modules.setEnabled('FOOD',false,admin);
  assert.equal(rt.marketBakery.priceWeightedItem({productId:'ham',grams:250}).totalCents,1000);
  rt.marketBakery.upsertWeightBarcodeProfile({id:'scale-1',name:'Balanca',prefix:'20',totalLength:13,productStart:2,productLength:5,weightStart:7,weightLength:5,decimalPlaces:3},admin);
  const parsed=rt.marketBakery.parseWeightBarcode('2000123002500');
  assert.equal(parsed.productCode,'00123');assert.equal(parsed.weight,0.25);assert.equal(parsed.grams,250);
  assert.throws(()=>rt.marketBakery.createBakeryOrder({customerName:'Bia',items:[{productId:'soda',quantity:2}]},admin),/Modulo FOOD desativado/);
  rt.modules.setEnabled('FOOD',true,admin);
  const bakery=rt.marketBakery.createBakeryOrder({customerName:'Bia',requestedPickupAt:'2026-09-12T10:00:00-03:00',items:[{productId:'soda',quantity:2}]},admin);
  assert.equal(bakery.status,'OPEN');assert.equal(rt.marketBakery.updateBakeryOrderStatus(bakery.id,'READY',admin).status,'READY');
  rt.close();
});


test('E45 delivery cancellation persists reason and cancels its still-open canonical sale',()=>{
  const rt=runtime();seed(rt);rt.modules.setEnabled('FOOD',true,admin);
  const order=rt.delivery.create({customerName:'Cancel QA',phone:'16999999999',fulfillmentType:'DELIVERY',address:{street:'Rua QA',number:'1'},feeCents:0},admin);
  const created=rt.delivery.createSale(order.id,{terminalId:'pdv-1',operatorId:'admin-1',items:[{productId:'burger',quantity:1}]},admin);
  const cancelled=rt.delivery.cancel(order.id,'Cliente desistiu',admin);
  assert.equal(cancelled.status,'CANCELLED');
  assert.equal(cancelled.cancelReason,'Cliente desistiu');
  assert.equal(rt.sales.getSale(created.id).status,'CANCELLED');
  rt.close();
});

test('E47 bakery lookup and cancellation preserve the persisted lifecycle',()=>{
  const rt=runtime();seed(rt);rt.modules.setEnabled('FOOD',true,admin);
  const order=rt.marketBakery.createBakeryOrder({customerName:'Bia',items:[{productId:'soda',quantity:1}]},admin);
  assert.equal(rt.marketBakery.getBakeryOrder(order.id).id,order.id);
  const cancelled=rt.marketBakery.cancelBakeryOrder(order.id,'Cliente desistiu',admin);
  assert.equal(cancelled.status,'CANCELLED');
  assert.equal(rt.marketBakery.getBakeryOrder(order.id).status,'CANCELLED');
  rt.close();
});

test('E44 restaurant settlement completion and session merge persist canonical state',()=>{
  const rt=runtime();seed(rt);rt.modules.setEnabled('FOOD',true,admin);
  rt.cash.openSession({id:'cash-pdv-1',terminalId:'pdv-1',operatorId:'admin-1',initialCashCents:0,actor:admin});
  rt.restaurant.upsertTable({id:'merge-a',label:'A'},admin);
  rt.restaurant.upsertTable({id:'merge-b',label:'B'},admin);
  const source=rt.restaurant.openTable('merge-a',{operatorId:'admin-1',actor:admin});
  const target=rt.restaurant.openTable('merge-b',{operatorId:'admin-1',actor:admin});
  rt.restaurant.addOrder(source.id,{items:[{productId:'burger',quantity:1}],actor:admin});
  const merged=rt.restaurantSettlement.mergeSessions(source.id,target.id,admin);
  assert.equal(merged.targetSessionId,target.id);
  assert.equal(rt.restaurant.getSession(source.id).status,'CLOSED');
  const equal=rt.restaurantSettlement.createEqualSettlement(target.id,{parts:2,terminalId:'pdv-1',operatorId:'admin-1'},admin);
  const completed=rt.restaurantSettlement.completeSettlement(equal.settlement.id,{payments:[{method:'CASH',amountCents:1000}]},admin);
  assert.equal(completed.sale.status,'COMPLETED');
  assert.equal(completed.settlementId,equal.settlement.id);
  rt.close();
});
