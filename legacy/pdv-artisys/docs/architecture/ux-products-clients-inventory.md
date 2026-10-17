# Inventário funcional — UX Produtos e Clientes

Data-base: 2026-10-02

## Regra de paridade

**funcionalidades depois >= funcionalidades antes**.

Produtos e Clientes estão no P2 canônico: `app.js` mantém a fonte funcional e os controllers de apresentação respondem ao lifecycle explícito. Não existem feature flags de retorno à UI Legacy nem o shim `catalog-search-stability.js`.

Seletores usados por módulos de extensão só mudam com adaptação explícita e teste.

# Produtos — superfície atual

Rota: `products`.

`renderProducts()` monta a superfície canônica e `renderProductsList()` atualiza busca/categoria sem rerender da página. `products-dense-controller.js` aplica status, densidade e filtro de estoque via lifecycle, sem observer.

Contratos preservados: `#new-product`, `#new-category`, `#product-page-search`, `#product-category-filter`, `#sync-product-photos`, `[data-edit-product]`, `[data-product-photo-edit]`, `[data-product-photo-remove]`, `.data-row` e `#product-form`.

## Fotos de produto

Sincronização, upload, remoção e miniaturas continuam usando API/bridge locais.

## Variações/subitens — funcionalidade injetada

`product-variants-ui.js` usa `PdvUiLifecycle` nas rotas Produtos/Balcão, preservando produto pai, variações, estoque e seleção no checkout.

## Kits e combos — funcionalidade injetada

`kits-combos-ui.js` continua oferecendo kits, combos e efeitos promocionais sem mover regras para a UI.

# Clientes — superfície atual

Rota: `customers`.

`renderCustomers()` monta a superfície canônica e `renderCustomersList()` atualiza a busca incrementalmente. `customers-master-detail-controller.js` monta lista + detalhe via lifecycle, sem fallback Legacy.

Contratos: `#new-customer`, `#customer-page-search`, `[data-edit-customer]`, `#customer-form`, `.data-row`.

## Endereço de entrega — funcionalidade injetada

`delivery-address-ui.js` continua ampliando `#customer-form` com CEP, logradouro, número, complemento, bairro, cidade, UF e referência.

## Cliente no fluxo de venda

O checkout continua usando busca/sugestões e `api.setSaleCustomer(...)`. A canonicalização da tela Clientes não altera o vínculo da venda.

## Histórico e crédito

Histórico usa endpoint filtrado por `customerId`; crédito disponível deriva de `creditLimitCents` e `creditUsedCents`.

## Evidência

Produtos e Clientes permanecem pareados em UX level 4, com renderer canônico, lifecycle, paridade, cross-flow e release regression guards. O E2E atual deve provar as superfícies no mesmo SHA.
