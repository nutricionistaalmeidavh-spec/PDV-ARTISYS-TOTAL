# P5 — relatórios e experiência operacional

**Status: parcial. A paridade total NÃO está certificada.**

## Diretriz arquitetural (R$ 0)

- Interface única: apps/web/reporting-v2.js; API canônica: apps/api; núcleo: packages/core.
- Exportação XLSX nativa e gratuita no navegador: apps/web/report-xlsx.js (OOXML/ZIP sem SaaS e sem biblioteca de terceiros).
- Node + SQLite self-hosted é a implantação local possível; Cloudflare/D1 e provedores pagos não são dependências obrigatórias do núcleo.
- Sem fonte paralela para venda, saldo, custo, caixa ou comissões.

## Entregas desta branch

1. XLSX real para as abas da interface web, com valores monetários numéricos e texto escapado. Textos iniciando com =, +, - ou @ não podem executar fórmulas.
2. Vendas detalhadas: XLSX convertido do CSV **completo e filtrado pela API**; não apenas da página atual. Limites autoritativos de 2.000 vendas/10.000 itens retornam erro explícito em vez de truncamento.
3. Demais abas: exportação dos dados disponibilizados à aba pelo backend, com ressalva de que não implica equivalência do layout desktop.
4. PDF via recurso nativo de impressão, não documento fiscal.
5. Sessão do navegador preserva somente a aba de relatórios e o intervalo de datas por empresa/filial. Não armazena agregados, dados de clientes ou tokens.
6. Regressões de XML/ZIP/CSV/injeção de fórmulas, E2E Chromium para XLSX e navegação.

## Dez frentes do P5 e pendências

| Frente | Exigência para covered | Situação |
|---|---|---|
| Margens | Custo histórico, devoluções e conferência desktop | Parcial |
| CMV histórico | Custos por período/lote e casos sem custo | Parcial |
| Ranking | Metas, estornos e vendedores por filial | Parcial |
| Comissões | Livro de comissão, pagamentos e reversões | Parcial |
| Comparativos | Períodos válidos, ausência de base e tendências | Parcial |
| Cobertura de estoque | Reserva, transferência, mínimos cadastrados | Parcial |
| Exportação | XLSX/PDF completos e layout/volume equivalente | Parcial, XLSX implementado |
| Dashboard por perfil | Permissões, indicadores e avisos equivalentes | Parcial |
| Navegação | Aba/período, demais filtros, foco e scroll | Parcial, aba/período implementados |
| Multidispositivo | Navegador desktop/mobile e periféricos/LAN aplicáveis | Parcial |

## Critérios obrigatórios para avanço de status

1. Equivalência ao desktop e regras canônicas compartilhadas.
2. Testes reais de persistência, isolamento entre empresas e autorização por perfil.
3. Idempotência, integridade financeira/estoque e concorrência nos fluxos mutáveis.
4. UI web desktop/mobile testada, incluindo navegação e estado.
5. Homologação física de periféricos e rede, quando aplicável.
6. GitHub Actions aprovado no SHA exato, evidências rastreáveis e revisão independente.

**Meta não certificada:** sete telas 68/68 (relatórios 11/11, início 4/4) e 56 capacidades publicadas. Não alterar os estados da matriz apenas pela existência de arquivos, telas ou testes.
