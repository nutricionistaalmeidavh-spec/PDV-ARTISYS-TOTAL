-- P2.3: one protected image reference per existing canonical product.
-- R2 is optional; a self-hosted local-only deployment stores a small SQLite
-- BLOB. D1/cloud installations without a private FILES binding reject uploads.
-- Apply only after 0010_purchase_orders.sql.
CREATE TABLE product_media(
 tenant_id TEXT NOT NULL,product_id TEXT NOT NULL,
 storage TEXT NOT NULL CHECK(storage IN ('R2','LOCAL')),
 object_key TEXT,data_blob BLOB,
 content_type TEXT NOT NULL CHECK(content_type IN('image/png','image/jpeg','image/webp')),
 byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 32 AND 2097152),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 updated_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,product_id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id),
 CHECK((storage='R2' AND object_key IS NOT NULL AND data_blob IS NULL) OR
       (storage='LOCAL' AND object_key IS NULL AND data_blob IS NOT NULL))
);
CREATE INDEX idx_product_media_updated ON product_media(tenant_id,updated_at);
