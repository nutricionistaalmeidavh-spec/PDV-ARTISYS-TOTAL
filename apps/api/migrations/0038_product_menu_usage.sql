-- Preserve the existing sellable catalogue. The master-product UI explicitly
-- creates new entries with menu_enabled=0 until they are added to the menu.
ALTER TABLE products ADD COLUMN menu_enabled INTEGER NOT NULL DEFAULT 1
 CHECK(menu_enabled IN (0,1));
ALTER TABLE products ADD COLUMN usage_type TEXT NOT NULL DEFAULT 'DIRECT'
 CHECK(usage_type IN ('DIRECT','INGREDIENT','BOTH')
   AND (usage_type<>'INGREDIENT' OR menu_enabled=0));
