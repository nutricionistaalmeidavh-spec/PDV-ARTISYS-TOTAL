export const COMMERCE_FIXTURE_PACKS = [
  {
    id: 'commerce/catalog',
    revision: 1,
    data: {
      products: [
        { externalKey: 'demo-product-1', name: 'Produto Demonstração', price: 19.9, active: true },
        { externalKey: 'demo-product-2', name: 'Produto Demonstração 2', price: 29.9, active: true },
      ],
    },
  },
  {
    id: 'commerce/order',
    revision: 1,
    data: {
      orders: [
        {
          externalKey: 'demo-order-1',
          customerExternalKey: 'demo-customer-1',
          items: [{ productExternalKey: 'demo-product-1', quantity: 1 }],
          status: 'open',
        },
      ],
    },
  },
];
