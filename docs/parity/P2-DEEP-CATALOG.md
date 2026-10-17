# P2 — catálogo e estoque profundo (entrega incremental)

## Implementado e auditável

- **Identidade do produto**: SKU canônico, código de barras independente e único por empresa, marca, categoria, produto pai e variação identificada por nome/SKU próprios. A UI web utiliza o mesmo cadastro que o checkout.
- **Kits**: composição de produtos com estoque; venda usa o `sale_items` e o ledger `inventory_movements` existentes. Um kit não controla saldo próprio. A venda registra em `sale_stock_allocations` os componentes e custo por unidade no instante do checkout. Devoluções repõem a mesma alocação original mesmo que o cadastro mude (mudança após venda é proibida).
- **Reservas**: `inventory_reservations` por empresa/filial/produto, sem débito do saldo físico. Disponível = estoque físico − reservas ativas; gatilhos SQL sob transação impedem vendas/transferências que comprometam estoques reservados. Liberação exige autorização e é irreversível; novos compromissos usam uma nova reserva.
- **Compras simples**: entrada existente por `inventory_movements`, agora com custo unitário opcional, histórico `purchase_cost_history` imutável por movimento, fornecedor opcional válido na mesma empresa e último custo exibido sem sobrescrever custos históricos.
- **Isolamento**: permissões `products.manage` para catálogo e kits, `inventory.adjust` para compras e reservas, escopos por tenant/filial, idempotência `commerce_mutations` e validação de chave para mudanças. Nenhum serviço pago, segundo estoque ou banco legado.
- **Interface web canônica**: mesma página Produtos e Estoque já existente, com categoria, marca, código de barras, variações, edição de composição de kits, reservas e custo de entrada. O campo “Disponível” respeita a reserva.

## Fora desta entrega — não alegar paridade integral P2

**Já entregues posteriormente:** pedidos de fornecedor/recebimentos parciais e custo médio de aquisição em P2.1 (`P2-PURCHASING.md`); importação CSV com prévia e commit atômico em P2.2 (`P2-CSV-IMPORT.md`). **Ainda pendentes:** contas a pagar automáticas, custo médio móvel do estoque e ajustes por lote, fotos R2, impressão de etiquetas, XLSX, inventário multiauditoria, localizações internas, reservas vinculadas automaticamente a pedidos/atacado e homologação física dos leitores. Estas entregas adicionais não certificam paridade integral com o desktop. A migração 0009 não substitui serviços de compras completos.

A partir desta entrega, testar também retornos de kits, concorrência de duas operações distintas, colisão de código de barras e isolamento entre empresas. Um CI verde comprova apenas cenários executados; não equivale a homologação com todos os subfluxos do desktop.

## Banco, deploy e rollback

Migração **aditiva** `apps/api/migrations/0009_catalog_inventory.sql`; aplicar somente depois de `0008_transaction_reversals.sql`. Backup prévio obrigatório, validar versões antes de migrar o banco remoto. Não executa automaticamente migrações remotas; mantém `AUTH_ENABLED=false`. Use Node.js + SQLite local, gratuito e self-hosted; Cloudflare Workers/D1 Free é alternativa opcional. Não modificar o desktop original ou seus bancos/licenças.
