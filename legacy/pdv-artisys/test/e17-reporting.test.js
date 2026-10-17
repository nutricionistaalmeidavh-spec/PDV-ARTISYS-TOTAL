'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {createReportingService}=require('../js/domains/reports/reporting-service');

function fixture(){
  const db=openDatabase(':memory:');runMigrations(db);
  const user=db.prepare("INSERT INTO users (id,username,name,role,password_hash,password_salt,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)");
  user.run('u1','ana','Ana','cashier','h','s',1,'2026-09-01','2026-09-01');
  user.run('u2','bia','Bia','cashier','h','s',1,'2026-09-01','2026-09-01');
  db.prepare("INSERT INTO categories (id,name,active,created_at,updated_at) VALUES ('c1','Geral',1,'2026-09-01','2026-09-01')").run();
  db.prepare("INSERT INTO customers (id,name,active,credit_limit_cents,credit_used_cents,created_at,updated_at) VALUES ('cli1','Maria Cliente',1,0,0,'2026-09-01','2026-09-01')").run();
  const product=db.prepare(`INSERT INTO products (id,sku,name,category_id,unit,sale_price_cents,cost_cents,track_stock,minimum_stock,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  product.run('p1','SKU1','Café','c1','UN',1000,600,1,2,1,'2026-09-01','2026-09-01');
  product.run('p2','SKU2','Leite','c1','UN',800,400,1,2,1,'2026-09-01','2026-09-01');
  db.prepare("INSERT INTO inventory_balances (product_id,quantity,updated_at) VALUES ('p1',3,'2026-09-09')").run();
  db.prepare("INSERT INTO inventory_balances (product_id,quantity,updated_at) VALUES ('p2',1,'2026-09-09')").run();
  const sale=db.prepare(`INSERT INTO sales (id,sale_number,terminal_id,operator_id,customer_id,status,subtotal_cents,discount_cents,total_cents,change_cents,opened_at,completed_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  sale.run('s1','V-001','T1','u1','cli1','COMPLETED',2000,0,2000,0,'2026-09-09T10:00:00Z','2026-09-09T10:05:00Z','2026-09-09T10:05:00Z');
  sale.run('s2','V-002','T1','u1',null,'COMPLETED',1000,100,900,0,'2026-09-09T11:00:00Z','2026-09-09T11:05:00Z','2026-09-09T11:05:00Z');
  const item=db.prepare(`INSERT INTO sale_items (id,sale_id,product_id,product_name,sku,quantity,unit_price_cents,total_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  item.run('i1','s1','p1','Café','SKU1',2,1000,2000,'2026-09-09','2026-09-09');
  item.run('i2','s2','p1','Café','SKU1',1,1000,1000,'2026-09-09','2026-09-09');
  const pay=db.prepare("INSERT INTO payments (id,sale_id,method,amount_cents,created_at) VALUES (?,?,?,?,?)");
  pay.run('pa1','s1','CASH',2000,'2026-09-09');
  pay.run('pa2','s2','PIX',900,'2026-09-09');
  db.prepare(`INSERT INTO return_transactions (id,sale_id,terminal_id,operator_id,status,total_cents,reason,created_at) VALUES (?,?,?,?,?,?,?,?)`).run('r1','s1','T1','u1','COMPLETED',1000,'Troca','2026-09-09T12:00:00Z');
  db.prepare(`INSERT INTO return_items (id,return_id,sale_item_id,product_id,product_name,quantity,unit_price_cents,total_cents,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run('ri1','r1','i1','p1','Café',1,1000,1000,'2026-09-09T12:00:00Z');
  db.prepare(`INSERT INTO cash_sessions (id,terminal_id,operator_id,status,initial_cash_cents,expected_cash_cents,counted_cash_cents,divergence_cents,opened_at,closed_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('cs1','T1','u1','CLOSED',500,1400,1300,-100,'2026-09-09T09:00:00Z','2026-09-09T18:00:00Z');
  const cash=db.prepare(`INSERT INTO cash_movements (id,cash_session_id,type,amount_cents,payment_method,sale_id,note,created_at) VALUES (?,?,?,?,?,?,?,?)`);
  cash.run('cm1','cs1','OPENING',500,'CASH',null,'Abertura','2026-09-09T09:00:00Z');
  cash.run('cm2','cs1','SALE',2000,'CASH','s1',null,'2026-09-09T10:05:00Z');
  cash.run('cm3','cs1','SALE',900,'PIX','s2',null,'2026-09-09T11:05:00Z');
  cash.run('cm4','cs1','SUPPLY',300,'CASH',null,'Troco','2026-09-09T11:30:00Z');
  cash.run('cm5','cs1','WITHDRAWAL',400,'CASH',null,'Sangria','2026-09-09T11:45:00Z');
  cash.run('cm6','cs1','REVERSAL',1000,'CASH',null,'RETURN:r1:COMPLETED','2026-09-09T12:00:00Z');
  db.prepare(`INSERT INTO financial_entries (id,kind,description,amount_cents,due_at,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run('f1','PAYABLE','Conta',5000,'2026-09-10','OPEN','2026-09-01','2026-09-01');
  return {db,reports:createReportingService({db,now:()=> '2026-09-10T12:00:00Z'})};
}

test('sales report reconciles customers, products, discounts, payments and returns',()=>{
  const {db,reports}=fixture();
  const r=reports.buildSalesSummary({from:'2026-09-09T00:00:00Z',to:'2026-09-09T23:59:59Z'});
  assert.equal(r.salesCount,2);
  assert.equal(r.subtotalSalesCents,3000);
  assert.equal(r.salesDiscountCents,100);
  assert.equal(r.grossSalesCents,2900);
  assert.equal(r.returnedCents,1000);
  assert.equal(r.netSalesCents,1900);
  assert.equal(r.averageTicketCents,1450);
  assert.deepEqual(r.paymentsByMethod,{CASH:2000,PIX:900});
  const cash=r.paymentMethods.find(row=>row.method==='CASH');
  assert.equal(cash.grossCents,2000);assert.equal(cash.refundCents,1000);assert.equal(cash.netCents,1000);
  const customer=r.customerSales.find(row=>row.customerId==='cli1');
  assert.equal(customer.customerName,'Maria Cliente');assert.equal(customer.grossCents,2000);assert.equal(customer.returnedCents,1000);assert.equal(customer.netCents,1000);
  assert.equal(r.customerSales.find(row=>row.customerId===null).netCents,900);
  const product=r.productSales.find(row=>row.productId==='p1');
  assert.equal(product.quantity,3);assert.equal(product.returnedQuantity,1);assert.equal(product.netQuantity,2);
  assert.equal(product.lineGrossCents,3000);assert.equal(product.discountCents,100);assert.equal(product.grossCents,2900);assert.equal(product.returnedCents,1000);assert.equal(product.netCents,1900);assert.equal(product.estimatedMarginCents,700);
  assert.equal(r.productSales.reduce((sum,row)=>sum+row.grossCents,0),r.grossSalesCents);
  assert.equal(r.topProducts[0].productId,'p1');assert.equal(r.topProducts[0].quantity,3);assert.equal(r.topProducts[0].grossCents,3000);assert.equal(r.topProducts[0].realizedCents,2900);
  assert.equal(r.estimatedCostCents,1200);assert.equal(r.estimatedMarginCents,700);
  assert.equal(r.operators[0].operatorName,'Ana');assert.equal(r.operators[0].salesCents,2900);
  db.close();
});

test('return-only period retains seller identity',()=>{
  const {db,reports}=fixture();
  const r=reports.buildSalesSummary({from:'2026-09-09T11:59:59Z',to:'2026-09-09T12:00:01Z'});
  assert.equal(r.salesCount,0);assert.equal(r.returnedCents,1000);
  assert.equal(r.sellers.length,1);assert.equal(r.sellers[0].sellerId,'u1');assert.equal(r.sellers[0].sellerName,'Ana');assert.equal(r.sellers[0].salesCents,-1000);
  db.close();
});

test('payment-method refunds honor the selected seller scope',()=>{
  const {db,reports}=fixture();
  db.prepare(`INSERT INTO sales (id,sale_number,terminal_id,operator_id,status,subtotal_cents,discount_cents,total_cents,change_cents,opened_at,completed_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('s3','V-003','T1','u2','COMPLETED',500,0,500,0,'2026-09-09T13:00:00Z','2026-09-09T13:05:00Z','2026-09-09T13:05:00Z');
  db.prepare(`INSERT INTO sale_items (id,sale_id,product_id,product_name,sku,quantity,unit_price_cents,total_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('i3','s3','p2','Leite','SKU2',1,500,500,'2026-09-09T13:05:00Z','2026-09-09T13:05:00Z');
  db.prepare("INSERT INTO payments (id,sale_id,method,amount_cents,created_at) VALUES (?,?,?,?,?)").run('pa3','s3','CASH',500,'2026-09-09T13:05:00Z');
  db.prepare(`INSERT INTO return_transactions (id,sale_id,terminal_id,operator_id,status,total_cents,reason,created_at) VALUES (?,?,?,?,?,?,?,?)`).run('r2','s3','T1','u2','COMPLETED',500,'Troca','2026-09-09T14:00:00Z');
  db.prepare(`INSERT INTO return_items (id,return_id,sale_item_id,product_id,product_name,quantity,unit_price_cents,total_cents,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run('ri2','r2','i3','p2','Leite',1,500,500,'2026-09-09T14:00:00Z');
  db.prepare(`INSERT INTO cash_movements (id,cash_session_id,type,amount_cents,payment_method,sale_id,note,created_at) VALUES (?,?,?,?,?,?,?,?)`).run('cm7','cs1','REVERSAL',500,'CASH',null,'RETURN:r2:COMPLETED','2026-09-09T14:00:00Z');
  const filtered=reports.buildSalesSummary({from:'2026-09-09T00:00:00Z',to:'2026-09-09T23:59:59Z',sellerId:'u1'});
  const cash=filtered.paymentMethods.find(row=>row.method==='CASH');
  assert.equal(filtered.salesCount,2);assert.equal(filtered.returnedCents,1000);assert.equal(cash.refundCents,1000);assert.equal(cash.netCents,1000);
  db.close();
});

test('inventory report exposes an actionable minimum-stock purchase list',()=>{
  const {db,reports}=fixture();const inventory=reports.buildInventorySummary();
  assert.equal(inventory.skuCount,2);assert.equal(inventory.lowStockCount,1);assert.equal(inventory.belowMinimumCount,1);assert.equal(inventory.zeroStockCount,0);
  assert.equal(inventory.purchaseList[0].productId,'p2');assert.equal(inventory.purchaseList[0].quantity,1);assert.equal(inventory.purchaseList[0].minimumStock,2);assert.equal(inventory.purchaseList[0].shortageToMinimum,1);assert.equal(inventory.suggestedPurchaseCostCents,400);
  db.close();
});

test('cash report separates physical cash from electronic payments and exposes exits',()=>{
  const {db,reports}=fixture();const cash=reports.buildCashSummary({from:'2026-09-09T00:00:00Z',to:'2026-09-09T23:59:59Z'});
  assert.equal(cash.closedSessions,1);assert.equal(cash.divergenceCents,-100);assert.equal(cash.divergentSessions,1);
  assert.equal(cash.openingCashCents,500);assert.equal(cash.suppliesCents,300);assert.equal(cash.cashSalesCents,2000);assert.equal(cash.withdrawalsCents,400);assert.equal(cash.cashReturnCents,1000);
  assert.equal(cash.operatingCashInCents,2300);assert.equal(cash.cashOutCents,1400);assert.equal(cash.operatingNetCashFlowCents,900);assert.equal(cash.expectedCashFromMovementsCents,1400);
  assert.equal(cash.movements.find(row=>row.id==='cm3').signedCents,0);
  db.close();
});

test('finance summary and sales CSV preserve existing report contracts',()=>{
  const {db,reports}=fixture();
  const finance=reports.buildFinanceSummary({asOf:'2026-09-10T12:00:00Z'});assert.equal(finance.payableOpenCents,5000);assert.equal(finance.overduePayableCents,5000);
  const csv=reports.exportSalesCsv({from:'2026-09-09T00:00:00Z',to:'2026-09-09T23:59:59Z'});assert.match(csv,/venda;data;operador;status;total_centavos/);assert.match(csv,/V-001/);assert.equal(csv.includes('[object Object]'),false);
  db.close();
});

test('report period rejects inverted ranges',()=>{
  const {db,reports}=fixture();assert.throws(()=>reports.buildSalesSummary({from:'2026-09-10',to:'2026-09-09'}),/Data inicial/);db.close();
});


test('sales report exposes manager decision metrics without parallel aggregates',()=>{
  const {db,reports}=fixture();
  const r=reports.buildSalesSummary({from:'2026-09-09T00:00:00Z',to:'2026-09-09T23:59:59Z'});
  assert.equal(r.uniqueCustomersCount,1);
  assert.equal(r.firstTimeCustomersCount,1);
  assert.equal(r.returningCustomersCount,0);
  assert.equal(r.customersWithoutSalesCount,0);
  assert.equal(r.categorySales.length,1);
  assert.equal(r.categorySales[0].categoryName,'Geral');
  assert.equal(r.categorySales[0].netCents,1900);
  assert.equal(r.categorySales[0].estimatedMarginCents,700);
  assert.equal(r.lowMarginProducts[0].productId,'p1');
  assert.equal(r.lowMarginProducts[0].estimatedMarginCents,700);
  assert.equal(r.salesTimeline.length,3);
  assert.equal(r.salesTimeline.reduce((sum,row)=>sum+row.netCents,0),1900);
  db.close();
});
