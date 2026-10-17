# PDV Artisys Total

Novo produto independente para transformar o **PDV Artisys desktop** em um **SaaS 100% web**, multiempresa e comercializável por assinatura mensal.

> **Estado atual:** base original importada e roadmap técnico definido. **Ainda não é um SaaS funcional.** Não habilitar deploy de produção ou cobrar assinaturas até concluir os gates de segurança, dados, cobrança e QA.

## Onde está o código

- **Snapshot integral e isolado:** [`legacy/pdv-artisys/`](legacy/pdv-artisys) — cópia dos 900 arquivos rastreados do repositório [PDV-ARTISYS](https://github.com/nutricionistaalmeidavh-spec/PDV-ARTISYS), commit `7efea9c61f75be1536a1e516e917218f2b8bf2bf`, da [release publicada v2.0.10](https://github.com/nutricionistaalmeidavh-spec/PDV-ARTISYS/releases/tag/v2.0.10). A GitHub Action conferiu todos os hashes. O `package.json` do snapshot declara `2.0.1` porque o workflow Windows resolve e injeta a versão da release no build; isso não significa que a cópia seja da release 2.0.1.
- **Roadmap:** [`docs/ROADMAP-SAAS-CLOUDFLARE.md`](docs/ROADMAP-SAAS-CLOUDFLARE.md).
- **Evidência da importação:** [`docs/IMPORT-MANIFEST.md`](docs/IMPORT-MANIFEST.md).

## Princípios

1. **Não afetar o PDV Artisys instalado:** releases, licenciamento, bancos, clientes e Workers atuais permanecem inalterados.
2. **Cloudflare isolada:** novos Workers, D1, rotas, secrets e telemetria, sem reaproveitar a conta de licenciamento desktop como banco SaaS.
3. **Core livre e portável:** infra inicial na camada Free da Cloudflare; modo alternativo self-hosted Node + SQLite; serviços pagos só por decisão explícita.
4. **Domínio canônico:** uma fonte de verdade para vendas, estoque, caixa, pagamentos e devoluções, com idempotência e isolamento por empresa.
5. **Assinatura mensal:** permissões por plano e assinatura; integração Asaas **opcional**, sem taxas ou dependências ocultas.
6. **Nenhum deploy implícito:** o snapshot importado contém código desktop e documentação legada, mas **não** é publicado automaticamente; `wrangler.jsonc` antigo existe apenas dentro de `legacy/`.

## Próxima etapa

Implementar **P1 (fundação web)**, depois **P2 (identidade multiempresa)** e **P3 (núcleo transacional)** conforme o roadmap, com testes em cada etapa e deploy de preview isolado.
