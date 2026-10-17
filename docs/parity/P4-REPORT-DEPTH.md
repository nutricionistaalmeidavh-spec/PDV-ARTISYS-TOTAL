# P4.2 — Detalhamento, exportação e cobertura de estoque

## Evidência canônica

- `/reports/details`: consulta o **mesmo** `salesHistory` e snapshots comerciais usados pela operação; a filtragem de cliente/vendedor/produto/pagamento ocorre no banco e a paginação é calculada no servidor (não só sobre os itens visíveis).
- `/reports/details.csv`: gera registros por **item de venda**, com SKU, quantidade, preço, pagamentos e vendedor. Suporta exatamente os mesmos filtros, tem escape de valores com risco de injeção em planilha e **recusa truncamento silencioso**: mais de 2.000 vendas ou 10.000 itens exigem intervalo menor. Repetições do total/desconto/reembolso de uma venda são colunas de contexto — **não somar entre itens**.
- `/reports/stock-coverage`: saldo de `stock_positions`, reservas ativas de `inventory_reservations`, consumo líquido de `inventory_movements` (saídas por venda menos retornos) e transferências de `inventory_transfers`. Sem projeção paralela. Cobertura em dias = disponível / (consumo líquido ÷ dias observados); **null** se não há consumo. Entradas e saídas entre filiais são informativas, não duplicam consumo.
- Limite explícito de 1.000 SKUs por consulta, 1–365 dias para janela e data de referência validada.
- **Política de estoque mínimo não cadastrada** nesta fase: `minimumQuantity=null`, `minimumStatus=NOT_CONFIGURED`; nunca mostrar um nível fictício como mínimo definido.

## Interface e exportação

**Relatórios comerciais → Vendas detalhadas** apresenta filtros e paginação; **Cobertura do estoque** compara consumo, reservas e transferências. O botão de exportar CSV usa o detalhamento ao selecionar a respectiva aba, preservando o CSV simples já existente nas outras abas. PDF pelo recurso de impressão do navegador continua disponível, **não é documento fiscal**.

## Limites restantes

Contratos `reports-062`, `reports-066` e `reports-068` passam de `gap` para `partial`, não para `covered`: layouts XLSX equivalentes, análise completa de estoques mínimos configuráveis, previsão sazonal, PDFs detalhados e homologação de volumes grandes e dos relatórios do desktop ainda faltam.

Nenhuma migração nova, banco remoto, alteração em secrets, `AUTH_ENABLED` ou app Electron original. Validar em `npm test`, D1 local, Workerd e Chromium desktop/mobile.
