# PDV Artisys Total

Novo produto independente para transformar o **PDV Artisys desktop** em um **SaaS 100% web**, multiempresa e comercializável por assinatura mensal.

> **Estado atual:** P0 concluída; P1/P2 têm uma **API de identidade** construída e testada, com a mesma autorização canônica do PDV desktop. **Ainda não é um PDV web nem SaaS comercial.** Não habilitar cobranças, vendas ou login público antes de concluir os gates de dados, segurança e operação.

## Onde está o código

- **Snapshot integral e isolado:** [`legacy/pdv-artisys/`](legacy/pdv-artisys) — cópia dos 900 arquivos rastreados do repositório [PDV-ARTISYS](https://github.com/nutricionistaalmeidavh-spec/PDV-ARTISYS), commit `7efea9c61f75be1536a1e516e917218f2b8bf2bf`, da [release publicada v2.0.10](https://github.com/nutricionistaalmeidavh-spec/PDV-ARTISYS/releases/tag/v2.0.10). A GitHub Action conferiu todos os hashes. O `package.json` do snapshot declara `2.0.1` porque o workflow Windows resolve e injeta a versão da release no build; isso não significa que a cópia seja da release 2.0.1.
- **API de identidade:** [`apps/api/`](apps/api) — Workers + D1 ou Node + SQLite, sem mutações comerciais.
- **Deploy Git Cloudflare:** [`wrangler.jsonc`](wrangler.jsonc), [`package.json`](package.json) e [`docs/DEPLOY-CLOUDFLARE.md`](docs/DEPLOY-CLOUDFLARE.md).
- **Roadmap:** [`docs/ROADMAP-SAAS-CLOUDFLARE.md`](docs/ROADMAP-SAAS-CLOUDFLARE.md).
- **Evidência da importação:** [`docs/IMPORT-MANIFEST.md`](docs/IMPORT-MANIFEST.md).

## Princípios

1. **Não afetar o PDV Artisys instalado:** releases, licenciamento, bancos, clientes e Workers atuais permanecem inalterados.
2. **Cloudflare isolada:** novos Workers, D1, rotas, secrets e telemetria, sem reaproveitar a conta de licenciamento desktop como banco SaaS.
3. **Core livre e portável:** infra inicial na camada Free da Cloudflare; modo alternativo self-hosted Node + SQLite; serviços pagos só por decisão explícita.
4. **Domínio canônico:** uma fonte de verdade para vendas, estoque, caixa, pagamentos e devoluções, com idempotência e isolamento por empresa.
5. **Assinatura mensal:** permissões por plano e assinatura; integração Asaas **opcional**, sem taxas ou dependências ocultas.
6. **Deploy separado:** a Cloudflare pode publicar automaticamente **somente a API nova** após o merge em `main`; o snapshot de desktop continua isolado dentro de `legacy/` e nunca é executado no Worker.

## Próxima etapa

O núcleo de identidade multiempresa existe e possui testes Node, SQLite e Cloudflare Workerd. Faltam o provisionamento operacional de D1, o fluxo de onboarding, a proteção contra abuso para acesso público, a adaptação transacional de **P3** e a futura interface web **sem renderer/mutations duplicados**. O Worker de identidade **não permite venda, caixa, estoque, cobrança ou novos cadastros públicos**. Publicar o Worker não autoriza sua comercialização.
