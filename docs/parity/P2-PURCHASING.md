# P2.1 — pedidos de compra, recebimento parcial e custo de aquisição

## Contrato canônico

- Nova migração **aditiva** `0010_purchase_orders.sql`, após `0009_catalog_inventory.sql`. Não alterar as migrações já aplicadas.
- `purchase_orders` e `purchase_order_lines` contêm documentos comerciais **imutáveis**, referenciados a fornecedor, empresa, filial e produto existente. Não existe um segundo estoque.
- Recebimentos parciais são transações atômicas; `purchase_receipts` e `purchase_receipt_lines` registram a origem, com movimento físico **uma única vez** no `inventory_movements` e custo imutável no `purchase_cost_history`. Acima do pedido, o banco rejeita a operação independentemente do cliente.
- A situação do pedido é **derivada** das quantidades recebidas: `OPEN`, `PARTIAL`, `RECEIVED` ou `CANCELLED`. Cancelar saldo pendente nunca apaga o que entrou em estoque.
- `mutation_id` e controle de concorrência evitam duplicações entre terminais e reenvios. Autorização de visualização do estoque versus ajuste.
- Custo médio informado é **média de aquisição ponderada pela quantidade das entradas na filial**, não custo médio móvel contábil dos saldos nem CMV. Histórico e último custo permanecem separados.

## Interface

No navegador: **Produtos e estoque → Pedidos de compra**. Crie um pedido com fornecedor, itens, quantidades e preços de custo; depois selecione o pedido para registrar apenas as unidades recebidas. O menu de produtos continua sendo a interface canônica.

## Validação e limites

Rodar `npm test` (Node 22+), além das migrações locais D1 0001–0010, smoke Workerd, Chromium desktop/mobile e novos testes de concorrência, isolamento, lançamento imutável e cancelamento parcial. Não marcar contrato como `covered` por ter uma rota nova sem homologação contra desktop.

**Ainda pendente da P2 integral:** importação em lote CSV/XLSX com prévia e correção linha a linha; imagens R2 e política de privacidade/expiração; estoque multi-localização; custo médio móvel sobre consumo/vendas/devoluções; integração de pedidos a contas a pagar; validação real de periféricos.

## Deploy e segurança

O CI testa bancos descartáveis e **não migra D1 remoto**. Exigir backup, ensaio de restore, verificação de sequência 0001→0010 antes de migração real. `AUTH_ENABLED=false` permanece sem liberar comercialização. Nenhum dado do desktop original é modificado; Node+SQLite self-hosted gratuito e Cloudflare Free opcional.
