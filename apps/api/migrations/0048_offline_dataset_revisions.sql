-- Append-only revision counters support O(1) unchanged-dataset summaries.
-- Every canonical D1/SQLite INSERT/UPDATE/DELETE changes a tenant+branch counter.
CREATE TABLE IF NOT EXISTS offline_dataset_revisions(
 tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
 table_name TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,branch_id,table_name)
);
CREATE TRIGGER IF NOT EXISTS offline_rev_product_categories_insert AFTER INSERT ON product_categories
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,'*','product_categories',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_product_categories_update AFTER UPDATE ON product_categories
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,'*','product_categories',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_product_categories_delete AFTER DELETE ON product_categories
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,'*','product_categories',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_products_insert AFTER INSERT ON products
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,'*','products',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_products_update AFTER UPDATE ON products
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,'*','products',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_products_delete AFTER DELETE ON products
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,'*','products',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_customers_insert AFTER INSERT ON customers
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,'*','customers',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_customers_update AFTER UPDATE ON customers
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,'*','customers',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_customers_delete AFTER DELETE ON customers
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,'*','customers',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_stock_positions_insert AFTER INSERT ON stock_positions
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'stock_positions',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_stock_positions_update AFTER UPDATE ON stock_positions
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'stock_positions',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_stock_positions_delete AFTER DELETE ON stock_positions
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,OLD.branch_id,'stock_positions',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_cash_sessions_insert AFTER INSERT ON cash_sessions
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'cash_sessions',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_cash_sessions_update AFTER UPDATE ON cash_sessions
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'cash_sessions',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_cash_sessions_delete AFTER DELETE ON cash_sessions
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,OLD.branch_id,'cash_sessions',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_sales_insert AFTER INSERT ON sales
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'sales',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_sales_update AFTER UPDATE ON sales
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'sales',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_sales_delete AFTER DELETE ON sales
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,OLD.branch_id,'sales',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_sale_items_insert AFTER INSERT ON sale_items
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'sale_items',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_sale_items_update AFTER UPDATE ON sale_items
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'sale_items',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_sale_items_delete AFTER DELETE ON sale_items
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,OLD.branch_id,'sale_items',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_sale_payments_insert AFTER INSERT ON sale_payments
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'sale_payments',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_sale_payments_update AFTER UPDATE ON sale_payments
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'sale_payments',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_sale_payments_delete AFTER DELETE ON sale_payments
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,OLD.branch_id,'sale_payments',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_cash_movements_insert AFTER INSERT ON cash_movements
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'cash_movements',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_cash_movements_update AFTER UPDATE ON cash_movements
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'cash_movements',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_cash_movements_delete AFTER DELETE ON cash_movements
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,OLD.branch_id,'cash_movements',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_restaurant_tables_insert AFTER INSERT ON restaurant_tables
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'restaurant_tables',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_restaurant_tables_update AFTER UPDATE ON restaurant_tables
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'restaurant_tables',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_restaurant_tables_delete AFTER DELETE ON restaurant_tables
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,OLD.branch_id,'restaurant_tables',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_restaurant_table_sessions_insert AFTER INSERT ON restaurant_table_sessions
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'restaurant_table_sessions',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_restaurant_table_sessions_update AFTER UPDATE ON restaurant_table_sessions
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'restaurant_table_sessions',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_restaurant_table_sessions_delete AFTER DELETE ON restaurant_table_sessions
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,OLD.branch_id,'restaurant_table_sessions',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_restaurant_orders_insert AFTER INSERT ON restaurant_orders
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'restaurant_orders',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_restaurant_orders_update AFTER UPDATE ON restaurant_orders
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'restaurant_orders',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_restaurant_orders_delete AFTER DELETE ON restaurant_orders
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,OLD.branch_id,'restaurant_orders',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_restaurant_order_items_insert AFTER INSERT ON restaurant_order_items
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'restaurant_order_items',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_restaurant_order_items_update AFTER UPDATE ON restaurant_order_items
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'restaurant_order_items',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_restaurant_order_items_delete AFTER DELETE ON restaurant_order_items
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,OLD.branch_id,'restaurant_order_items',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_restaurant_kitchen_tickets_insert AFTER INSERT ON restaurant_kitchen_tickets
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'restaurant_kitchen_tickets',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_restaurant_kitchen_tickets_update AFTER UPDATE ON restaurant_kitchen_tickets
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'restaurant_kitchen_tickets',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_restaurant_kitchen_tickets_delete AFTER DELETE ON restaurant_kitchen_tickets
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,OLD.branch_id,'restaurant_kitchen_tickets',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_restaurant_service_requests_insert AFTER INSERT ON restaurant_service_requests
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'restaurant_service_requests',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_restaurant_service_requests_update AFTER UPDATE ON restaurant_service_requests
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'restaurant_service_requests',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_restaurant_service_requests_delete AFTER DELETE ON restaurant_service_requests
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,OLD.branch_id,'restaurant_service_requests',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_restaurant_sale_links_insert AFTER INSERT ON restaurant_sale_links
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'restaurant_sale_links',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_restaurant_sale_links_update AFTER UPDATE ON restaurant_sale_links
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'restaurant_sale_links',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_restaurant_sale_links_delete AFTER DELETE ON restaurant_sale_links
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,OLD.branch_id,'restaurant_sale_links',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_r4_item_transfers_insert AFTER INSERT ON r4_item_transfers
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'r4_item_transfers',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_r4_item_transfers_update AFTER UPDATE ON r4_item_transfers
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'r4_item_transfers',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_r4_item_transfers_delete AFTER DELETE ON r4_item_transfers
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,OLD.branch_id,'r4_item_transfers',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_r4_split_plans_insert AFTER INSERT ON r4_split_plans
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'r4_split_plans',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_r4_split_plans_update AFTER UPDATE ON r4_split_plans
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'r4_split_plans',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_r4_split_plans_delete AFTER DELETE ON r4_split_plans
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,OLD.branch_id,'r4_split_plans',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_cash_adjustments_insert AFTER INSERT ON cash_adjustments
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'cash_adjustments',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_cash_adjustments_update AFTER UPDATE ON cash_adjustments
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'cash_adjustments',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_cash_adjustments_delete AFTER DELETE ON cash_adjustments
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,OLD.branch_id,'cash_adjustments',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_customer_credit_receipts_insert AFTER INSERT ON customer_credit_receipts
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'customer_credit_receipts',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_customer_credit_receipts_update AFTER UPDATE ON customer_credit_receipts
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'customer_credit_receipts',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_customer_credit_receipts_delete AFTER DELETE ON customer_credit_receipts
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,OLD.branch_id,'customer_credit_receipts',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_r4_table_prepayments_insert AFTER INSERT ON r4_table_prepayments
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'r4_table_prepayments',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_r4_table_prepayments_update AFTER UPDATE ON r4_table_prepayments
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'r4_table_prepayments',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_r4_table_prepayments_delete AFTER DELETE ON r4_table_prepayments
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,OLD.branch_id,'r4_table_prepayments',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_r4_table_prepayment_refunds_insert AFTER INSERT ON r4_table_prepayment_refunds
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'r4_table_prepayment_refunds',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_r4_table_prepayment_refunds_update AFTER UPDATE ON r4_table_prepayment_refunds
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'r4_table_prepayment_refunds',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_r4_table_prepayment_refunds_delete AFTER DELETE ON r4_table_prepayment_refunds
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,OLD.branch_id,'r4_table_prepayment_refunds',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_sale_returns_insert AFTER INSERT ON sale_returns
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'sale_returns',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_sale_returns_update AFTER UPDATE ON sale_returns
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'sale_returns',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_sale_returns_delete AFTER DELETE ON sale_returns
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,OLD.branch_id,'sale_returns',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_sale_return_items_insert AFTER INSERT ON sale_return_items
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'sale_return_items',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_sale_return_items_update AFTER UPDATE ON sale_return_items
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'sale_return_items',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_sale_return_items_delete AFTER DELETE ON sale_return_items
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,OLD.branch_id,'sale_return_items',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_sale_refund_movements_insert AFTER INSERT ON sale_refund_movements
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'sale_refund_movements',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_sale_refund_movements_update AFTER UPDATE ON sale_refund_movements
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(NEW.tenant_id,NEW.branch_id,'sale_refund_movements',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS offline_rev_sale_refund_movements_delete AFTER DELETE ON sale_refund_movements
BEGIN
 INSERT INTO offline_dataset_revisions(tenant_id,branch_id,table_name,revision)
 VALUES(OLD.tenant_id,OLD.branch_id,'sale_refund_movements',1)
 ON CONFLICT(tenant_id,branch_id,table_name) DO UPDATE SET revision=revision+1;
END;

-- Node stores D1 versions separately: local SQLite has its own write triggers.
CREATE TABLE IF NOT EXISTS offline_downloaded_versions(
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,table_name TEXT NOT NULL,
 cloud_revision INTEGER NOT NULL, row_count INTEGER NOT NULL,
 last_success_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,branch_id,table_name)
);
-- Resume a large multi-page transfer after a dropped connection or PC restart.
-- Cached pages are discarded when the cloud revision changes.
CREATE TABLE IF NOT EXISTS offline_download_pages(
 tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,table_name TEXT NOT NULL,
 cloud_revision INTEGER NOT NULL,page_start INTEGER NOT NULL,page_end INTEGER NOT NULL,
 payload_json TEXT NOT NULL,checksum TEXT NOT NULL,
 PRIMARY KEY(tenant_id,branch_id,table_name,cloud_revision,page_start)
);
CREATE INDEX IF NOT EXISTS offline_download_pages_resume
 ON offline_download_pages(tenant_id,branch_id,table_name,cloud_revision,page_end);
