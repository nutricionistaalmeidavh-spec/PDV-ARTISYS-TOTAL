'use strict';
const { createReportingService: createBaseReportingService,categorySalesFromProducts,lowMarginProductsFromProducts } = require('./reporting-service');

function parseDate(value, fallback) {
  if (value == null || value === '') return fallback;
  const time = Date.parse(String(value));
  if (!Number.isFinite(time)) throw new Error('Periodo de relatorio invalido.');
  return new Date(time).toISOString();
}

function roundQty(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function variantIdSql(column = 'configuration_json') {
  return `COALESCE(
    json_extract(${column},'$.productVariant.id'),
    json_extract(${column},'$.retailVariant.id'),
    json_extract(${column},'$.variant.id'),
    json_extract(${column},'$.variantId')
  )`;
}

function createReportingService({ db, now = () => new Date().toISOString() } = {}) {
  if (!db) throw new TypeError('Database is required.');

  const triggerVariantId = variantIdSql('sale_items.configuration_json');
  db.exec(`DROP TRIGGER IF EXISTS trg_sale_cost_snapshot;
    CREATE TRIGGER trg_sale_cost_snapshot
    AFTER UPDATE OF status ON sales
    WHEN NEW.status='COMPLETED' AND OLD.status<>'COMPLETED'
    BEGIN
      UPDATE sale_items
      SET cost_cents_snapshot=COALESCE(
            CASE WHEN configuration_json IS NOT NULL THEN
              (SELECT pv.cost_cents FROM product_variants pv
               WHERE pv.id=${triggerVariantId})
            END,
            (SELECT p.cost_cents FROM products p WHERE p.id=sale_items.product_id),
            0
          ),
          cost_snapshot_source=CASE
            WHEN configuration_json IS NOT NULL AND EXISTS(
              SELECT 1 FROM product_variants pv
              WHERE pv.id=${triggerVariantId}
            ) THEN 'VARIANT'
            ELSE 'PRODUCT'
          END
      WHERE sale_id=NEW.id AND cost_cents_snapshot IS NULL;
    END`);

  const base = createBaseReportingService({ db, now });
  const saleItemVariantId = variantIdSql('si.configuration_json');

  function markCostBasis(map, productId, snapshotCost) {
    const key = String(productId);
    const current = map.get(key) || { historical:false, estimated:false };
    if (snapshotCost == null) current.estimated = true;
    else current.historical = true;
    map.set(key, current);
  }

  function resolveCostBasis(flags) {
    if (flags?.historical && flags?.estimated) return 'MIXED';
    if (flags?.estimated) return 'ESTIMATED_CURRENT';
    return 'HISTORICAL_SNAPSHOT';
  }

  function buildSalesSummary(filters = {}) {
    const result = base.buildSalesSummary(filters);
    const from = parseDate(filters.from, '1970-01-01T00:00:00.000Z');
    const to = parseDate(filters.to, '9999-12-31T23:59:59.999Z');
    const sold = new Map();
    const returned = new Map();
    const basisByProduct = new Map();

    if (Array.isArray(result.saleIds) && result.saleIds.length) {
      const placeholders = result.saleIds.map(() => '?').join(',');
      const rows = db.prepare(`SELECT si.product_id AS productId,si.quantity,
          si.cost_cents_snapshot AS snapshotCost,COALESCE(pv.cost_cents,p.cost_cents,0) AS currentCost
        FROM sale_items si
        LEFT JOIN products p ON p.id=si.product_id
        LEFT JOIN product_variants pv ON pv.id=${saleItemVariantId}
        WHERE si.sale_id IN (${placeholders})`).all(...result.saleIds);
      for (const row of rows) {
        const productId = String(row.productId);
        const unitCost = row.snapshotCost == null ? Number(row.currentCost || 0) : Number(row.snapshotCost);
        sold.set(productId, (sold.get(productId) || 0) + Math.round(unitCost * Number(row.quantity || 0)));
        markCostBasis(basisByProduct, productId, row.snapshotCost);
      }
    }

    const returnParams = [from, to];
    let sellerClause = '';
    if (filters.sellerId) {
      sellerClause = ' AND COALESCE(s.seller_id,s.operator_id)=?';
      returnParams.push(String(filters.sellerId));
    }
    const returnRows = db.prepare(`SELECT ri.product_id AS productId,ri.quantity,
        si.cost_cents_snapshot AS snapshotCost,COALESCE(pv.cost_cents,p.cost_cents,0) AS currentCost
      FROM return_items ri
      JOIN return_transactions rt ON rt.id=ri.return_id
      JOIN sales s ON s.id=rt.sale_id
      LEFT JOIN sale_items si ON si.id=ri.sale_item_id
      LEFT JOIN products p ON p.id=ri.product_id
      LEFT JOIN product_variants pv ON pv.id=${saleItemVariantId}
      WHERE rt.status='COMPLETED' AND rt.created_at>=? AND rt.created_at<=?${sellerClause}`)
      .all(...returnParams);
    for (const row of returnRows) {
      const productId = String(row.productId);
      const unitCost = row.snapshotCost == null ? Number(row.currentCost || 0) : Number(row.snapshotCost);
      returned.set(productId, (returned.get(productId) || 0) + Math.round(unitCost * Number(row.quantity || 0)));
      markCostBasis(basisByProduct, productId, row.snapshotCost);
    }

    for (const item of result.productSales || []) {
      const productId = String(item.productId);
      item.estimatedCostCents = (sold.get(productId) || 0) - (returned.get(productId) || 0);
      item.estimatedMarginCents = Number(item.netCents || 0) - item.estimatedCostCents;
      item.averageUnitCostCents = Number(item.netQuantity || 0) === 0
        ? 0
        : Math.round(item.estimatedCostCents / Number(item.netQuantity));
      item.costBasis = resolveCostBasis(basisByProduct.get(productId));
    }
    result.estimatedCostCents = (result.productSales || []).reduce((sum, item) => sum + Number(item.estimatedCostCents || 0), 0);
    result.estimatedMarginCents = Number(result.netSalesCents || 0) - result.estimatedCostCents;
    result.categorySales = categorySalesFromProducts(result.productSales || []);
    result.lowMarginProducts = lowMarginProductsFromProducts(result.productSales || []);
    const bases = new Set((result.productSales || []).map(item => item.costBasis));
    result.costBasis = bases.has('MIXED') || bases.size > 1 ? 'MIXED' : (bases.values().next().value || 'HISTORICAL_SNAPSHOT');
    result.hasEstimatedCost = result.costBasis !== 'HISTORICAL_SNAPSHOT';
    return result;
  }

  function buildLocationInventorySummary(location) {
    if (!location) throw new Error('Local de estoque nao encontrado.');
    const items = db.prepare(`SELECT p.id AS productId,p.sku,p.name,p.unit,p.cost_cents AS costCents,p.sale_price_cents AS salePriceCents,
      p.minimum_stock AS minimumStock,COALESCE(b.quantity,0) AS quantity
      FROM products p
      LEFT JOIN inventory_location_balances b ON b.product_id=p.id AND b.location_id=?
      WHERE p.active=1 AND p.track_stock=1 ORDER BY p.name,p.id`).all(location.id).map(row => {
        const quantity = roundQty(row.quantity);
        const minimumStock = roundQty(row.minimumStock);
        const shortageToMinimum = roundQty(Math.max(minimumStock - quantity, 0));
        return {
          ...row,
          locationId:location.id,
          locationName:location.name,
          quantity,
          minimumStock,
          lowStock:quantity <= minimumStock,
          belowMinimum:quantity < minimumStock,
          zeroStock:quantity <= 0,
          shortageToMinimum,
          suggestedPurchaseCostCents:Math.round(Number(row.costCents || 0) * shortageToMinimum),
          costValueCents:Math.round(Number(row.costCents || 0) * quantity),
          saleValueCents:Math.round(Number(row.salePriceCents || 0) * quantity)
        };
      });
    const purchaseList = items.filter(item => item.lowStock)
      .sort((a,b) => Number(b.zeroStock) - Number(a.zeroStock) || b.shortageToMinimum - a.shortageToMinimum || a.name.localeCompare(b.name));
    return {
      locationId:location.id,
      locationName:location.name,
      locationType:location.type,
      skuCount:items.length,
      lowStockCount:purchaseList.length,
      belowMinimumCount:items.filter(item => item.belowMinimum).length,
      zeroStockCount:items.filter(item => item.zeroStock).length,
      quantityTotal:roundQty(items.reduce((sum,item) => sum + item.quantity, 0)),
      costValueCents:items.reduce((sum,item) => sum + item.costValueCents, 0),
      saleValueCents:items.reduce((sum,item) => sum + item.saleValueCents, 0),
      suggestedPurchaseCostCents:purchaseList.reduce((sum,item) => sum + item.suggestedPurchaseCostCents, 0),
      purchaseList,
      items
    };
  }

  function aggregateLocationSummaries(locations, summaries) {
    const items = [];
    const purchaseList = [];
    for (const location of locations) {
      const summary = summaries[location.id];
      items.push(...summary.items);
      purchaseList.push(...summary.purchaseList);
    }
    purchaseList.sort((a,b) => Number(b.zeroStock) - Number(a.zeroStock) || b.shortageToMinimum - a.shortageToMinimum || a.name.localeCompare(b.name));
    return {
      locationId:null,
      locationName:'Todos os locais',
      skuCount:new Set(items.map(item => item.productId)).size,
      stockPositionCount:items.length,
      lowStockCount:purchaseList.length,
      belowMinimumCount:items.filter(item => item.belowMinimum).length,
      zeroStockCount:items.filter(item => item.zeroStock).length,
      quantityTotal:roundQty(items.reduce((sum,item) => sum + item.quantity, 0)),
      costValueCents:items.reduce((sum,item) => sum + item.costValueCents, 0),
      saleValueCents:items.reduce((sum,item) => sum + item.saleValueCents, 0),
      suggestedPurchaseCostCents:purchaseList.reduce((sum,item) => sum + item.suggestedPurchaseCostCents, 0),
      purchaseList,
      items
    };
  }

  function buildInventorySummary(filters = {}) {
    const locations = db.prepare(`SELECT id,name,type,active,created_at AS createdAt,updated_at AS updatedAt
      FROM stock_locations WHERE active=1 ORDER BY CASE WHEN id='MAIN' THEN 0 ELSE 1 END,name,id`).all()
      .map(row => ({ ...row, active:Boolean(row.active) }));
    const locationSummaries = {};
    for (const location of locations) locationSummaries[location.id] = buildLocationInventorySummary(location);
    const allLocationsSummary = aggregateLocationSummaries(locations, locationSummaries);
    const requestedId = String(filters.locationId || 'MAIN');
    const selected = locationSummaries[requestedId];
    if (!selected) throw new Error(`Local de estoque ${requestedId} nao encontrado ou inativo.`);
    return { ...selected, locations, locationSummaries, allLocationsSummary };
  }

  return { ...base, buildSalesSummary, buildInventorySummary };
}

module.exports = { createReportingService };
