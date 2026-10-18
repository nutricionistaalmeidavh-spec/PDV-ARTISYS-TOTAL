# R1 — aceites executáveis das 21 capacidades (18/10/2026)

## Escopo certificado por código

O inventário canônico do projeto mantém **56 capacidades de desktop**. O subconjunto da rodada **R1 contém 21 capacidades**, e cada uma deve passar um aceite executável por ID para ser marcada `covered` (software). As **68 operações das sete telas são dependências internas**, não 68 outras funcionalidades.

O processo preserva o desktop original fixado em `7efea9c61f75be1536a1e516e917218f2b8bf2bf` **somente para leitura**. As 21 entradas incluem `testedContractRefs` completos e `independentEvidence` que aponta para a implementação e um `test('cap-NNN...')` de verdade.

`apps/api/test/r1-acceptance.test.mjs` **não aceita arquivos existentes como prova**: reexecuta em subprocessos independentes os cenários pertinentes já existentes em `apps/api/test/*.test.mjs` usando SQLite real, autenticação/API e/ou serviços autoritativos. Confere que todos executaram e terminaram com zero falhas; recusa TAP vazio, caso ignorado, falha ou timeout. O frontend original é testado pela etapa Chromium da mesma CI, cobrindo importação XLSX até commit, SKU/leitor HID simulado, reimpressão e editor de atacado.

**Cobertura de software R1 no inventário: 21/21.** Contratos dependentes cobertos no diagnóstico das sete telas: **40/68**. Os 28 contratos restantes pertencem também a outros escopos do sistema; não há afirmação de paridade integral das 56 capacidades (campo `fullSystemClaim` permanece `incomplete`).

| ID | Capacidade R1 | Contratos de base cobertos | Aceite |
|---|---|---|---|
| `cap-004` | Produtos, clientes e vendedores | `products-020`, `checkout-011`, `checkout-012` | `r1-acceptance.test.mjs` |
| `cap-005` | Configurações, variações e combos | `products-031`, `checkout-017`, `checkout-019` | `r1-acceptance.test.mjs` |
| `cap-006` | Produto pai/filho e variantes | `products-031` | `r1-acceptance.test.mjs` |
| `cap-007` | Kits e baixa de componentes | `checkout-019`, `products-021` | `r1-acceptance.test.mjs` |
| `cap-008` | Combos promocionais configuráveis | `checkout-019` | `r1-acceptance.test.mjs` |
| `cap-011` | Ledger e alertas de estoque | `products-021`, `products-027` | `r1-acceptance.test.mjs` |
| `cap-012` | Checkout e pagamentos mistos | `checkout-008` | `r1-acceptance.test.mjs` |
| `cap-013` | Observação de item e comprovante | `checkout-017`, `checkout-018` | `r1-acceptance.test.mjs` |
| `cap-014` | Abertura, suprimento, sangria e fechamento de caixa | `cash-040`, `cash-041`, `cash-042` | `r1-acceptance.test.mjs` |
| `cap-015` | Histórico, devolução e reversão | `history-033`, `history-037`, `history-038` | `r1-acceptance.test.mjs` |
| `cap-016` | Contas a pagar e receber | `finance-047`, `finance-048` | `r1-acceptance.test.mjs` |
| `cap-017` | Relatórios e exportação CSV | `reports-058`, `reports-061` | `r1-acceptance.test.mjs` |
| `cap-018` | Margem com custo histórico | `reports-063` | `r1-acceptance.test.mjs` |
| `cap-019` | Locais, reservas e transferências | `products-029` | `r1-acceptance.test.mjs` |
| `cap-020` | Compras, recebimento parcial e custo médio | `products-029`, `finance-047` | `r1-acceptance.test.mjs` |
| `cap-021` | Pedidos, retirada e entrega | `checkout-017`, `products-029` | `r1-acceptance.test.mjs` |
| `cap-022` | Abrir pedidos e comandas no checkout | `checkout-005` | `r1-acceptance.test.mjs` |
| `cap-023` | Atacado, preço por quantidade e pedidos B2B | `checkout-011`, `checkout-012` | `r1-acceptance.test.mjs` |
| `cap-024` | Política por cliente, mínimo, pagamento e crédito | `checkout-013` | `r1-acceptance.test.mjs` |
| `cap-040` | Variações, códigos de barras e estoque de varejo | `products-025`, `products-031` | `r1-acceptance.test.mjs` |
| `cap-052` | Importação CSV/XLSX prévia e confirmação | `products-032` | `r1-acceptance.test.mjs` |

## Regras de não regressão

1. Nova alteração de cliente/vendedor, itens com peso e configurações de SKU usam identificadores de mutação e transação CAS; replays tardios não reescrevem o carrinho, troca de vendedor ou pagamentos.
2. Estoque, reservas, compras, devoluções, margem, caixa e financeiro escrevem apenas em seus serviços e livros canônicos. Testes incluem tenant/branch, RBAC, reversão, idempotência e falhas.
3. CSV/XLSX passam por prévia/commit da mesma API, com identidades e hashes de importação; XLSX seleciona a aba lógica correta do workbook e recusa referências externas.
4. Testes físicos de impressora, balança ou scanner **não são bloqueio para a prontidão do código**. Equipamentos são ensaios de instalação/ambiente, acompanhados separadamente.

## Limites de afirmação

Esta certificação é de **aceite de software dos fluxos R1 descritos na matriz**, com testes automatizados auditáveis. Não certifica todas as variantes imagináveis, fidelidade visual pixel a pixel, aplicação fiscal ou um dispositivo físico específico. Não libera nem altera o desktop antigo. Outros segmentos/rede/periféricos R2/R3/R4 seguem seus próprios aceites.

Para reproduzir localmente com Node 22: `npm run test:api`, `npm run test:parity` e `npm run audit:r0-r1`. Na CI, os mesmos testes fazem parte de `identity-and-cloudflare`; o ensaio Chromium também é executado como job automatizado.

**Nunca mudar o rótulo de `covered` por preenchimento manual sem referência a teste executado.**
