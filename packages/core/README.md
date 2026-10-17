# Núcleo canônico do PDV Total

Esta é a **única implementação mantida** das regras do PDV, transferida do repositório original. A versão importada foi a release desktop 2.0.10 (commit `7efea9c61f75be1536a1e516e917218f2b8bf2bf`). O código original não é mais atualizado nem consultado automaticamente.

A estrutura `js/`, `server/`, `shared/`, `vendor/` preserva o grafo de importações do domínio para facilitar o trabalho de paridade em vendas, caixa, ledger de estoque, idempotência, eventos, devoluções e relatórios. `server/` contém contratos de transição do Node original, **não uma segunda API SaaS**; a Cloudflare executa apenas `apps/api/src/worker.mjs`.

**Limites técnicos ainda abertos:** `js/core/pdv-runtime.js` e serviços de persistência assumem SQLite síncrono e funções Node, incompatíveis com D1/Workers sem adaptação transacional. Eles são usados nos testes de caracterização, nunca importados em lote pelo Worker. A próxima implementação deverá extrair/adaptar o domínio com evidências de paridade, sem criar outros serviços de venda/caixa/estoque, sem mutações duplicadas e sem publicar endpoints que usem o banco local.

Comandos na raiz: `npm run test:core` e `npm run test:api`. Arquivos de origem descartados (Electron, instaladores, updater desktop) permanecem apenas no histórico do Git, não como aplicação legada paralela.
