# P5 — evolução de relatórios operacionais: evidência e limites

## Implementação desta branch
- **Mínimos físicos por filial:** `0016_inventory_minimum_levels.sql` cria política declarativa por produto e filial, sem criar projeção paralela de saldo. `PUT /reports/stock-minimum` exige `inventory.adjust`, valida quantidades com 3 decimais, inclui trilha idempotente em `commerce_mutations`, rejeita outros tenants e permite remover explicitamente o mínimo com `null`.
- **Cobertura real:** o relatório cruza mínimo cadastrado com disponibilidade após reservas, distinguindo `BELOW_MINIMUM`, `AT_MINIMUM`, `ABOVE_MINIMUM` e `NOT_CONFIGURED`. Sem política cadastrada, não fabrica alertas.
- **Tendência diária:** `GET /reports/daily-trend` devolve série de até 90 dias derivada de vendas concluídas, estornos realizados e dias sem lançamentos. Receita e devoluções são segregadas por data de evento. Não altera histórico nem duplica escrituração.
- **UX de relatórios:** formulários web de estoque mínimo com autorização, série diária, datas comerciais de loja e aba acessível por teclado. A requisição mais antiga não pode sobrescrever uma navegação posterior na mesma tela.

## Evidências
- Testes da API cobrem autorização, repetição de mutation ID, mínimos 0/indefinidos, limite de 3 decimais, segregação entre empresas/filiais e tendência com dias sem movimentos.
- E2E Chromium exercita o gráfico tabular diário e o fluxo de salvar/remover estoque mínimo no mobile.
- D1 local recebe a migration `0016` na CI antes de Workerd; o servidor self-hosted aplica a mesma migration SQLite.
- Núcleo gratuito em Node/SQLite local, sem Cloudflare, APIs externas, componentes pagos ou dependência de rede.

## Paridade completa: exigências que não podem ser omitidas
Esta entrega **não conclui automaticamente** todos os contratos P5. Ainda são necessárias:
- Comparação independente contra o desktop fixado, incluindo regras exatas de CMV, margens históricas, comissões e layout dos relatórios.
- Volumes altos, todos os filtros/atalhos, testes de múltiplos dispositivos com foco e scroll e revisão de políticas de permissão.
- Homologação física quando periféricos, impressão silenciosa e LAN participam dos fluxos.
- Revalidação dos 68 contratos e 56 capacidades publicadas, com GitHub Actions aprovado no commit exato e evidência independente.

A matriz permanece em estado `incomplete` até que **todos** os critérios aplicáveis estejam realmente satisfeitos; aumentar uma contagem sem teste não é conclusão.
