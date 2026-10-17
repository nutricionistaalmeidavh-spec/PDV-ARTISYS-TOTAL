'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const variantsSource = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'renderer', 'product-variants-ui.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'renderer', 'app.js'), 'utf8');

test('product parent row displays the active variant stock total as its main stock value', () => {
  assert.match(
    variantsSource,
    /const stockCell=row\.querySelector\('\[data-product-stock-cell\]'\)\|\|row\.children\[2\]/,
    'variant enhancement must target the stock cell in dense and legacy product rows'
  );
  assert.match(
    variantsSource,
    /const totalStock=activeList\.reduce\(\(sum,item\)=>sum\+Number\(item\.quantity\|\|0\),0\)/,
    'variant enhancement must calculate the aggregate active-variant stock once'
  );
  assert.match(
    variantsSource,
    /stockValue\.textContent=`\$\{qty\(totalStock\)\} \$\{product\?\.unit\|\|'UN'\}`/,
    'the visible parent stock value must use the aggregate variant quantity instead of stale parent stockQuantity'
  );
});

test('product form Cancelar remains owned by the canonical modal close handler', () => {
  assert.match(appSource, /id="product-form"[\s\S]*?data-close-modal>Cancelar<\/button>/);
  assert.ok(
    appSource.includes("modalRoot.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModal));"),
    'openModal must bind the product Cancelar control together with the header X'
  );
});
