'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const readJson = (file) => JSON.parse(read(file));
const fail = (message) => { throw new Error(`Documentation consistency: ${message}`); };

const pkg = readJson('package.json');
const readme = read('README.md');
const contributing = read('CONTRIBUTING.md');
const capabilities = readJson('release/capabilities.json');
const limitations = readJson('release/limitations.json');
const catalogDoc = read('docs/architecture/catalog-parent-variants-kits-combos.md');
const erpFinanceArchitecture = read('docs/architecture/erp-finance-p0-p3.md');
const erpFinanceOperations = read('docs/operations/erp-finance.md');
const commercialLicensing = read('docs/architecture/commercial-licensing.md');

const readmeHeading = readme.split(/\r?\n/, 1)[0].trim();
if (readmeHeading !== `# ArtiSys PDV ${pkg.version}`) {
  fail(`README version must match package.json (${pkg.version}).`);
}

for (const phrase of [
  'Produto pai e subitens',
  'Kits e combos promocionais',
  'docs/architecture/catalog-parent-variants-kits-combos.md',
  'CONTRIBUTING.md',
  'docs/architecture/commercial-licensing.md'
]) {
  if (!readme.includes(phrase)) fail(`README is missing required current-state reference: ${phrase}`);
}

for (const capability of [
  'catalog-parent-child-variants-core',
  'catalog-kits-component-stock-snapshot',
  'catalog-promotional-combos-user-configurable',
  'historical-cost-snapshot-and-margin',
  'stock-locations-reservations-and-transfers',
  'purchase-orders-partial-receiving-moving-average-payable',
  'sales-orders-pickup-delivery-reservation-fulfillment'
]) {
  if (!capabilities.includes(capability)) fail(`release/capabilities.json is missing ${capability}`);
}

if (!Array.isArray(capabilities) || !capabilities.length) fail('release/capabilities.json must be a non-empty array.');
if (!Array.isArray(limitations) || !limitations.length) fail('release/limitations.json must be a non-empty array.');
if (!limitations.some(item => /produto pai/i.test(String(item)) && /saldo/i.test(String(item)))) {
  fail('release/limitations.json must document parent-stock migration constraint.');
}
const versionedLimitations = limitations.filter(item => /versão\s+\d+\.\d+\.\d+/i.test(String(item)));
if (versionedLimitations.some(item => !String(item).includes(pkg.version))) {
  fail(`every explicit release version in release/limitations.json must match package.json (${pkg.version}).`);
}
if (!limitations.some(item => /ESTIMATED_CURRENT/.test(String(item)))) {
  fail('release/limitations.json must document the legacy historical-cost fallback.');
}
if (!/Regra obrigatória de documentação/.test(contributing) || !/mesma entrega/.test(contributing)) {
  fail('CONTRIBUTING.md must preserve the mandatory documentation-maintenance rule.');
}
if (!/não dependem da ativação do módulo opcional `RETAIL`/.test(catalogDoc)) {
  fail('catalog architecture doc must state that parent/subitem variants are core catalog behavior.');
}

const financeDocs = `${erpFinanceArchitecture}\n${erpFinanceOperations}`;
for (const phrase of ['Gestão', 'DRE', 'Fluxo de caixa', 'OFX', 'Conciliação', 'Recorrências', 'Alertas']) {
  if (!financeDocs.includes(phrase)) fail(`ERP finance documentation is missing ${phrase}.`);
}
if (!/confirma[cç][aã]o manual/i.test(financeDocs)) fail('ERP finance docs must require explicit/manual reconciliation confirmation.');
if (!/não implementa contabilidade por partidas dobradas/i.test(financeDocs)) fail('ERP finance docs must state that double-entry accounting is outside P0-P3.');
if (!/ativação comercial.*obrigatória/is.test(commercialLicensing) || !/operação diária.*local/is.test(commercialLicensing)) fail('commercial licensing doc must distinguish mandatory licensing from local daily operation.');
if (!/self-hosted/i.test(financeDocs) || !/sem dependência paga obrigatória/i.test(financeDocs)) fail('ERP finance core must be documented as self-hosted with no mandatory paid dependency.');

function assertReleaseChecklistVersionNeutral() {
  const checklist = read('release/release-checklist.md');
  if (/^#.*\bv?\d+\.\d+\.\d+/m.test(checklist)) fail('release checklist title must not hardcode a SemVer.');
  if (/ArtiSys-PDV-\d+\.\d+\.\d+-x64-Setup\.exe/.test(checklist)) fail('release checklist artifact must use RELEASE_VERSION instead of a hardcoded SemVer.');
  if (!checklist.includes('RELEASE_VERSION') || !checklist.includes('resolve-release-version.js')) fail('release checklist must document dynamic release version resolution.');
}
assertReleaseChecklistVersionNeutral();

console.log(`Documentation consistency OK for ArtiSys PDV ${pkg.version}.`);
