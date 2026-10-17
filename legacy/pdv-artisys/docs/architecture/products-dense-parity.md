# Produtos — paridade P2 canônico

## Estado atual

A rota `products` usa uma única arquitetura de produção. `app.js` é o renderer funcional canônico e `products-dense-controller.js` é a camada de apresentação determinística acionada pelo lifecycle. Não existe mais feature flag nem fallback Legacy.

O P2 removeu o shim `catalog-search-stability.js`. Busca e categoria são incrementais dentro do renderer canônico e não recriam mais a página inteira.

## P2 canônico

- sem feature flag;
- sem `MutationObserver` no controller de Produtos;
- `route:mounted` e `route:updated` acionam a apresentação Dense;
- busca incremental por `renderProductsList()`;
- filtro de categoria incremental;
- contratos de ação permanecem em `app.js`.

## Regra de paridade

**funcionalidades depois >= funcionalidades antes**.

| Capacidade | Contrato canônico |
| --- | --- |
| Novo produto | `#new-product` |
| Categoria | `#new-category` / `#product-category-filter` |
| Busca | `#product-page-search` → `renderProductsList()` |
| Sincronizar fotos | `#sync-product-photos` |
| Foto | `[data-product-photo-edit]` / `[data-product-photo-remove]` |
| Origem/edição | `[data-edit-product]` |
| Variações | `product-variants-ui.js` via lifecycle |
| Kits e combos | `kits-combos-ui.js` |
| Estoque/status | `products-dense-controller.js` + dados canônicos |

## Integrações preservadas

Variações e Kits e combos continuam usando os seletores existentes. O P2 não move regras de negócio para o renderer e não altera persistência, estoque, venda ou auditoria.

A apresentação Dense continua interpretando dados canônicos; o controller não recria botões de gravação. O rollback por flag foi removido porque havia se tornado uma segunda arquitetura de UI permanentemente mantida.
