# P1 — devoluções e reversões transacionais

**Estado:** implementação de um recorte da paridade desktop/web; não declarar paridade completa nem liberar produção com base apenas nestes testes.

## Domínio e fonte da verdade

- Venda, pagamento registrado, desconto, estoque e caixa continuam sob `apps/api/src/commerce.mjs`, com regra de desconto do `packages/core/js/domains/sales/pricing.js` e cálculo de caixa do `packages/core/js/domains/cash/cash-rules.js`.
- `sale_returns` guarda o evento canônico e o vínculo com a venda e caixa originais. `sale_return_items` limita a quantidade cumulativa devolvida por item; `sale_refund_movements` registra a compensação por método de pagamento **sem disparar PIX, adquirente ou reembolso bancário real**.
- Reposição de estoque usa `inventory_movements` tipo `return` e atualiza apenas a projeção `stock_positions` via trigger existente. Comissão usa `seller_commission_ledger` tipo `REVERSED`, sem editar comissão adquirida. Crédito da loja usa `customer_credit_ledger` tipo `REVERSAL`; dinheiro não é contabilizado como nova venda.
- `finance_settlement_reversals` referencia a liquidação original imutável. Saldo de contas, filtros, projeções financeiras e DRE pelo caixa descontam a liquidação compensada.
- Cada mutação tem identificador idempotente registrado na `commerce_mutations`, com batch único SQLite/D1. Asserções SQL restringem totais, quantidade, dinheiro disponível, duplicidade e transferência de empresas.

## Comportamentos e limitações

1. Venda `OPEN` continua usando cancelamento anterior. Venda `COMPLETED` só é cancelada mediante devolução integral dos itens remanescentes, motivo e reembolso exatamente correspondente ao líquido calculado. O histórico original fica preservado.
2. Devolução parcial não muda o status `COMPLETED`; cada evento tem linhas e montante próprio. Limites de reembolso por método ficam vinculados ao valor originalmente recebido, descontando troco e reembolsos anteriores.
3. Dinheiro sai **somente da sessão de caixa aberta no momento da devolução**, com limite de saldo suficiente. A sessão original encerrada não recebe novos movimentos nem tem fechamento reescrito; seu ID permanece auditável.
4. Crediário: reversão é permitida apenas enquanto o saldo devido do cliente comportar a compensação. Pagamentos de dívidas já recebidos ou alocações complexas entre vendas exigem conciliação; a operação falha sem alterações parciais. **A ausência de alocação de recebimentos por venda é uma limitação ainda existente.**
5. Liquidação financeira conciliada com banco não pode ser revertida pelo endpoint comum; requer fluxo futuro específico de desfazer conciliação. Reversão autorizada preserva a liquidação original e gera um registro compensatório.
6. Devolução PIX/cartão é **registro manual não fiscal**, não transmissão de ordem financeira; operador precisa processar o reembolso externamente. Não prometer restituição automática.
7. Comparativos históricos, emissão fiscal, compensação de comissões já pagas, devolução de kits/fichas técnicas, fluxos avançados B2B e relatórios gerenciais líquidos por data de compensação exigem P2/P4/P5 e QA adicional. Não promover estes contratos a `covered` prematuramente.

## Endpoints web autenticados (com `branchId` e chave `x-mutation-id` em operações mutáveis)

- `POST /api/v1/tenants/:tenant/sales/:saleId/cancel`: cancelamento de venda concluída, com motivo e `refunds`; exige `sales.cancel`.
- `POST /api/v1/tenants/:tenant/sales/:saleId/returns` e `POST /api/v1/tenants/:tenant/returns`: devolução parcial ou total com `items`, `reason` e `refunds`; exige `sales.cancel`.
- `POST /api/v1/tenants/:tenant/sales/:saleId/returns/quote`: prévia de líquido calculada no servidor (sem gravar), exige `sales.view`. `GET /api/v1/tenants/:tenant/sales/:saleId/returns` e `GET /api/v1/tenants/:tenant/returns`: histórico.
- `POST /api/v1/tenants/:tenant/finance/entries/:entryId/settlements/:settlementId/reverse`: reversão compensatória motivada com `finance.manage`.

## Migração, testes, deploy

A migração **aditiva** `apps/api/migrations/0008_transaction_reversals.sql` deve rodar estritamente após a `0007_stock_transfers.sql`. Não alterar migrations anteriores nem executar contra banco desktop original. Antes de ambiente real: backup, aplicação remota controlada apenas no D1 isolado, verificação de schema, segurança/concorrência/rollback e revisão operacional.

Os testes `apps/api/test/p1-reversals.test.mjs` verificam multiempresa, RBAC, reembolso integral e parcial, idempotência, crédito, comissões, estornos e invariantes SQLite; o CI valida também D1 pelo Wrangler, Workerd e Chromium. A tela web `renderWebReturns` conserva uma única interface e usa a prévia líquida do servidor.

**Condição comercial:** `AUTH_ENABLED=false` permanece desativado para clientes em produção. O código é open source, Node.js/SQLite self-hosted R$ 0, com Cloudflare Free opcional. Nenhum serviço pago é instalado automaticamente.
