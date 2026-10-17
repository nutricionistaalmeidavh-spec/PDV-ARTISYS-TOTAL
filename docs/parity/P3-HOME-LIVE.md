# P3 — início com indicadores reais do comércio web

O painel **Início** no modo web acrescenta uma seção de indicadores reais apenas para usuário autorizado a `reports.view`. Não altera a página clássica de atalhos no desktop original.

`GET /api/v1/tenants/:tenant/reports/home?branchId=...&asOf=YYYY-MM-DD` consulta **as rotinas canônicas** `reports`, `cash` e `reportStockCoverage`, sem contadores persistidos em paralelo. Inclui quantidade de vendas concluídas na data comercial UTC do servidor, faturamento líquido, devoluções, existência de caixa aberto e produtos sem disponibilidade após reservas. O resultado registra `source=CANONICAL_SALES_CASH_STOCK`.

O painel web mostra estado de consulta, resultado ou erro; não inventa valores quando a rede falha. Atualização é feita ao abrir o Início. O carregamento assíncrono não altera uma tela diferente após navegar. O alerta de indisponibilidade é calculado sobre saldo líquido de reservas; ausência de consumo não é declarada previsão de cobertura ou estoque mínimo.

A atualização está limitada a uma filial e a usuário autenticado; endpoint exige `reports.view` e herda a checagem de filial/tenant. Teste de integração modifica venda, caixa e estoque reais e valida diferença entre empresas.

**Paridade `home-003`: partial.** Metas, previsões, alertas financeiros completos, unidade de negócio local da loja e homologação integral com o desktop ainda precisam de recorte posterior. Sem alterar secrets, assinatura, banco D1 remoto, auth ou aplicativo original. CI completa inclui SQLite, D1 local, Workerd e Chromium desktop/mobile.
