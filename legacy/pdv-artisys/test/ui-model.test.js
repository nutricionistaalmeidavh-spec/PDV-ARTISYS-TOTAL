const test = require('node:test');
const assert = require('node:assert/strict');

const ui = require('../desktop/renderer/ui-model');

test('home exposes the ten approved operational tiles with F2-F11 shortcuts', () => {
  assert.equal(ui.HOME_TILES.length, 10);
  assert.deepEqual(ui.HOME_TILES.map((item) => item.shortcut), ['F2','F3','F4','F5','F6','F7','F8','F9','F10','F11']);
  assert.equal(ui.HOME_TILES[0].route, 'checkout');
  assert.equal(ui.HOME_TILES[1].route, 'customers');
  assert.equal(ui.HOME_TILES[2].route, 'sellers');
  assert.equal(ui.HOME_TILES[3].route, 'products');
});

test('shortcut resolver keeps global home navigation and contextual checkout actions separate', () => {
  assert.deepEqual(ui.resolveShortcut('F3', 'home'), { type: 'navigate', route: 'customers' });
  assert.deepEqual(ui.resolveShortcut('F4', 'home'), { type: 'navigate', route: 'sellers' });
  assert.deepEqual(ui.resolveShortcut('F3', 'checkout'), { type: 'checkout.remove-selected' });
  assert.deepEqual(ui.resolveShortcut('F4', 'checkout'), { type: 'checkout.cancel-sale' });
  assert.deepEqual(ui.resolveShortcut('F12', 'checkout'), { type: 'checkout.finalize' });
});

test('money, discount and margin helpers use integer cents', () => {
  assert.match(ui.formatCents(4820), /48,20/);
  assert.equal(ui.parseCurrencyToCents('12,34'), 1234);
  assert.equal(ui.parseCurrencyToCents('12.34'), 1234);
  assert.equal(ui.parseCurrencyToCents('1.234,56'), 123456);
  assert.equal(ui.parseCurrencyToCents('R$ 2,50'), 250);
  assert.equal(ui.percentageToDiscountCents(4820, 10), 482);
  assert.equal(ui.percentageToDiscountCents(4820, 150), 4820);
  assert.equal(ui.calculateMarginPercent(650, 400), 38.46);
});

test('product filter finds name sku and barcode without case sensitivity', () => {
  const products = [
    { id: '1', name: 'Água Mineral 500ml', sku: '000001', barcode: '78910001', categoryId: 'bebidas' },
    { id: '2', name: 'Café 500g', sku: '000005', barcode: '78910005', categoryId: 'alimentos' }
  ];
  assert.deepEqual(ui.filterProducts(products, 'agua').map((item) => item.id), ['1']);
  assert.deepEqual(ui.filterProducts(products, '000005').map((item) => item.id), ['2']);
  assert.deepEqual(ui.filterProducts(products, '78910001').map((item) => item.id), ['1']);
  assert.deepEqual(ui.filterProducts(products, '', 'bebidas').map((item) => item.id), ['1']);
});

test('payment buttons map approved labels to server methods', () => {
  assert.equal(ui.paymentMethodFromUi('cash'), 'CASH');
  assert.equal(ui.paymentMethodFromUi('card'), 'CREDIT_CARD');
  assert.equal(ui.paymentMethodFromUi('pix'), 'PIX');
  assert.equal(ui.paymentMethodFromUi('tef'), 'CREDIT_CARD');
});
