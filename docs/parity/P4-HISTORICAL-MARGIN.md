# P4 — margem histórica baseada no custo registrado no fechamento

## Contabilidade operacional, não lucro fiscal

Os saldos e preços continuam exclusivamente no núcleo de vendas/estoque. A funcionalidade lê as alocações imutáveis `sale_stock_allocations` do checkout, além dos lançamentos `sale_return_items` e `sale_returns`, sem criar outra fonte de custo.

`GET /api/v1/tenants/:tenant/reports/margins?branchId=...&from=YYYY-MM-DD&to=YYYY-MM-DD[&productId=...]` exige permissão `reports.view` e filtra exclusivamente a filial da empresa autenticada. Retorna receita líquida, custo identificado, devoluções, quantidade líquida, margem histórica por produto e `missingCostLines`.

- O valor de venda original incorpora o desconto rateado pela mesma função do núcleo do checkout.
- Devoluções reduzem receitas **e** custo identificado na data de sua compensação, proporcional à alocação original; reembolso de períodos antigos entra no período atual.
- O custo por produto é um **snapshot do último custo informado na data da venda**. Compras futuras nunca reescrevem o custo histórico.
- Quando não existe alocação com custo positivo confiável (ex.: estoque antigo/serviços/entrada sem preço), `marginCents=null` e `costBasis=INCOMPLETE`. O sistema não assume custo zero nem inventa lucro real.
- Kits somam os custos das alocações dos componentes de uma venda única, sem descontar estoque em duplicidade.
- Janelas extensas acima de dez mil linhas retornam erro explícito e exigem subdivisão para evitar truncamento silencioso.

A interface original **Relatórios → Margem histórica** no modo web expõe a receita, custo identificado, devoluções e indicação de custo incompleto.

## Pendências para equivalência integral P4

CMV fiscal/contábil, média móvel por saldo/lote, custo legado de todos os clientes, impostos/fretes/despesas rateados, reconciliação com extratos reais de bancos diversos, previsão financeira, relatórios combinados por centro de custo, exportações especializadas e revisão de períodos contábeis. Este contrato continua **parcial** até homologação do desktop original e dos dados.

Sem migrações adicionais, serviços pagos ou alterações em secrets, licenças, Worker remoto ou `AUTH_ENABLED=false`. Gate obrigatório: regressões API/SQLite/D1/Workerd e Chromium desktop/mobile.
