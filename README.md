# PDV Artisys Total — evolução SaaS do PDV ArtiSys

Este é o **único repositório ativo do produto PDV Total**. O repositório [PDV-ARTISYS](https://github.com/nutricionistaalmeidavh-spec/PDV-ARTISYS) permanece **intocado** e não é upstream de builds, deploys, licenças ou atualizações deste projeto.

## Estrutura do produto

- `packages/core/js/`: serviços **canônicos** de produtos, vendas, eventos, ledger de estoque, caixa, pagamentos, devoluções, restaurantes, relatórios e autorização, vindos do PDV original. Regras existentes são adaptadas, **não reimplementadas em paralelo**.
- `packages/core/server/`: contratos/rotas do servidor original usados **apenas como base de transição**, não publicados pela Cloudflare; rotas comerciais P3 usam a borda única `apps/api/src/commerce-router.mjs`, com idempotência e transações D1.
- `packages/core/shared/` e `packages/core/vendor/`: componentes de domínio e bibliotecas de apoio reutilizados; nenhuma segunda cópia dos arquivos originais.
- `apps/web/`: a **única interface de operação** transferida do renderer existente para transformação no navegador. Servida como assets do Worker na fase P3, com login web, produtos, estoque, caixa, vendas e histórico básico. Recursos restantes do Electron/IPC não são expostos no modo web.
- `apps/api/`: borda Cloudflare Workers + D1, com opção local Node + SQLite. Já tem identidade, empresas, sessões e filiais, além do recorte P3 de produtos, estoque, caixa e vendas com D1 (`0002_commerce.sql`).
- `docs/`: migração, UX, limites de segurança e implantação.

**Não existe uma segunda árvore `legacy/` no código ativo**. O commit original importado e os 900 arquivos continuam auditáveis no histórico Git; instaladores, Electron, auto-update Windows/macOS, CI do desktop, licença desktop e artefatos específicos não são carregados aqui.

## Estado atual — P3 validada em QA

A interface única do PDV (`apps/web/`) agora é empacotada como assets do Worker (`npm run build`). Em ambiente **local Workerd/D1**, passou pelo fluxo de login, cadastro de produto, entrada no estoque, abertura de caixa, venda, pagamento **registrado** e baixa única de estoque. O núcleo reaproveita os cálculos canônicos de preço/pagamento/quantidade e preserva o ledger como fonte do saldo.

**Produção não foi liberada:** `wrangler.jsonc` conserva `AUTH_ENABLED=false`. O sistema **não cobra de fato via PIX/cartão**; registra a forma informada. Falta validar o D1 remoto, concluir o onboarding, assinaturas, recursos avançados, fechamento/rotinas fiscais, impressão e segurança operacional. **Não vender assinaturas nem liberar clientes ainda.**

**Evidência de QA:** 57 testes de núcleo, 14 de API, esquema D1 no Wrangler, Workerd/D1 local, jornada Chromium e tela 390px. O check de build da **Cloudflare no GitHub falhava já na main anterior ao P3**; Actions verde **não comprova deploy remoto**. Para diagnosticar, obter a primeira mensagem de erro em Cloudflare → Workers & Pages → pdv-artisys-total → Builds.

## Segurança e canonicidade

1. **Uma fonte de verdade:** estoque por ledger, evento transacional, venda e caixa originais, sem gravação paralela no frontend nem efeitos repetidos.
2. **Por empresa:** identidade e autorização resolvidas pelo servidor a partir da sessão, sem confiar no tenant enviado por cliente.
3. **Sem renderização concorrente:** evoluir somente `apps/web` e preservar entradas, filtros, carrinho, scroll e estado durante efeitos assíncronos.
4. **Cloudflare isolada:** D1 e R2 novos, sem usar Worker, banco, dados ou licenças do PDV original.
5. **R$ 0 obrigatório para o núcleo inicial**, com Cloudflare Free e alternativa self-hosted; cobrança com Asaas é opção explícita posterior.
6. **Reestruturação incremental comprovada:** scripts `npm run test:core`, `npm run test:api` e dry-run Wrangler passam antes de cada merge.

## Documentação

- [Roadmap de conversão](docs/ROADMAP-SAAS-CLOUDFLARE.md)
- [Setup e deploy Cloudflare](docs/DEPLOY-CLOUDFLARE.md)
- [Proveniência do código original (histórica)](docs/IMPORT-MANIFEST.md)
- [Contrato de fluxo e experiência](docs/ux/P1-P2-CONTRATO-EXPERIENCIA.md)
