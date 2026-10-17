# PDV Artisys Total — evolução SaaS do PDV ArtiSys

Este é o **único repositório ativo do produto PDV Total**. O repositório [PDV-ARTISYS](https://github.com/nutricionistaalmeidavh-spec/PDV-ARTISYS) permanece **intocado** e não é upstream de builds, deploys, licenças ou atualizações deste projeto.

## Estrutura do produto

- `packages/core/js/`: serviços **canônicos** de produtos, vendas, eventos, ledger de estoque, caixa, pagamentos, devoluções, restaurantes, relatórios e autorização, vindos do PDV original. Regras existentes são adaptadas, **não reimplementadas em paralelo**.
- `packages/core/server/`: contratos/rotas do servidor original usados **apenas como base de transição**, não publicados pela Cloudflare; rotas de negócio só serão expostas quando houver transações/idempotência corretas no D1.
- `packages/core/shared/` e `packages/core/vendor/`: componentes de domínio e bibliotecas de apoio reutilizados; nenhuma segunda cópia dos arquivos originais.
- `apps/web/`: a **única interface de operação** transferida do renderer existente para transformação no navegador. Não está pronta para servir ao público: seus acessos IPC/Electron deverão ser substituídos pelo cliente HTTP canônico, com testes de equivalência e manutenção de estado.
- `apps/api/`: borda Cloudflare Workers + D1, com opção local Node + SQLite. Hoje tem apenas identidade, empresas, sessões, filiais e permissões.
- `docs/`: migração, UX, limites de segurança e implantação.

**Não existe uma segunda árvore `legacy/` no código ativo**. O commit original importado e os 900 arquivos continuam auditáveis no histórico Git; instaladores, Electron, auto-update Windows/macOS, CI do desktop, licença desktop e artefatos específicos não são carregados aqui.

## Estado atual

A infraestrutura de identidade foi testada com Node, SQLite, Workerd e D1 local. **O PDV web ainda não é operacional**: o renderer transferido não está servido pela API, e as mutations comerciais (venda, caixa, estoque, pagamentos) permanecem fechadas até a migração transacional do núcleo. O login público é desativado por padrão.

**Não cobrar assinaturas nem habilitar clientes enquanto faltarem UI funcional, domínio transacional D1, onboarding, controle de assinatura e QA.**

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
