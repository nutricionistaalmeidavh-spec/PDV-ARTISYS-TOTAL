'use strict';

const { randomBytes, randomUUID, scryptSync, timingSafeEqual } = require('node:crypto');
const { assertCents } = require('../shared/money');
const { writeAudit } = require('../../core/audit-log');
const { runCustomerAddressMigrations } = require('../../core/database/customer-address-migrations');

function normalizeDocument(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  return digits || null;
}

function normalizeOptional(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeEmail(value) {
  const text = normalizeOptional(value);
  return text ? text.toLowerCase() : null;
}

function normalizeCustomerAddress(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const postalCode = String(input.postalCode || '').replace(/\D+/g,'') || null;
  if (postalCode && postalCode.length !== 8) throw new Error('CEP deve possuir 8 digitos.');
  const state = normalizeOptional(input.state)?.toUpperCase() || null;
  if (state && !/^[A-Z]{2}$/.test(state)) throw new Error('UF deve possuir 2 letras.');
  const address = {
    postalCode,
    street: normalizeOptional(input.street),
    number: normalizeOptional(input.number),
    complement: normalizeOptional(input.complement),
    district: normalizeOptional(input.district),
    city: normalizeOptional(input.city),
    state,
    reference: normalizeOptional(input.reference)
  };
  return Object.values(address).some(Boolean) ? address : null;
}

function addressFromRow(row) {
  if (!row) return null;
  return normalizeCustomerAddress({
    postalCode:row.address_postal_code,street:row.address_street,number:row.address_number,
    complement:row.address_complement,district:row.address_district,city:row.address_city,
    state:row.address_state,reference:row.address_reference
  });
}

function booleanInt(value, fallback = true) {
  return (value == null ? fallback : Boolean(value)) ? 1 : 0;
}

function rowToCategory(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, active: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at };
}

function rowToProduct(row) {
  if (!row) return null;
  return {
    id: row.id,
    sku: row.sku,
    barcode: row.barcode,
    name: row.name,
    categoryId: row.category_id,
    categoryName: row.category_name ?? null,
    unit: row.unit,
    salePriceCents: row.sale_price_cents,
    costCents: row.cost_cents,
    trackStock: Boolean(row.track_stock),
    minimumStock: row.minimum_stock,
    usageType: row.usage_type || 'DIRECT',
    menuEnabled: Boolean(row.menu_enabled),
    stockQuantity: Number(row.stock_quantity ?? 0),
    photo: row.photo_thumbnail_sha256 ? { version:row.photo_version, thumbnailSha256:row.photo_thumbnail_sha256, originalSha256:row.photo_original_sha256, updatedAt:row.photo_updated_at } : null,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToCustomer(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, document: row.document, phone: row.phone, email: row.email, notes: row.notes,
    address: addressFromRow(row),
    creditLimitCents: row.credit_limit_cents, creditUsedCents: row.credit_used_cents, active: Boolean(row.active),
    lastSale: row.last_sale_id ? {
      id: row.last_sale_id,
      saleNumber: row.last_sale_number || null,
      totalCents: Number(row.last_sale_total_cents ?? 0),
      openedAt: row.last_sale_opened_at || null,
      completedAt: row.last_sale_completed_at || null
    } : null,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function rowToSupplier(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, document: row.document, phone: row.phone, email: row.email, active: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at };
}

function publicUser(row) {
  if (!row) return null;
  const user = { id: row.id, username: row.username, name: row.name, profileId:row.profile_id||null, active: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at };
  if (row.email) user.email = row.email;
  return user;
}

function createCatalogService({ db, now = () => new Date().toISOString(), idFactory = prefix => `${prefix}-${randomUUID()}` } = {}) {
  if (!db) throw new TypeError('Database is required.');
  runCustomerAddressMigrations(db);
  const productColumns=new Set(db.prepare('PRAGMA table_info(products)').all().map(column=>column.name));
  const tableExists=name=>Boolean(db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(name));
  if(!productColumns.has('menu_enabled')){
    db.exec('ALTER TABLE products ADD COLUMN menu_enabled INTEGER NOT NULL DEFAULT 0 CHECK(menu_enabled IN (0,1))');
    productColumns.add('menu_enabled');
    const hasRecipes=tableExists('product_recipes');
    const hasRecipeComponents=tableExists('recipe_components');
    const hasVariants=tableExists('product_variants');
    const directStock=hasRecipeComponents
      ? "(track_stock=1 AND NOT EXISTS (SELECT 1 FROM recipe_components rc WHERE rc.ingredient_product_id=products.id))"
      : "track_stock=1";
    const sourceRules=[directStock];
    if(hasRecipes)sourceRules.push("EXISTS (SELECT 1 FROM product_recipes pr WHERE pr.product_id=products.id AND pr.active=1)");
    if(hasVariants)sourceRules.push("EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id=products.id AND pv.active=1)");
    db.exec(`UPDATE products SET menu_enabled=1 WHERE active=1 AND (${sourceRules.join(' OR ')})`);
  }
  if(!productColumns.has('usage_type')){
    db.exec("ALTER TABLE products ADD COLUMN usage_type TEXT NOT NULL DEFAULT 'DIRECT' CHECK(usage_type IN ('INGREDIENT','DIRECT','BOTH'))");
    productColumns.add('usage_type');
    if(tableExists('recipe_components')){
      db.exec("UPDATE products SET usage_type='INGREDIENT' WHERE track_stock=1 AND EXISTS (SELECT 1 FROM recipe_components rc WHERE rc.ingredient_product_id=products.id)");
      db.exec("UPDATE products SET usage_type='BOTH' WHERE track_stock=1 AND menu_enabled=1 AND EXISTS (SELECT 1 FROM recipe_components rc WHERE rc.ingredient_product_id=products.id)");
    }
  }
  const hasProductPhotos=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='product_photos'").get());
  const userColumns=new Set(db.prepare('PRAGMA table_info(users)').all().map(column=>column.name));
  const hasAccountIdentity=['email','email_normalized','password_changed_at'].every(name=>userColumns.has(name));
  const hasProfiles=userColumns.has('profile_id')&&tableExists('profiles');
  function resolveUserProfile(input,existing=null){
    if(!hasProfiles)throw new Error('Schema canonico de perfis nao inicializado.');
    const requested=input.profileId!==undefined&&input.profileId!==null?String(input.profileId).trim():'';
    const profileId=requested||String(existing?.profile_id||'').trim();
    if(!profileId)throw new Error('Perfil de acesso obrigatorio.');
    const row=db.prepare('SELECT id,active FROM profiles WHERE id=?').get(profileId);
    if(!row||!row.active)throw new Error('Perfil de acesso nao encontrado ou inativo.');
    return row;
  }

  function upsertCategory(input = {}, actor = null) {
    const id = String(input.id || idFactory('cat')).trim();
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Nome da categoria obrigatorio.');
    const timestamp = now();
    db.prepare(`INSERT INTO categories (id,name,active,created_at,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=excluded.active,updated_at=excluded.updated_at`)
      .run(id, name, booleanInt(input.active), timestamp, timestamp);
    writeAudit(db, { action: 'category.upsert', entity: 'category', entityId: id, actor, context: { name } }, now);
    return rowToCategory(db.prepare('SELECT * FROM categories WHERE id=?').get(id));
  }

  function listCategories({ includeInactive = false } = {}) {
    const rows = includeInactive
      ? db.prepare('SELECT * FROM categories ORDER BY name,id').all()
      : db.prepare('SELECT * FROM categories WHERE active=1 ORDER BY name,id').all();
    return rows.map(rowToCategory);
  }

  function productSelect(where = '') {
    const photoColumns=hasProductPhotos?'ph.version AS photo_version,ph.original_sha256 AS photo_original_sha256,ph.thumbnail_sha256 AS photo_thumbnail_sha256,ph.updated_at AS photo_updated_at':'NULL AS photo_version,NULL AS photo_original_sha256,NULL AS photo_thumbnail_sha256,NULL AS photo_updated_at';
    const photoJoin=hasProductPhotos?'LEFT JOIN product_photos ph ON ph.product_id=p.id AND ph.deleted_at IS NULL':'';
    return `SELECT p.*, c.name AS category_name, COALESCE(b.quantity,0) AS stock_quantity,${photoColumns}
      FROM products p
      LEFT JOIN categories c ON c.id=p.category_id
      LEFT JOIN inventory_balances b ON b.product_id=p.id ${photoJoin} ${where}`;
  }

  function upsertProduct(input = {}, actor = null) {
    const id = String(input.id || idFactory('prod')).trim();
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Nome do produto obrigatorio.');
    const salePriceCents = assertCents(input.salePriceCents ?? 0, 'salePriceCents');
    const costCents = assertCents(input.costCents ?? 0, 'costCents');
    if (salePriceCents < 0 || costCents < 0) throw new Error('Valores do produto nao podem ser negativos.');
    const minimumStock = Number(input.minimumStock ?? 0);
    if (!Number.isFinite(minimumStock) || minimumStock < 0) throw new Error('Estoque minimo invalido.');
    const existingProduct = db.prepare('SELECT menu_enabled,usage_type FROM products WHERE id=?').get(id);
    const usageType = String(input.usageType || existingProduct?.usage_type || 'DIRECT').trim().toUpperCase();
    if(!['INGREDIENT','DIRECT','BOTH'].includes(usageType)) throw new Error('Tipo de uso do produto invalido.');
    const menuEnabled = input.menuEnabled === undefined ? Boolean(existingProduct?.menu_enabled) : Boolean(input.menuEnabled);
    const hasActiveRecipe=tableExists('product_recipes')&&Boolean(db.prepare('SELECT 1 FROM product_recipes WHERE product_id=? AND active=1').get(id));
    if(menuEnabled && !hasActiveRecipe && !['DIRECT','BOTH'].includes(usageType)) throw new Error('Insumo puro nao pode ser publicado diretamente no Cardapio.');
    const timestamp = now();
    db.prepare(`INSERT INTO products
      (id,sku,barcode,name,category_id,unit,sale_price_cents,cost_cents,track_stock,minimum_stock,usage_type,menu_enabled,active,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET sku=excluded.sku,barcode=excluded.barcode,name=excluded.name,category_id=excluded.category_id,
        unit=excluded.unit,sale_price_cents=excluded.sale_price_cents,cost_cents=excluded.cost_cents,track_stock=excluded.track_stock,
        minimum_stock=excluded.minimum_stock,usage_type=excluded.usage_type,menu_enabled=excluded.menu_enabled,active=excluded.active,updated_at=excluded.updated_at`)
      .run(id, normalizeOptional(input.sku), normalizeOptional(input.barcode), name, normalizeOptional(input.categoryId), String(input.unit || 'UN').trim().toUpperCase(),
        salePriceCents, costCents, booleanInt(input.trackStock), Number(minimumStock.toFixed(3)), usageType, menuEnabled?1:0, booleanInt(input.active), timestamp, timestamp);
    db.prepare('INSERT OR IGNORE INTO inventory_balances (product_id,quantity,updated_at) VALUES (?,0,?)').run(id, timestamp);
    writeAudit(db, { action: 'product.upsert', entity: 'product', entityId: id, actor, context: { sku: input.sku, barcode: input.barcode, name } }, now);
    return getProduct(id);
  }

  function enrichProduct(product){
    if(!product)return null;
    if(!tableExists('product_recipes')||!tableExists('recipe_components'))return product;
    const activeRecipe=db.prepare('SELECT * FROM product_recipes WHERE product_id=? AND active=1 ORDER BY version DESC LIMIT 1').get(product.id);
    if(!activeRecipe)return{...product,prepared:false,recipeStockStatus:null,recipeCapacity:null};
    const components=db.prepare(`SELECT rc.quantity,rc.conversion_factor AS conversionFactor,rc.loss_percent AS lossPercent,
      COALESCE(b.quantity,0) AS stockQuantity,COALESCE(p.minimum_stock,0) AS minimumStock
      FROM recipe_components rc
      JOIN products p ON p.id=rc.ingredient_product_id
      LEFT JOIN inventory_balances b ON b.product_id=rc.ingredient_product_id
      WHERE rc.recipe_id=?`).all(activeRecipe.id);
    let capacity=Infinity;let low=false;let out=false;
    const portionsPerBatch=Math.max(Number(activeRecipe.yield_quantity||1)/Math.max(Number(activeRecipe.portion_quantity||1),0.000001),0.000001);
    for(const component of components){
      const required=Number(component.quantity||0)*Number(component.conversionFactor||1)*(1+Number(component.lossPercent||0)/100)/portionsPerBatch;
      const stock=Number(component.stockQuantity||0);
      const possible=required>0?Math.floor(stock/required):Infinity;
      capacity=Math.min(capacity,possible);
      if(stock<=0||possible<=0)out=true;
      else if(stock<=Number(component.minimumStock||0)||possible<=1)low=true;
    }
    return{...product,prepared:true,recipeStockStatus:out?'OUT':low?'LOW':'OK',recipeCapacity:Number.isFinite(capacity)?Math.max(0,capacity):0};
  }

  function getProduct(id) {
    return enrichProduct(rowToProduct(db.prepare(`${productSelect('WHERE p.id=?')}`).get(String(id))));
  }

  function listProducts({ includeInactive = false } = {}) {
    const sql = includeInactive
      ? `${productSelect()} ORDER BY p.name,p.id`
      : `${productSelect('WHERE p.active=1')} ORDER BY p.name,p.id`;
    return db.prepare(sql).all().map(rowToProduct).map(enrichProduct);
  }

  function removeProduct(id, actor = null) {
    const product = getProduct(id);
    if (!product) throw new Error('Produto nao encontrado.');
    if (!product.active) return product;
    const timestamp = now();
    db.prepare('UPDATE products SET active=0,menu_enabled=0,updated_at=? WHERE id=?').run(timestamp, product.id);
    writeAudit(db, { action: 'product.remove', entity: 'product', entityId: product.id, actor, context: { name: product.name, mode: 'soft-delete' } }, now);
    return getProduct(product.id);
  }

  function customerSelect(where = '') {
    return `SELECT c.*,
      ls.id AS last_sale_id,ls.sale_number AS last_sale_number,ls.total_cents AS last_sale_total_cents,
      ls.opened_at AS last_sale_opened_at,ls.completed_at AS last_sale_completed_at
      FROM customers c
      LEFT JOIN sales ls ON ls.id=(
        SELECT s.id FROM sales s
        WHERE s.customer_id=c.id AND s.status='COMPLETED'
        ORDER BY COALESCE(s.completed_at,s.opened_at) DESC,s.id DESC LIMIT 1
      ) ${where}`;
  }

  function upsertCustomer(input = {}, actor = null) {
    const id = String(input.id || idFactory('cust')).trim();
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Nome do cliente obrigatorio.');
    const creditLimitCents = assertCents(input.creditLimitCents ?? 0, 'creditLimitCents');
    const creditUsedCents = assertCents(input.creditUsedCents ?? 0, 'creditUsedCents');
    if (creditLimitCents < 0 || creditUsedCents < 0) throw new Error('Credito nao pode ser negativo.');
    const existing = db.prepare('SELECT * FROM customers WHERE id=?').get(id);
    const address = input.address === undefined ? addressFromRow(existing) : normalizeCustomerAddress(input.address);
    const timestamp = now();
    db.prepare(`INSERT INTO customers
      (id,name,document,phone,email,notes,credit_limit_cents,credit_used_cents,active,created_at,updated_at,
       address_postal_code,address_street,address_number,address_complement,address_district,address_city,address_state,address_reference)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,document=excluded.document,phone=excluded.phone,email=excluded.email,notes=excluded.notes,
        credit_limit_cents=excluded.credit_limit_cents,credit_used_cents=excluded.credit_used_cents,active=excluded.active,updated_at=excluded.updated_at,
        address_postal_code=excluded.address_postal_code,address_street=excluded.address_street,address_number=excluded.address_number,
        address_complement=excluded.address_complement,address_district=excluded.address_district,address_city=excluded.address_city,
        address_state=excluded.address_state,address_reference=excluded.address_reference`)
      .run(id, name, normalizeDocument(input.document), normalizeOptional(input.phone), normalizeOptional(input.email), normalizeOptional(input.notes),
        creditLimitCents, creditUsedCents, booleanInt(input.active), existing?.created_at || timestamp, timestamp,
        address?.postalCode||null,address?.street||null,address?.number||null,address?.complement||null,address?.district||null,address?.city||null,address?.state||null,address?.reference||null);
    writeAudit(db, { action: 'customer.upsert', entity: 'customer', entityId: id, actor, context: { name, document: normalizeDocument(input.document), hasAddress:Boolean(address) } }, now);
    return getCustomer(id);
  }

  function getCustomer(id) {
    return rowToCustomer(db.prepare(customerSelect('WHERE c.id=?')).get(String(id)));
  }

  function listCustomers({ includeInactive = false } = {}) {
    const sql = includeInactive
      ? `${customerSelect()} ORDER BY c.name,c.id`
      : `${customerSelect('WHERE c.active=1')} ORDER BY c.name,c.id`;
    return db.prepare(sql).all().map(rowToCustomer);
  }

  function upsertSupplier(input = {}, actor = null) {
    const id = String(input.id || idFactory('sup')).trim();
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Nome do fornecedor obrigatorio.');
    const timestamp = now();
    db.prepare(`INSERT INTO suppliers (id,name,document,phone,email,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,document=excluded.document,phone=excluded.phone,email=excluded.email,active=excluded.active,updated_at=excluded.updated_at`)
      .run(id, name, normalizeDocument(input.document), normalizeOptional(input.phone), normalizeOptional(input.email), booleanInt(input.active), timestamp, timestamp);
    writeAudit(db, { action: 'supplier.upsert', entity: 'supplier', entityId: id, actor, context: { name, document: normalizeDocument(input.document) } }, now);
    return rowToSupplier(db.prepare('SELECT * FROM suppliers WHERE id=?').get(id));
  }

  function listSuppliers({ includeInactive = false } = {}) {
    const rows = includeInactive
      ? db.prepare('SELECT * FROM suppliers ORDER BY name,id').all()
      : db.prepare('SELECT * FROM suppliers WHERE active=1 ORDER BY name,id').all();
    return rows.map(rowToSupplier);
  }

  function createUser(input = {}, actor = null) {
    if(Object.prototype.hasOwnProperty.call(input,'role'))throw new Error('Campo role legado nao e suportado; informe profileId.');
    const profile=resolveUserProfile(input,null);
    const password = String(input.password || '');
    if (password.length < 10) throw new Error('Senha deve possuir pelo menos 10 caracteres.');
    const id = String(input.id || idFactory('user')).trim();
    const username = String(input.username || '').trim().toLowerCase();
    const name = String(input.name || '').trim();
    const email = normalizeEmail(input.email);
    if (!username || !name) throw new Error('Usuario e nome sao obrigatorios.');
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    const timestamp = now();
    if (hasAccountIdentity) {
      db.prepare(`INSERT INTO users (id,username,name,profile_id,password_hash,password_salt,email,email_normalized,password_changed_at,active,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, username, name, profile.id, hash, salt, email, email, timestamp, booleanInt(input.active), timestamp, timestamp);
    } else {
      db.prepare(`INSERT INTO users (id,username,name,profile_id,password_hash,password_salt,active,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, username, name, profile.id, hash, salt, booleanInt(input.active), timestamp, timestamp);
    }
    writeAudit(db, { action: 'user.create', entity: 'user', entityId: id, actor, context: { username, name, profileId:profile.id, hasEmail:Boolean(email) } }, now);
    return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
  }

  function upsertUser(input = {}, actor = null) {
    const id = String(input.id || '').trim();
    if (!id) return createUser(input, actor);
    if(Object.prototype.hasOwnProperty.call(input,'role'))throw new Error('Campo role legado nao e suportado; informe profileId.');
    const username = String(input.username || '').trim().toLowerCase();
    const name = String(input.name || '').trim();
    if (!username || !name) throw new Error('Usuario e nome sao obrigatorios.');
    const existing = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!existing) return createUser(input, actor);
    const profile=resolveUserProfile(input,existing);
    const email = input.email === undefined ? existing.email : normalizeEmail(input.email);
    const password = String(input.password || '');
    let hash = existing.password_hash;
    let salt = existing.password_salt;
    let passwordChangedAt = existing.password_changed_at;
    const timestamp = now();
    if (password) {
      if (password.length < 10) throw new Error('Senha deve possuir pelo menos 10 caracteres.');
      salt = randomBytes(16).toString('hex');
      hash = scryptSync(password, salt, 64).toString('hex');
      passwordChangedAt = timestamp;
    }
    if (hasAccountIdentity) {
      db.prepare(`UPDATE users SET username=?,name=?,profile_id=?,password_hash=?,password_salt=?,email=?,email_normalized=?,password_changed_at=?,active=?,updated_at=? WHERE id=?`)
        .run(username, name, profile.id, hash, salt, email, email, passwordChangedAt, booleanInt(input.active), timestamp, id);
    } else {
      db.prepare(`UPDATE users SET username=?,name=?,profile_id=?,password_hash=?,password_salt=?,active=?,updated_at=? WHERE id=?`)
        .run(username, name, profile.id, hash, salt, booleanInt(input.active), timestamp, id);
    }
    writeAudit(db, { action: 'user.upsert', entity: 'user', entityId: id, actor, context: { username, name, profileId:profile.id, hasEmail:Boolean(email) } }, now);
    return getUser(id);
  }

  function getUser(id) {
    return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(String(id)));
  }

  function listUsers({ includeInactive = false } = {}) {
    const rows = includeInactive
      ? db.prepare('SELECT * FROM users ORDER BY name,id').all()
      : db.prepare('SELECT * FROM users WHERE active=1 ORDER BY name,id').all();
    return rows.map(publicUser);
  }

  function countUsers() {
    return Number(db.prepare('SELECT COUNT(*) AS count FROM users').get().count || 0);
  }

  function verifyUserPassword(username, password) {
    const row = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(username || '').trim().toLowerCase());
    if (!row) return { ok: false, reason: 'invalid-credentials' };
    const actual = scryptSync(String(password || ''), row.password_salt, 64);
    const expected = Buffer.from(row.password_hash, 'hex');
    const ok = expected.length === actual.length && timingSafeEqual(expected, actual);
    return ok ? { ok: true, user: publicUser(row) } : { ok: false, reason: 'invalid-credentials' };
  }

  return {
    upsertCategory, listCategories,
    upsertProduct, getProduct, listProducts, removeProduct,
    upsertCustomer, getCustomer, listCustomers,
    upsertSupplier, listSuppliers,
    createUser, upsertUser, getUser, listUsers, countUsers, verifyUserPassword
  };
}

module.exports = { normalizeDocument, normalizeEmail, normalizeCustomerAddress, createCatalogService };