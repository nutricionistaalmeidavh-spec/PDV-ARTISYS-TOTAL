'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../js/core/database/sqlite-database');
const { runMigrations } = require('../js/core/database/migrations');
const { createCatalogService } = require('../js/domains/catalog/catalog-service');
const { createInventoryService } = require('../js/domains/inventory/inventory-service');
const { createImportService } = require('../js/core/import/import-service');
const { writeBootstrapConfig, resolveBootstrapConfig } = require('../desktop/bootstrap-config.cjs');

test('terminal LAN credential is never persisted in public deployment.json', () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-terminal-public-config-')); const configPath = path.join(dir, 'deployment.json'); try { writeBootstrapConfig(configPath, { profile:'terminal', apiBase:'http://10.0.0.2:4174', terminalId:'PDV-02', terminalName:'Caixa 02', terminalKey:'PLAIN-LAN-SECRET', storeName:'Loja Centro' }); const raw = fs.readFileSync(configPath, 'utf8'); assert.equal(raw.includes('PLAIN-LAN-SECRET'), false); assert.equal(raw.includes('terminalKey'), false); const loaded = resolveBootstrapConfig({ env: {}, configPath }); assert.equal(loaded.terminalKey, null); assert.equal(loaded.terminalId, 'PDV-02'); } finally { fs.rmSync(dir, { recursive:true, force:true }); } });

test('import commit is atomic when a later row fails during apply', () => { const db = openDatabase(':memory:'); let seq = 0; const now = () => new Date(1789008000000 + seq++ * 1000).toISOString(); const idFactory = prefix => `${prefix}-${++seq}`; try { runMigrations(db, now); const catalog = createCatalogService({ db, now, idFactory }); const inventory = createInventoryService({ db, now, idFactory }); const imports = createImportService({ db, catalog, inventory, now, idFactory }); const csv = ['sku;barcode;name;salePriceCents','A1;789000000001;Primeiro;1000','A2;789000000001;Segundo;1200'].join('\n'); const preview = imports.preview({ type:'products', format:'csv', content:csv, collisionPolicy:'CREATE' }); assert.equal(preview.summary.invalid, 0); assert.throws(() => imports.commit(preview.batchId, { actor:{ userId:'admin', role:'admin' } }), /unique|barcode|constraint/i); assert.equal(catalog.listProducts().length, 0); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action=?').get('product.upsert').n, 0); assert.equal(imports.getBatch(preview.batchId).status, 'FAILED'); } finally { db.close(); } });

test('desktop has an encrypted terminal credential store isolated from renderer persistence', () => { const credentialModule = path.join(__dirname, '..', 'desktop', 'terminal-credentials.cjs'); assert.equal(fs.existsSync(credentialModule), true); const source = fs.readFileSync(credentialModule, 'utf8'); assert.match(source, /safeStorage/); assert.match(source, /encryptString/); assert.match(source, /decryptString/); const preload = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'preload.cjs'), 'utf8'); assert.doesNotMatch(preload, /credentialStore|loadTerminalCredential|saveTerminalCredential/); });
