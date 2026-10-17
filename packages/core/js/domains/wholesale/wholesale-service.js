'use strict';

const {principalFromActor}=require('../../core/auth/principal-resolver');

function createWholesaleService({db,modules,orders,pricing,authorization=null,now=()=>new Date().toISOString()}={}){
  if(!db||!modules||!orders||!pricing)throw new TypeError('db, modules, orders and pricing are required.');
  const gate=actor=>modules.requireAccess('WHOLESALE',actor);
  const manager=actor=>{gate(actor);if(authorization)authorization.require({principal:principalFromActor(actor),capability:'wholesale.orders.manage'});};
  const VALID_PAYMENT_METHODS=new Set(['CASH','PIX','DEBIT_CARD','CREDIT_CARD','STORE_CREDIT']);
  const DEFAULT_PAYMENT_METHODS=['CASH','PIX','DEBIT_CARD','CREDIT_CARD','STORE_CREDIT'];
  function normalizePayments(values){
    const list=Array.isArray(values)?values:DEFAULT_PAYMENT_METHODS;
    const normalized=[...new Set(list.map(value=>String(value||'').trim().toUpperCase()).filter(value=>VALID_PAYMENT_METHODS.has(value)))];
    if(!normalized.length)throw new Error('Informe ao menos uma forma de pagamento permitida.');
    return normalized;
  }
  function getCustomerPolicy(customerId,actor={}){
    gate(actor);const id=String(customerId||'').trim();const customer=db.prepare('SELECT id,name,credit_limit_cents,credit_used_cents,active FROM customers WHERE id=?').get(id);
    if(!customer||!customer.active)throw new Error('Cliente nao encontrado ou inativo.');
    const row=db.prepare('SELECT * FROM wholesale_customer_policies WHERE customer_id=?').get(id);
    let allowedPaymentMethods=DEFAULT_PAYMENT_METHODS;try{allowedPaymentMethods=row?JSON.parse(row.allowed_payment_methods_json):DEFAULT_PAYMENT_METHODS;}catch{}
    const creditLimitCents=Number(customer.credit_limit_cents||0),creditUsedCents=Number(customer.credit_used_cents||0);
    return{customerId:id,customerName:customer.name,minimumOrderCents:Number(row?.minimum_order_cents||0),allowedPaymentMethods:normalizePayments(allowedPaymentMethods),creditLimitCents,creditUsedCents,availableCreditCents:Math.max(creditLimitCents-creditUsedCents,0),active:row?Boolean(row.active):true,updatedAt:row?.updated_at||null};
  }
  function saveCustomerPolicy(input={},actor={}){
    manager(actor);const current=getCustomerPolicy(input.customerId,actor);const minimumOrderCents=Math.max(0,Math.trunc(Number(input.minimumOrderCents||0)));const allowedPaymentMethods=normalizePayments(input.allowedPaymentMethods);const ts=now();
    db.prepare(`INSERT INTO wholesale_customer_policies(customer_id,minimum_order_cents,allowed_payment_methods_json,active,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(customer_id) DO UPDATE SET minimum_order_cents=excluded.minimum_order_cents,allowed_payment_methods_json=excluded.allowed_payment_methods_json,active=excluded.active,updated_at=excluded.updated_at`)
      .run(current.customerId,minimumOrderCents,JSON.stringify(allowedPaymentMethods),input.active===false?0:1,actor?.userId||null,ts,ts);
    return getCustomerPolicy(current.customerId,actor);
  }

  function listTiers(filters={},actor={}){gate(actor);return pricing.listQuantityTiers(filters);}
  function upsertTier(input={},actor={}){manager(actor);return pricing.upsertQuantityTier(input,actor);}
  function deactivateTier(id,actor={}){manager(actor);return pricing.deactivateQuantityTier(id,actor);}
  function resolvePrice(productId,quantity,actor={}){
    gate(actor);return pricing.resolveUnitPrice({productId,quantity,channel:'WHOLESALE'});
  }
  function createQuote(input={},actor={}){
    gate(actor);
    if(!Array.isArray(input.items)||!input.items.length)throw new Error('Pedido de atacado deve possuir ao menos um item.');
    const policy=getCustomerPolicy(input.customerId,actor);
    if(!policy.active)throw new Error('Cliente nao esta habilitado para pedidos de Atacado.');
    const items=input.items.map(item=>{const price=pricing.resolveUnitPrice({productId:item.productId,quantity:item.quantity,customerId:input.customerId||null,channel:'WHOLESALE'});return{productId:price.productId,quantity:price.quantity,unitPriceCents:price.unitPriceCents,pricingSnapshot:{version:1,kind:'QUANTITY_TIER',channel:'WHOLESALE',baseUnitPriceCents:price.baseUnitPriceCents,unitPriceCents:price.unitPriceCents,tierId:price.tierId,minQuantity:price.minQuantity,savingsPerUnitCents:price.savingsPerUnitCents,resolvedAt:now()}};});
    const totalCents=items.reduce((sum,item)=>sum+Math.round(Number(item.quantity)*Number(item.unitPriceCents)),0);
    if(totalCents<policy.minimumOrderCents)throw new Error(`Pedido minimo deste cliente: R$ ${(policy.minimumOrderCents/100).toFixed(2).replace('.',',')}.`);
    const commercialPolicySnapshot={version:1,customerId:policy.customerId,minimumOrderCents:policy.minimumOrderCents,allowedPaymentMethods:[...policy.allowedPaymentMethods],creditLimitCents:policy.creditLimitCents,creditUsedCents:policy.creditUsedCents,availableCreditCents:policy.availableCreditCents,resolvedAt:now()};
    return orders.createQuote({...input,origin:'WHOLESALE',items,commercialPolicySnapshot},actor);
  }
  function requireWholesaleOrder(id,actor={}){
    gate(actor);const order=orders.getOrder(id);if(!order)throw new Error('Pedido de atacado nao encontrado.');if(String(order.origin||'STANDARD')!=='WHOLESALE')throw new Error('Pedido informado nao pertence ao Atacado.');return order;
  }
  function getOrder(id,actor={}){return requireWholesaleOrder(id,actor);}
  function listOrders(filters={},actor={}){gate(actor);return orders.listOrders({...filters,origin:'WHOLESALE'});}
  function confirmOrder(id,actor={}){requireWholesaleOrder(id,actor);return orders.confirmOrder(id,actor);}
  function cancelOrder(id,input={},actor={}){requireWholesaleOrder(id,actor);return orders.cancelOrder(id,input,actor);}
  function fulfillOrder(id,input={},actor={}){requireWholesaleOrder(id,actor);return orders.fulfillOrder(id,input,actor);}

  return{listTiers,upsertTier,deactivateTier,resolvePrice,getCustomerPolicy,saveCustomerPolicy,createQuote,getOrder,listOrders,confirmOrder,cancelOrder,fulfillOrder};
}
module.exports={createWholesaleService};
