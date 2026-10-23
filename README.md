# PDV ArtiSys Total

Sistema web/PWA para atendimento, vendas, estoque, caixa e gestão. O backend autoritativo usa Cloudflare Workers + D1; Node/SQLite e HTTPS LAN continuam como opção de implantação.

## Critério de entrega

O produto é avaliado pelas próprias jornadas operacionais. A antiga matriz de equivalência com o desktop foi retirada dos gates, scripts e documentação ativa. O histórico anterior continua no Git.

Consulte o [roadmap de prontidão operacional](docs/ROADMAP-OPERACIONAL.md). CI aprovada demonstra os cenários automatizados executados; não substitui homologação no Safari ou uma operação real de restaurante.

## Desenvolvimento e verificação

Node.js 22 ou superior.

- `npm test`: domínio, API, sintaxe web, landing, backup, contratos operacionais, exportações e navegação.
- `npm run test:operations`: preços, seleção de filial, inicialização D1, administração e exportações.
- `npm run test:ux:browser`: regressões de fluxos no navegador com dados isolados.
- `node scripts/web-browser-e2e.mjs`: jornada integrada desktop/mobile em Workerd local; requer Playwright, Chromium e banco local provisionado.
- `npm run build`: valida e gera os assets da aplicação.

## Estrutura

- `apps/web`: interface operacional única.
- `apps/api`: autenticação, autorização, API e migrações incrementais.
- `packages/core`: regras de negócio reutilizadas.
- `apps/api/test/fixtures/regression`: exemplos de entrada/saída e referências executáveis usados por regressões. A origem histórica é preservada para rastreabilidade, sem exigir igualdade de código com o desktop.

Migrações publicadas não devem ser removidas ou renumeradas. Estoque, caixa e financeiro devem permanecer consistentes no servidor; a PWA armazena assets públicos, sem uma fila autônoma de vendas offline.

## Operação

- [Deploy Cloudflare](docs/DEPLOY-CLOUDFLARE.md)
- [Segurança SaaS](docs/SAAS-SECURITY-OPERATIONS.md)
- [Primeiro acesso](docs/SAAS-FIRST-ACCESS.md)
- [Funcionamento offline integrado ao SaaS — arquitetura e estado](docs/FUNCIONAMENTO-OFFLINE-HIBRIDO.md)
- [Servidor HTTPS local existente (sem sincronização D1)](docs/SELFHOST-LAN-HTTPS.md)
- [Periféricos](docs/WEB-PERIPHERALS.md)
- [Proveniência histórica](docs/IMPORT-MANIFEST.md)
