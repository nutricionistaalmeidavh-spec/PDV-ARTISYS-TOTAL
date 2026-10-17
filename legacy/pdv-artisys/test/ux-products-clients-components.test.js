'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const componentPath = path.join(__dirname, '..', 'desktop', 'renderer', 'ux-components.js');
const stylePath = path.join(__dirname, '..', 'desktop', 'renderer', 'ux-components.css');
const indexPath = path.join(__dirname, '..', 'desktop', 'renderer', 'index.html');
const appPath = path.join(__dirname, '..', 'desktop', 'renderer', 'app.js');

function loadComponents() {
  assert.equal(fs.existsSync(componentPath), true, 'ux-components.js deve existir antes de carregar o contrato');
  delete require.cache[require.resolve(componentPath)];
  return require(componentPath);
}

test('UX foundation exposes the seven roadmap components without DOM dependency', () => {
  const ux = loadComponents();
  for (const name of ['DataTable', 'StatusBadge', 'SearchField', 'FilterBar', 'EmptyState', 'ActionMenu', 'DetailPanel']) {
    assert.equal(typeof ux[name], 'function', `${name} deve ser exportado como função`);
  }
});

test('DataTable renders semantic columns, rows and escapes untrusted values by default', () => {
  const { DataTable } = loadComponents();
  const html = DataTable({
    ariaLabel: 'Produtos',
    columns: [
      { key: 'name', label: 'Produto' },
      { key: 'sku', label: 'SKU' }
    ],
    rows: [{ id: 'p-1', name: '<Café & Leite>', sku: '789001' }]
  });

  assert.match(html, /<table\b/);
  assert.match(html, /aria-label="Produtos"/);
  assert.match(html, /<th[^>]*>Produto<\/th>/);
  assert.match(html, /&lt;Café &amp; Leite&gt;/);
  assert.doesNotMatch(html, /<Café & Leite>/);
  assert.match(html, /data-row-id="p-1"/);
});

test('DataTable delegates an empty result to EmptyState markup', () => {
  const { DataTable } = loadComponents();
  const html = DataTable({
    columns: [{ key: 'name', label: 'Cliente' }],
    rows: [],
    empty: { title: 'Nenhum cliente encontrado', description: 'Limpe a busca para ver todos.' }
  });

  assert.match(html, /data-ux-component="EmptyState"/);
  assert.match(html, /Nenhum cliente encontrado/);
  assert.match(html, /Limpe a busca para ver todos\./);
});

test('StatusBadge accepts known tones and falls back to neutral', () => {
  const { StatusBadge } = loadComponents();
  assert.match(StatusBadge({ label: 'Baixo', tone: 'warning' }), /ux-status--warning/);
  assert.match(StatusBadge({ label: 'Normal', tone: 'success' }), />Normal<\/span>/);
  assert.match(StatusBadge({ label: 'Outro', tone: 'inventado' }), /ux-status--neutral/);
});

test('SearchField keeps label, shortcut and query escaped and discoverable', () => {
  const { SearchField } = loadComponents();
  const html = SearchField({
    id: 'product-search-foundation',
    label: 'Buscar produtos',
    placeholder: 'Nome, SKU ou código',
    value: 'A&B',
    shortcut: 'Ctrl+K'
  });

  assert.match(html, /for="product-search-foundation"/);
  assert.match(html, /id="product-search-foundation"/);
  assert.match(html, /value="A&amp;B"/);
  assert.match(html, /Ctrl\+K/);
});

test('FilterBar renders removable chips only when an action owner is declared', () => {
  const { FilterBar } = loadComponents();
  const html = FilterBar({
    filters: [{ id: 'stock', label: 'Estoque', value: 'low', options: [{ value: '', label: 'Todos' }, { value: 'low', label: 'Baixo' }] }],
    activeChips: [{ key: 'stock', label: 'Estoque: baixo', removeAction: 'products.remove-filter' }],
    removeAction: 'products.remove-filter',
    clearAction: 'products.clear-filters'
  });

  assert.match(html, /data-filter-id="stock"/);
  assert.match(html, /value="low" selected/);
  assert.match(html, /data-action="products\.remove-filter"/);
  assert.match(html, /data-filter-key="stock"/);
  assert.match(html, /data-action="products\.clear-filters"/);
  assert.doesNotMatch(html, /onclick=/i);

  const passive = FilterBar({ activeChips: [{ key:'stock', label:'Estoque: baixo' }] });
  assert.match(passive, /<span class="ux-filter-chip ux-filter-chip--static" data-filter-key="stock">/);
  assert.doesNotMatch(passive, /<button[^>]*data-filter-key="stock"/);
});

test('ActionMenu exposes event delegation hooks and disabled actions without inline JavaScript', () => {
  const { ActionMenu } = loadComponents();
  const html = ActionMenu({
    label: 'Ações do produto',
    actions: [
      { key: 'edit', label: 'Editar' },
      { key: 'remove', label: 'Excluir', tone: 'danger', disabled: true }
    ]
  });

  assert.match(html, /<details\b/);
  assert.match(html, /data-action="edit"/);
  assert.match(html, /data-action="remove"/);
  assert.match(html, /disabled/);
  assert.doesNotMatch(html, /onclick=/i);
});

test('DetailPanel renders compact fields and actions while preserving explicit action hooks', () => {
  const { DetailPanel } = loadComponents();
  const html = DetailPanel({
    title: 'Marcos Lima',
    eyebrow: 'Cliente',
    badge: { label: 'Crédito disponível', tone: 'warning' },
    fields: [
      { label: 'CPF', value: '123.456.789-00' },
      { label: 'Telefone', value: '(16) 99999-2222' }
    ],
    actions: [
      { key: 'edit-customer', label: 'Editar ficha', primary: true },
      { key: 'customer-history', label: 'Ver histórico' }
    ]
  });

  assert.match(html, /data-ux-component="DetailPanel"/);
  assert.match(html, /Marcos Lima/);
  assert.match(html, /Crédito disponível/);
  assert.match(html, /data-action="edit-customer"/);
  assert.match(html, /data-action="customer-history"/);
});

test('foundation styles remain scoped when Products begins consuming the shared assets', () => {
  assert.equal(fs.existsSync(stylePath), true, 'ux-components.css deve existir como fundação visual');
  const css = fs.readFileSync(stylePath, 'utf8');
  for (const selector of ['.ux-data-table', '.ux-status', '.ux-search-field', '.ux-filter-bar', '.ux-empty-state', '.ux-action-menu', '.ux-detail-panel']) {
    assert.ok(css.includes(selector), `${selector} deve possuir estilos próprios`);
  }

  const index = fs.readFileSync(indexPath, 'utf8');
  const app = fs.readFileSync(appPath, 'utf8');
  assert.match(index, /ux-components\.css/);
  assert.match(index, /ux-components\.js/);
  assert.doesNotMatch(app, /ArtisysUxComponents/, 'app.js legado não deve incorporar a fundação diretamente');
});
