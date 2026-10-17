# Clientes — paridade P2 canônico

## Estado atual

A rota `customers` possui um único renderer funcional em `app.js` e uma apresentação master-detail determinística em `customers-master-detail-controller.js`, acionada por lifecycle. Não existe mais feature flag ou restauração Legacy.

A busca agora é incremental no renderer canônico, sem `catalog-search-stability.js`.

## P2 canônico

- sem feature flag;
- sem `MutationObserver` no master-detail;
- `route:mounted` e `route:updated` acionam a apresentação;
- busca incremental por `renderCustomersList()`;
- cadastro/edição continuam em `openCustomerForm()`;
- histórico continua vindo da API filtrada por cliente.

## Regra de paridade

**funcionalidades depois >= funcionalidades antes**.

| Capacidade | Contrato canônico |
| --- | --- |
| Novo cliente | `#new-customer` |
| Busca | `#customer-page-search` → `renderCustomersList()` |
| Editar ficha | `[data-edit-customer]` |
| Formulário | `#customer-form` |
| Crédito | dados canônicos de limite/usado |
| Histórico | `/api/v1/sales/history` filtrado por `customerId` |
| Endereço de entrega | `delivery-address-ui.js` |
| Cliente → Venda | `setSaleCustomer` no checkout |

## Endereço de entrega

A integração de Endereço de entrega continua no formulário canônico e não foi substituída pelo painel master-detail.

## Histórico

O painel usa histórico paginado real; não cria registros frontend nem limita o cliente às últimas vendas globais. O P2 remove apenas a arquitetura reversível antiga, preservando os contratos funcionais.
