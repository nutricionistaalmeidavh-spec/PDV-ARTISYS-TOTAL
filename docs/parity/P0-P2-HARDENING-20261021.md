# P0–P2 — endurecimento de financeiro, histórico e caixas (21/10/2026)

## Referência canônica
- SaaS/PWA: este repositório, branch `feat/p4-p3-p2-parity-hardening-20261021` (integração somente após CI no SHA exato).
- Desktop imutável: `PDV-ARTISYS@7efea9c61f75be1536a1e516e917218f2b8bf2bf`.
- Fonte do fechamento: `js/domains/cash/cash-rules.js` do desktop, **Git blob `1141be41b2898890b42ccc77f4554ac483357c3c`**. O teste recalcula o blob SHA-1 com cabeçalho Git e executa o arquivo byte a byte igual em `packages/core/js/domains/cash/cash-rules.js`.

## P0 — financeiro, saldo de carteiras e plano de contas
- A migration aditiva `0040_wallet_operations.sql` cria somente o livro **operacional de carteiras não bancárias**, com entrada/saída/saldo inicial, transferências em dois registros atômicos, guarda SQL contra saldo negativo, um único saldo inicial, unicidade por carteira+mutationId, operadores, razões e registros imutáveis. Não apaga nem reinterpreta a migration `0039`.
- Diferenciar **caixa do PDV** (`cash_sessions`), **extrato bancário** (`finance_bank_transactions`), **financeiro canônico** (`finance_entries`/`finance_settlements`) e **carteiras operacionais** (`finance_wallet_movements`). Movimentos das carteiras **NÃO** são receitas, despesas, transferências bancárias conciliadas, baixas automáticas ou escrituração fiscal. O saldo não bancário é a soma do livro; a conta bancária mostra somente o líquido dos extratos importados, jamais saldo confirmado do banco.
- `GET /finance-advanced/entries/search`: filtros reais no servidor de descrição, natureza, situação, intervalo de vencimento, categoria, centro de custo, grupo da DRE, conta bancária ligada a uma conciliação, paginação e isolamento por filial. A UI deixa classificar a própria conta via rota canônica `dre/classify/:entryId`.
- Conciliação existente mantém `match` e `link`, evitando baixa duplicada. **Não** declarar rateio de uma linha bancária entre vários lançamentos, aceite automático de sugestões, reversão de conciliação imutável nem saldos bancários reais sem suporte específico.

## P1 — histórico de vendas e caixa
- Pesquisa de opções por nome/ID feita no servidor, inclusive quando há mais de 1.000 operadores ou clientes históricos; opções iniciais limitadas não escondem registros definitivamente.
- Suíte `apps/api/test/p1-reversals.test.mjs` testa volume de 1.050 operadores, consulta filtrada, paginação além da primeira milhar, isolamento entre empresas e busca ambígua por prefixo.
- Cenário com dois terminais, venda em A, encerramento de A, compensação em B, reenvio idempotente, fechamento de B e leitura dos dois livros, sem mover estorno para sessão já encerrada.
- O ensaio não substitui testes de impressão/gaveta real, duas máquinas reais, conexão interrompida durante persistência ou restore ensaiado de backup.

## P2 — comparação independente e fronteira da prova
- Ensaio nominal de fechamento: fundo inicial **R$10,00**, suprimento **R$5,00**, sangria **R$2,00**, venda dinheiro **R$15,00**, contagem **R$28,00**. Executa a regra *real* do desktop pinado e compara com abertura, operação, fechamento e auditoria do SQLite/API. Esperado R$28,00, divergência R$0,00.
- API testa isolamento, idempotência e conservação de saldos em carteiras. Browser Chromium testa abertura, transferência, extrato operacional, filtros e navegação sem remover rotas de acesso.
- **A matriz `desktop-web-matrix.json`, o inventário das 56 capacidades e `scenario-evidence.json` preservam as classificações** até que as dimensões nominal, autorização, falha/recuperação, isolamento e comparações reproduzíveis sejam cobertas para o respectivo contrato inteiro. Não promover automaticamente `history-035`, `cash-043/044/045` nem `finance-051/053/054/056/057`.
- Este relatório é um *incremento verificável* e não certificado geral de 496 cenários, 68 contratos ou 56 capacidades.

## Gate antes de integrar
`npm run build`, `npm run test:parity`, `npm run test:core`, `npm run check:web`, `npm run check:landing`, `npm test` na API com SQLite, migrations D1 locais inclusive `0040`, smoke self-hosted, Chromium com capturas de carteiras e caixa, e gate do Windows. Confirmar SHA do head verde e então merge com rollback.
