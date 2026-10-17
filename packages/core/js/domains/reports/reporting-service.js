'use strict';

function parseDate(value, fallback) {
  if (value == null || value === '') return fallback;
  const time = Date.parse(String(value));
  if (!Number.isFinite(time)) throw new Error('Periodo de relatorio invalido.');
  return new Date(time).toISOString();
}

function csvCell(value) {
  const text = String(value == null ? '' : value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function roundQty(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function marginPercentValue(row) {
  const revenue = Number(row?.netCents || 0);
  return revenue ? (Number(row?.estimatedMarginCents || 0) / revenue) * 100 : 0;
}

function categorySalesFromProducts(rows = []) {
  const categories = new Map();
  for (const row of rows) {
    const key = row.categoryId || '__UNCATEGORIZED__';
    const current = categories.get(key) || {
      categoryId:row.categoryId || null,
      categoryName:row.categoryName || 'Sem categoria',
      netQuantity:0,
      grossCents:0,
      discountCents:0,
      returnedCents:0,
      netCents:0,
      estimatedCostCents:0,
      estimatedMarginCents:0,
      marginPercent:0
    };
    current.netQuantity = roundQty(current.netQuantity + Number(row.netQuantity || 0));
    current.grossCents += Number(row.grossCents || 0);
    current.discountCents += Number(row.discountCents || 0);
    current.returnedCents += Number(row.returnedCents || 0);
    current.netCents += Number(row.netCents || 0);
    current.estimatedCostCents += Number(row.estimatedCostCents || 0);
    current.estimatedMarginCents += Number(row.estimatedMarginCents || 0);
    categories.set(key,current);
  }
  for (const row of categories.values()) row.marginPercent = Number(marginPercentValue(row).toFixed(2));
  return [...categories.values()].sort((a,b) => b.netCents-a.netCents || a.categoryName.localeCompare(b.categoryName));
}

function lowMarginProductsFromProducts(rows = []) {
  return rows.filter(row => Number(row.netCents || 0) > 0)
    .map(row => ({ ...row,marginPercent:Number(marginPercentValue(row).toFixed(2)) }))
    .sort((a,b) => a.marginPercent-b.marginPercent || a.estimatedMarginCents-b.estimatedMarginCents || a.productName.localeCompare(b.productName));
}

function createReportingService({ db, now = () => new Date().toISOString() } = {}) {
  if (!db) throw new TypeError('Database is required.');
  const saleColumns = new Set(db.prepare('PRAGMA table_info(sales)').all().map(row => row.name));
  const hasSellerId = saleColumns.has('seller_id');
  const hasSellerSnapshot = saleColumns.has('seller_name_snapshot');

  function period(filters = {}, dateColumn = 's.completed_at') {
    const from = parseDate(filters.from, '1970-01-01T00:00:00.000Z');
    const to = parseDate(filters.to, '9999-12-31T23:59:59.999Z');
    if (Date.parse(from) > Date.parse(to)) throw new Error('Data inicial do relatorio deve ser anterior ou igual a data final.');
    return { from, to, clause: `${dateColumn}>=? AND ${dateColumn}<=?` };
  }

  function sellerExpressions(alias = 's') {
    return {
      id: hasSellerId ? `COALESCE(${alias}.seller_id,${alias}.operator_id)` : `${alias}.operator_id`,
      name: hasSellerSnapshot ? `COALESCE(${alias}.seller_name_snapshot,su.name,u.name)` : 'u.name',
      join: hasSellerId ? `LEFT JOIN users su ON su.id=${alias}.seller_id` : ''
    };
  }

  function completedSales(filters = {}) {
    const p = period(filters);
    const seller = sellerExpressions('s');
    const sellerClause = filters.sellerId ? ` AND ${seller.id}=?` : '';
    const params = filters.sellerId ? [p.from,p.to,String(filters.sellerId)] : [p.from,p.to];
    return db.prepare(`SELECT s.*,u.name AS operator_name,${seller.id} AS resolved_seller_id,${seller.name} AS seller_name,c.name AS customer_name
      FROM sales s
      LEFT JOIN users u ON u.id=s.operator_id
      ${seller.join}
      LEFT JOIN customers c ON c.id=s.customer_id
      WHERE s.status='COMPLETED' AND ${p.clause}${sellerClause}
      ORDER BY s.completed_at,s.id`).all(...params);
  }

  function completedReturns(filters = {}) {
    const p = period(filters, 'rt.created_at');
    const seller = sellerExpressions('s');
    const sellerClause = filters.sellerId ? ` AND ${seller.id}=?` : '';
    const params = filters.sellerId ? [p.from,p.to,String(filters.sellerId)] : [p.from,p.to];
    return db.prepare(`SELECT rt.*,${seller.id} AS resolved_seller_id,${seller.name} AS seller_name,s.customer_id,c.name AS customer_name
      FROM return_transactions rt
      JOIN sales s ON s.id=rt.sale_id
      LEFT JOIN users u ON u.id=s.operator_id
      ${seller.join}
      LEFT JOIN customers c ON c.id=s.customer_id
      WHERE rt.status='COMPLETED' AND ${p.clause}${sellerClause}
      ORDER BY rt.created_at,rt.id`).all(...params);
  }

  function cancelledSales(filters = {}) {
    const p = period(filters, 's.cancelled_at');
    const seller = sellerExpressions('s');
    const sellerClause = filters.sellerId ? ` AND ${seller.id}=?` : '';
    const params = filters.sellerId ? [p.from,p.to,String(filters.sellerId)] : [p.from,p.to];
    return db.prepare(`SELECT s.*,u.name AS operator_name,c.name AS customer_name,${seller.id} AS resolved_seller_id,${seller.name} AS seller_name
      FROM sales s
      LEFT JOIN users u ON u.id=s.operator_id
      ${seller.join}
      LEFT JOIN customers c ON c.id=s.customer_id
      WHERE s.status='CANCELLED' AND s.cancelled_at>=? AND s.cancelled_at<=?
      AND EXISTS(SELECT 1 FROM domain_events de WHERE de.aggregate_id=s.id AND de.type='sale.cancelled')${sellerClause}
      ORDER BY s.cancelled_at,s.id`).all(...params);
  }

  function returnRefundsByMethod(returns = []) {
    const map = new Map();
    const query = db.prepare(`SELECT COALESCE(payment_method,'OTHER') AS method,amount_cents AS amountCents
      FROM cash_movements WHERE type='REVERSAL' AND note=? ORDER BY created_at,id`);
    for (const ret of returns) {
      for (const row of query.all(`RETURN:${ret.id}:COMPLETED`)) {
        const current = map.get(row.method) || { amountCents:0, transactionCount:0 };
        current.amountCents += Number(row.amountCents || 0);
        current.transactionCount += 1;
        map.set(row.method,current);
      }
    }
    return map;
  }

  function allocateSaleDiscount(items, discountCents) {
    const total = items.reduce((sum,item) => sum + Number(item.totalCents || 0),0);
    let remainingDiscount = Math.max(Number(discountCents || 0),0);
    let remainingBase = total;
    return items.map((item,index) => {
      const base = Number(item.totalCents || 0);
      let allocated = 0;
      if (remainingDiscount > 0 && remainingBase > 0) {
        allocated = index === items.length - 1 ? remainingDiscount : Math.round((remainingDiscount * base) / remainingBase);
        allocated = Math.min(Math.max(allocated,0),base,remainingDiscount);
      }
      remainingDiscount -= allocated;
      remainingBase -= base;
      return { ...item, allocatedDiscountCents:allocated, realizedCents:base-allocated };
    });
  }

  function emptyProduct(item) {
    return {
      productId:item.productId,
      productName:item.productName,
      sku:item.sku || null,
      categoryId:item.categoryId || null,
      categoryName:item.categoryName || 'Sem categoria',
      quantity:0,
      returnedQuantity:0,
      netQuantity:0,
      lineGrossCents:0,
      discountCents:0,
      grossCents:0,
      returnedCents:0,
      netCents:0,
      estimatedCostCents:0,
      estimatedMarginCents:0
    };
  }

  function buildSalesSummary(filters = {}) {
    const sales = completedSales(filters);
    const saleIds = new Set(sales.map(sale => sale.id));
    const subtotalSalesCents = sales.reduce((sum,sale) => sum + Number(sale.subtotal_cents || 0),0);
    const salesDiscountCents = sales.reduce((sum,sale) => sum + Number(sale.discount_cents || 0),0);
    const grossSalesCents = sales.reduce((sum,sale) => sum + Number(sale.total_cents || 0),0);
    const returns = completedReturns(filters);
    const cancellations = cancelledSales(filters);
    const returnedCents = returns.reduce((sum,row) => sum + Number(row.total_cents || 0),0);
    const netSalesCents = grossSalesCents - returnedCents;
    const averageTicketCents = sales.length ? Math.round(grossSalesCents / sales.length) : 0;
    const salesTimeline = [
      ...sales.map(sale => ({ at:sale.completed_at,kind:'SALE',netCents:Number(sale.total_cents || 0) })),
      ...returns.map(ret => ({ at:ret.created_at,kind:'RETURN',netCents:-Number(ret.total_cents || 0) }))
    ].filter(row => row.at).sort((a,b) => String(a.at).localeCompare(String(b.at)) || a.kind.localeCompare(b.kind));

    const paymentsByMethod = {};
    const paymentMethods = new Map();
    const products = new Map();
    const operators = new Map();
    const sellers = new Map();
    const customers = new Map();
    let costCents = 0;

    for (const sale of sales) {
      const payments = db.prepare('SELECT method,amount_cents FROM payments WHERE sale_id=? ORDER BY created_at,id').all(sale.id);
      const methodsSeen = new Set();
      for (const payment of payments) {
        const method = String(payment.method || 'OTHER');
        const amount = Number(payment.amount_cents || 0);
        paymentsByMethod[method] = (paymentsByMethod[method] || 0) + amount;
        const current = paymentMethods.get(method) || { method,salesCount:0,transactionCount:0,grossCents:0,refundCents:0,refundTransactionCount:0,netCents:0 };
        current.transactionCount += 1;
        current.grossCents += amount;
        paymentMethods.set(method,current);
        methodsSeen.add(method);
      }
      for (const method of methodsSeen) paymentMethods.get(method).salesCount += 1;

      const rawItems = db.prepare(`SELECT si.product_id AS productId,si.product_name AS productName,si.sku,si.quantity,si.total_cents AS totalCents,
          p.cost_cents AS costCents,p.category_id AS categoryId,c.name AS categoryName
        FROM sale_items si
        LEFT JOIN products p ON p.id=si.product_id
        LEFT JOIN categories c ON c.id=p.category_id
        WHERE si.sale_id=? ORDER BY si.created_at,si.id`).all(sale.id);
      const items = allocateSaleDiscount(rawItems,Number(sale.discount_cents || 0));
      for (const item of items) {
        const current = products.get(item.productId) || emptyProduct(item);
        const itemQty = Number(item.quantity || 0);
        const itemCost = Math.round(Number(item.costCents || 0) * itemQty);
        current.quantity = roundQty(current.quantity + itemQty);
        current.lineGrossCents += Number(item.totalCents || 0);
        current.discountCents += Number(item.allocatedDiscountCents || 0);
        current.grossCents += Number(item.realizedCents || 0);
        current.estimatedCostCents += itemCost;
        products.set(item.productId,current);
        costCents += itemCost;
      }

      const operator = operators.get(sale.operator_id) || { operatorId:sale.operator_id,operatorName:sale.operator_name || 'Nao identificado',salesCount:0,salesCents:0 };
      operator.salesCount += 1;
      operator.salesCents += Number(sale.total_cents || 0);
      operators.set(sale.operator_id,operator);

      const sellerId = sale.resolved_seller_id || sale.operator_id;
      const seller = sellers.get(sellerId) || { sellerId,sellerName:sale.seller_name || sale.operator_name || 'Nao identificado',salesCount:0,salesCents:0,returnedCents:0,cancelledSalesCount:0,cancelledSalesCents:0 };
      seller.salesCount += 1;
      seller.salesCents += Number(sale.total_cents || 0);
      sellers.set(sellerId,seller);

      const customerKey = sale.customer_id || '__WALK_IN__';
      const customer = customers.get(customerKey) || { customerId:sale.customer_id || null,customerName:sale.customer_name || 'Consumidor nao identificado',salesCount:0,grossCents:0,returnedCents:0,netCents:0,averageTicketCents:0,cancelledSalesCount:0,cancelledSalesCents:0,lastSaleAt:null };
      customer.salesCount += 1;
      customer.grossCents += Number(sale.total_cents || 0);
      if (!customer.lastSaleAt || String(sale.completed_at) > customer.lastSaleAt) customer.lastSaleAt = sale.completed_at;
      customers.set(customerKey,customer);
    }

    for (const ret of returns) {
      const seller = sellers.get(ret.resolved_seller_id) || { sellerId:ret.resolved_seller_id,sellerName:ret.seller_name || 'Nao identificado',salesCount:0,salesCents:0,returnedCents:0,cancelledSalesCount:0,cancelledSalesCents:0 };
      seller.returnedCents += Number(ret.total_cents || 0);
      seller.salesCents -= Number(ret.total_cents || 0);
      sellers.set(ret.resolved_seller_id,seller);

      const customerKey = ret.customer_id || '__WALK_IN__';
      const customer = customers.get(customerKey) || { customerId:ret.customer_id || null,customerName:ret.customer_name || 'Consumidor nao identificado',salesCount:0,grossCents:0,returnedCents:0,netCents:0,averageTicketCents:0,cancelledSalesCount:0,cancelledSalesCents:0,lastSaleAt:null };
      customer.returnedCents += Number(ret.total_cents || 0);
      customers.set(customerKey,customer);
    }

    for (const cancelled of cancellations) {
      const sellerId = cancelled.resolved_seller_id;
      const seller = sellers.get(sellerId) || { sellerId,sellerName:cancelled.seller_name || 'Nao identificado',salesCount:0,salesCents:0,returnedCents:0,cancelledSalesCount:0,cancelledSalesCents:0 };
      seller.cancelledSalesCount += 1;
      seller.cancelledSalesCents += Number(cancelled.total_cents || 0);
      sellers.set(sellerId,seller);

      const customerKey = cancelled.customer_id || '__WALK_IN__';
      const customer = customers.get(customerKey) || { customerId:cancelled.customer_id || null,customerName:cancelled.customer_name || 'Consumidor nao identificado',salesCount:0,grossCents:0,returnedCents:0,netCents:0,averageTicketCents:0,cancelledSalesCount:0,cancelledSalesCents:0,lastSaleAt:null };
      customer.cancelledSalesCount += 1;
      customer.cancelledSalesCents += Number(cancelled.total_cents || 0);
      customers.set(customerKey,customer);
    }

    let returnedCostCents = 0;
    for (const ret of returns) {
      const items = db.prepare(`SELECT ri.product_id AS productId,ri.product_name AS productName,ri.quantity,ri.total_cents AS totalCents,
          p.sku,p.cost_cents AS costCents,p.category_id AS categoryId,c.name AS categoryName
        FROM return_items ri
        LEFT JOIN products p ON p.id=ri.product_id
        LEFT JOIN categories c ON c.id=p.category_id
        WHERE ri.return_id=? ORDER BY ri.created_at,ri.id`).all(ret.id);
      for (const item of items) {
        const itemQty = Number(item.quantity || 0);
        const itemCost = Math.round(Number(item.costCents || 0) * itemQty);
        returnedCostCents += itemCost;
        const current = products.get(item.productId) || emptyProduct(item);
        current.returnedQuantity = roundQty(current.returnedQuantity + itemQty);
        current.returnedCents += Number(item.totalCents || 0);
        current.estimatedCostCents -= itemCost;
        products.set(item.productId,current);
      }
    }

    for (const item of products.values()) {
      item.netQuantity = roundQty(item.quantity-item.returnedQuantity);
      item.netCents = item.grossCents-item.returnedCents;
      item.estimatedMarginCents = item.netCents-item.estimatedCostCents;
    }
    for (const customer of customers.values()) {
      customer.netCents = customer.grossCents-customer.returnedCents;
      customer.averageTicketCents = customer.salesCount ? Math.round(customer.grossCents/customer.salesCount) : 0;
    }

    const refundMap = returnRefundsByMethod(returns);
    for (const [method,refund] of refundMap) {
      const current = paymentMethods.get(method) || { method,salesCount:0,transactionCount:0,grossCents:0,refundCents:0,refundTransactionCount:0,netCents:0 };
      current.refundCents += refund.amountCents;
      current.refundTransactionCount += refund.transactionCount;
      paymentMethods.set(method,current);
    }
    for (const current of paymentMethods.values()) current.netCents = current.grossCents-current.refundCents;
    const netPaymentsByMethod = {};
    for (const current of paymentMethods.values()) netPaymentsByMethod[current.method] = current.netCents;

    const productSales = [...products.values()].sort((a,b) => b.netCents-a.netCents || b.netQuantity-a.netQuantity || a.productName.localeCompare(b.productName));
    const topProducts = [...products.values()].sort((a,b) => b.quantity-a.quantity || b.lineGrossCents-a.lineGrossCents || a.productName.localeCompare(b.productName)).map(item => ({
      productId:item.productId,
      productName:item.productName,
      quantity:item.quantity,
      grossCents:item.lineGrossCents,
      realizedCents:item.grossCents,
      discountCents:item.discountCents,
      returnedQuantity:item.returnedQuantity,
      returnedCents:item.returnedCents,
      netQuantity:item.netQuantity,
      netCents:item.netCents
    }));
    const customerSales = [...customers.values()].sort((a,b) => b.netCents-a.netCents || b.salesCount-a.salesCount || a.customerName.localeCompare(b.customerName));
    const paymentMethodSales = [...paymentMethods.values()].sort((a,b) => b.netCents-a.netCents || a.method.localeCompare(b.method));
    const categorySales = categorySalesFromProducts(productSales);
    const lowMarginProducts = lowMarginProductsFromProducts(productSales);
    const namedCustomerIds = [...new Set(sales.map(sale => sale.customer_id).filter(Boolean).map(String))];
    let firstTimeCustomersCount = 0;
    let returningCustomersCount = 0;
    if (namedCustomerIds.length) {
      const firstSale = db.prepare("SELECT MIN(completed_at) AS firstSaleAt FROM sales WHERE status='COMPLETED' AND customer_id=?");
      const reportFrom = period(filters).from;
      for (const customerId of namedCustomerIds) {
        const firstSaleAt = firstSale.get(customerId)?.firstSaleAt || null;
        if (firstSaleAt && String(firstSaleAt) >= reportFrom) firstTimeCustomersCount += 1;
        else returningCustomersCount += 1;
      }
    }
    const activeCustomerIds = db.prepare('SELECT id FROM customers WHERE active=1 ORDER BY id').all().map(row => String(row.id));
    const currentCustomerSet = new Set(namedCustomerIds);
    const customersWithoutSalesCount = activeCustomerIds.filter(id => !currentCustomerSet.has(id)).length;

    return {
      from:filters.from || null,
      to:filters.to || null,
      salesCount:sales.length,
      subtotalSalesCents,
      salesDiscountCents,
      grossSalesCents,
      returnedCents,
      cancelledSalesCount:cancellations.length,
      cancelledSalesCents:cancellations.reduce((sum,row) => sum+Number(row.total_cents || 0),0),
      netSalesCents,
      averageTicketCents,
      salesTimeline,
      paymentsByMethod,
      netPaymentsByMethod,
      paymentMethods:paymentMethodSales,
      customerSales,
      uniqueCustomersCount:namedCustomerIds.length,
      firstTimeCustomersCount,
      returningCustomersCount,
      customersWithoutSalesCount,
      productSales,
      categorySales,
      topProducts,
      lowMarginProducts,
      estimatedCostCents:costCents-returnedCostCents,
      estimatedMarginCents:netSalesCents-(costCents-returnedCostCents),
      operators:[...operators.values()].sort((a,b) => b.salesCents-a.salesCents || a.operatorName.localeCompare(b.operatorName)),
      sellers:[...sellers.values()].sort((a,b) => b.salesCents-a.salesCents || a.sellerName.localeCompare(b.sellerName)),
      saleIds:[...saleIds]
    };
  }

  function buildInventorySummary() {
    const items = db.prepare(`SELECT p.id AS productId,p.sku,p.name,p.unit,p.cost_cents AS costCents,p.sale_price_cents AS salePriceCents,
      p.minimum_stock AS minimumStock,COALESCE(b.quantity,0) AS quantity
      FROM products p LEFT JOIN inventory_balances b ON b.product_id=p.id
      WHERE p.active=1 AND p.track_stock=1 ORDER BY p.name,p.id`).all().map(row => {
        const quantity = roundQty(row.quantity);
        const minimumStock = roundQty(row.minimumStock);
        const shortageToMinimum = roundQty(Math.max(minimumStock-quantity,0));
        return {
          ...row,quantity,minimumStock,
          lowStock:quantity<=minimumStock,
          belowMinimum:quantity<minimumStock,
          zeroStock:quantity<=0,
          shortageToMinimum,
          suggestedPurchaseCostCents:Math.round(Number(row.costCents || 0)*shortageToMinimum),
          costValueCents:Math.round(Number(row.costCents || 0)*quantity),
          saleValueCents:Math.round(Number(row.salePriceCents || 0)*quantity)
        };
      });
    const purchaseList = items.filter(item => item.lowStock).sort((a,b) => Number(b.zeroStock)-Number(a.zeroStock) || b.shortageToMinimum-a.shortageToMinimum || a.name.localeCompare(b.name));
    return {
      skuCount:items.length,
      lowStockCount:purchaseList.length,
      belowMinimumCount:items.filter(item => item.belowMinimum).length,
      zeroStockCount:items.filter(item => item.zeroStock).length,
      quantityTotal:roundQty(items.reduce((sum,item) => sum+item.quantity,0)),
      costValueCents:items.reduce((sum,item) => sum+item.costValueCents,0),
      saleValueCents:items.reduce((sum,item) => sum+item.saleValueCents,0),
      suggestedPurchaseCostCents:purchaseList.reduce((sum,item) => sum+item.suggestedPurchaseCostCents,0),
      purchaseList,
      items
    };
  }

  function buildCashSummary(filters = {}) {
    const p = period(filters,'cm.created_at');
    const rows = db.prepare(`SELECT id,terminal_id AS terminalId,operator_id AS operatorId,expected_cash_cents AS expectedCashCents,
      counted_cash_cents AS countedCashCents,divergence_cents AS divergenceCents,opened_at AS openedAt,closed_at AS closedAt
      FROM cash_sessions WHERE status='CLOSED' AND closed_at>=? AND closed_at<=? ORDER BY closed_at,id`).all(p.from,p.to);
    const movements = db.prepare(`SELECT cm.id,cm.cash_session_id AS cashSessionId,cs.terminal_id AS terminalId,cs.operator_id AS operatorId,u.name AS operatorName,
      cm.type,cm.amount_cents AS amountCents,COALESCE(cm.payment_method,'CASH') AS paymentMethod,cm.sale_id AS saleId,cm.note,cm.created_at AS createdAt
      FROM cash_movements cm JOIN cash_sessions cs ON cs.id=cm.cash_session_id LEFT JOIN users u ON u.id=cs.operator_id
      WHERE ${p.clause} ORDER BY cm.created_at,cm.id`).all(p.from,p.to).map(row => {
        const isPhysicalCash = ['OPENING','SUPPLY','WITHDRAWAL'].includes(row.type) || row.paymentMethod === 'CASH';
        const direction = ['WITHDRAWAL','REVERSAL'].includes(row.type) ? -1 : 1;
        return { ...row,isPhysicalCash,signedCents:isPhysicalCash ? direction*Number(row.amountCents || 0) : 0 };
      });
    const physical = movements.filter(row => row.isPhysicalCash);
    const sumType = (type,predicate = () => true) => physical.filter(row => row.type === type && predicate(row)).reduce((sum,row) => sum+Number(row.amountCents || 0),0);
    const openingCashCents = sumType('OPENING');
    const suppliesCents = sumType('SUPPLY');
    const withdrawalsCents = sumType('WITHDRAWAL');
    const cashSalesCents = sumType('SALE',row => row.paymentMethod === 'CASH');
    const cashReversalCents = sumType('REVERSAL',row => row.paymentMethod === 'CASH');
    const cashReturnCents = sumType('REVERSAL',row => row.paymentMethod === 'CASH' && /^RETURN:[^:]+:COMPLETED$/.test(String(row.note || '')));
    const cashCancellationCents = Math.max(cashReversalCents-cashReturnCents,0);
    const operatingCashInCents = suppliesCents+cashSalesCents;
    const cashOutCents = withdrawalsCents+cashReversalCents;
    const operatingNetCashFlowCents = operatingCashInCents-cashOutCents;
    const cashInCents = openingCashCents+operatingCashInCents;
    const expectedCashFromMovementsCents = openingCashCents+operatingNetCashFlowCents;
    const movementTotals = {};
    for (const row of movements) {
      const key = `${row.type}:${row.paymentMethod}`;
      movementTotals[key] = (movementTotals[key] || 0)+Number(row.amountCents || 0);
    }
    return {
      closedSessions:rows.length,
      expectedCashCents:rows.reduce((sum,row) => sum+Number(row.expectedCashCents || 0),0),
      countedCashCents:rows.reduce((sum,row) => sum+Number(row.countedCashCents || 0),0),
      divergenceCents:rows.reduce((sum,row) => sum+Number(row.divergenceCents || 0),0),
      divergentSessions:rows.filter(row => Number(row.divergenceCents || 0) !== 0).length,
      openingCashCents,
      suppliesCents,
      withdrawalsCents,
      cashSalesCents,
      cashReversalCents,
      cashReturnCents,
      cashCancellationCents,
      operatingCashInCents,
      cashOutCents,
      operatingNetCashFlowCents,
      cashInCents,
      netCashFlowCents:expectedCashFromMovementsCents,
      expectedCashFromMovementsCents,
      movementTotals,
      movements,
      sessions:rows
    };
  }

  function buildFinanceSummary({ from = null, to = null, asOf = now() } = {}) {
    const clauses = ["fe.status<>'CANCELLED'"];
    const params = [];
    if (from) { clauses.push('fe.due_at>=?'); params.push(String(from)); }
    if (to) { clauses.push('fe.due_at<=?'); params.push(String(to)); }
    const rows = db.prepare(`SELECT fe.*,
      COALESCE((SELECT SUM(fs.amount_cents) FROM financial_settlements fs WHERE fs.entry_id=fe.id AND fs.reversed_at IS NULL),0) AS settled_cents
      FROM financial_entries fe WHERE ${clauses.join(' AND ')} ORDER BY fe.due_at,fe.id`).all(...params);
    const result = { payableTotalCents:0,payableSettledCents:0,payableOpenCents:0,receivableTotalCents:0,receivableSettledCents:0,receivableOpenCents:0,overduePayableCents:0,overdueReceivableCents:0 };
    const asOfMs = Date.parse(String(asOf));
    for (const row of rows) {
      const amount = Number(row.amount_cents || 0);
      const settled = Number(row.settled_cents || 0);
      const open = Math.max(amount-settled,0);
      const prefix = row.kind === 'PAYABLE' ? 'payable' : 'receivable';
      result[`${prefix}TotalCents`] += amount;
      result[`${prefix}SettledCents`] += settled;
      result[`${prefix}OpenCents`] += open;
      if (open > 0 && Date.parse(row.due_at) < asOfMs) result[row.kind === 'PAYABLE' ? 'overduePayableCents' : 'overdueReceivableCents'] += open;
    }
    return result;
  }

  function buildSalesDetails(filters = {}) {
    const saleIds = Array.isArray(filters.saleIds)
      ? new Set(filters.saleIds.map(String))
      : new Set(String(filters.saleIds || '').split(',').map(value=>value.trim()).filter(Boolean));
    let rows = completedSales(filters);
    if (saleIds.size) rows = rows.filter(row=>saleIds.has(String(row.id)));
    if (filters.customerId) {
      const customerId=String(filters.customerId);
      rows=rows.filter(row=>customerId==='__WALK_IN__'?!row.customer_id:String(row.customer_id||'')===customerId);
    }
    if (filters.productId) {
      const productId=String(filters.productId);
      const hasProduct=db.prepare('SELECT 1 FROM sale_items WHERE sale_id=? AND product_id=? LIMIT 1');
      rows=rows.filter(row=>Boolean(hasProduct.get(row.id,productId)));
    }
    if (filters.paymentMethod) {
      const method=String(filters.paymentMethod).toUpperCase();
      const hasPayment=db.prepare('SELECT 1 FROM payments WHERE sale_id=? AND method=? LIMIT 1');
      rows=rows.filter(row=>Boolean(hasPayment.get(row.id,method)));
    }
    const itemQuery=db.prepare(`SELECT id,product_id AS productId,product_name AS productName,sku,quantity,unit_price_cents AS unitPriceCents,total_cents AS totalCents
      FROM sale_items WHERE sale_id=? ORDER BY created_at,id`);
    const paymentQuery=db.prepare('SELECT id,method,amount_cents AS amountCents,created_at AS createdAt FROM payments WHERE sale_id=? ORDER BY created_at,id');
    return rows.map(row=>({
      saleId:row.id,
      saleNumber:row.sale_number,
      completedAt:row.completed_at,
      customerId:row.customer_id||null,
      customerName:row.customer_name||'Consumidor não identificado',
      sellerId:row.resolved_seller_id||row.operator_id||null,
      sellerName:row.seller_name||row.operator_name||'Não identificado',
      operatorId:row.operator_id||null,
      operatorName:row.operator_name||'Não identificado',
      totalCents:Number(row.total_cents||0),
      subtotalCents:Number(row.subtotal_cents||0),
      discountCents:Number(row.discount_cents||0),
      items:itemQuery.all(row.id).map(item=>({...item,quantity:roundQty(item.quantity),unitPriceCents:Number(item.unitPriceCents||0),totalCents:Number(item.totalCents||0)})),
      payments:paymentQuery.all(row.id).map(payment=>({...payment,amountCents:Number(payment.amountCents||0)}))
    }));
  }

  function exportSalesCsv(filters = {}) {
    const rows = [...completedSales(filters),...cancelledSales(filters)].sort((a,b) => String(a.completed_at || a.cancelled_at).localeCompare(String(b.completed_at || b.cancelled_at)) || a.id.localeCompare(b.id));
    const lines = ['venda;data;operador;status;total_centavos;formas_pagamento;cliente;vendedor_garcom;motivo_cancelamento'];
    for (const row of rows) {
      const methods = db.prepare('SELECT method FROM payments WHERE sale_id=? ORDER BY created_at,id').all(row.id).map(payment => payment.method).join('+');
      lines.push([row.sale_number,row.completed_at || row.cancelled_at,row.operator_name || '',row.status,row.total_cents,methods,row.customer_name || '',row.seller_name || '',row.cancel_reason || ''].map(csvCell).join(';'));
    }
    return `${lines.join('\n')}\n`;
  }

  return { buildSalesSummary,buildSalesDetails,buildInventorySummary,buildCashSummary,buildFinanceSummary,exportSalesCsv };
}

module.exports = { createReportingService,csvCell,categorySalesFromProducts,lowMarginProductsFromProducts };
