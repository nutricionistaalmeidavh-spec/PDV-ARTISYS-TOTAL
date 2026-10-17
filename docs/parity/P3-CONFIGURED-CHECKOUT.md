# P3.2 — variações e adicionais validados no servidor

## Modelo canônico

- Migração aditiva `0014_checkout_configurations.sql` **após** `0013_cash_terminals.sql`. Uma configuração ativa por **produto e empresa** em `checkout_product_configurations`, referenciando a tabela `products` original. Uma coluna `sale_items.configuration_json` congela o **snapshot comercial** da escolha na linha de venda original, protegido pelos gatilhos de imutabilidade pós-venda.
- O cadastro e a edição acontecem em **Produtos e estoque → Variações e adicionais**. O balcão web usa o compositor visual que já existe no desktop, exibindo radio para variações e checkboxes/radio para adicionais.
- `GET /products/:id/configuration`, `PUT /products/:id/configuration`, `POST /products/:id/configuration/price` e `POST /sales/:id/items/configured` usam o serviço de comércio canônico; a cotação e a efetivação validam IDs, obrigatoriedade, limites de seleção, perfil, filial e empresa. **Nunca** aceitam `unitPriceCents` vindo do navegador.
- Os valores de opções e variações compõem o preço unitário, que passa pelas funções canônicas de vendas, desconto e estoque. A alteração posterior do catálogo não reprecifica vendas já concluídas.
- O item registra observação por linha, quantidade e configuração em um **único item**. Alterações de quantidade e exclusão por `sale_item.id` operam na mesma venda.

## Limite de paridade

A estrutura legada `UNIQUE(sale_id,product_id)` em `sale_items` permite apenas **uma configuração distinta de cada SKU por venda**. Quando se tenta adicionar outra variação ou nota do mesmo SKU, o banco **rejeita a operação inteira**, em vez de mesclar opções distintas ou cobrar valor errado. O suporte a duas pizzas com sabores diferentes na mesma venda exigirá mudança de identidade das linhas em migração isolada, com revisão de estoque, histórico, devoluções e impressão. Combos/pizzas especializadas e baixa de insumos por opção também não fazem parte desta entrega.

**checkout-017 continua PARCIAL.** Não afirmar 45 contratos concluídos nem paridade de hardware/fiscal. Não executar migração D1 remota ou alterar `AUTH_ENABLED`, licenças, secrets ou desktop original.

## Gates obrigatórios

Testes de snapshots imutáveis, preço adulterado pelo cliente, seleção obrigatória, opção de outra empresa, permissões, idempotência e conflito de configurações; SQL SQLite, D1 local, Workerd e Chromium responsivo.
