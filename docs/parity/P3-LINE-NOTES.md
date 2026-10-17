# P3 — Observações em itens da venda canônica

A migração aditiva **0012_sale_item_notes.sql**, aplicada depois de **0011_product_media.sql**, adiciona `sale_items.note` (até 240 caracteres). Nenhuma nova tabela de produtos, estoque paralelo ou duplicação de linha: a nota pertence à mesma `sale_items.id` usada no balcão, histórico, comissões e devoluções.

## Fluxo

No balcão web, o botão **Observação** em cada linha abre o formulário para cadastrar ou limpar a nota. A API `PUT /api/v1/tenants/:tenant/sales/:saleId/items/:itemId/note?branchId=...` valida autenticação e `sales.create`, escopo da empresa/filial, status OPEN, texto e identificador de mutação. A gravação da nota e auditoria são atômicas, idempotentes e passam pelos gatilhos já existentes para proibir edição de linhas de vendas fechadas.

O texto é mostrado também nos snapshots da venda/histórico, e escapado pela UI para evitar HTML. Alterar nota **não** altera preço, total, quantidade, baixa de estoque ou comissão.

## Limite de paridade

O desktop ainda tem configurações mais completas (adicionais, variações de preparo, pizzas e combinações). O cadastro web agrega unidades do mesmo produto na mesma linha; não é seguro permitir múltiplas configurações diferentes sem identidade distinta de cada linha e snapshot dos adicionais. Portanto **checkout-017 fica partial**, não covered.

Nenhuma migração aplicada no D1 remoto, deploy, credenciais ou alterações no Electron original. Testes verificam isolamento, idempotência, texto inválido e imutabilidade pós-conclusão. Executar a migração em ambiente real somente após backup e homologação.
