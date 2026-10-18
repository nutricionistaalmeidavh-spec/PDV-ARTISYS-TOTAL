# PDV Artisys Total — evolução SaaS do PDV ArtiSys

Este é o **único repositório ativo do produto PDV Total**. O repositório [PDV-ARTISYS](https://github.com/nutricionistaalmeidavh-spec/PDV-ARTISYS) permanece **intocado** e não é upstream de builds, deploys, licenças ou atualizações deste projeto.

## Estrutura do produto

- `packages/core/js/`: serviços **canônicos** de produtos, vendas, eventos, ledger de estoque, caixa, pagamentos, devoluções, restaurantes, relatórios e autorização, vindos do PDV original. Regras existentes são adaptadas, **não reimplementadas em paralelo**.
- `packages/core/server/`: contratos/rotas do servidor original usados **apenas como base de transição**, não publicados pela Cloudflare; rotas comerciais P3 usam a borda única `apps/api/src/commerce-router.mjs`, com idempotência e transações D1.
- `packages/core/shared/` e `packages/core/vendor/`: componentes de domínio e bibliotecas de apoio reutilizados; nenhuma segunda cópia dos arquivos originais.
- `apps/web/`: a **única interface de operação** transferida do renderer existente para transformação no navegador. Servida como assets do Worker na fase P3, com login web, produtos, estoque, caixa, vendas e histórico básico. Recursos restantes do Electron/IPC não são expostos no modo web.
- `apps/api/`: API autoritativa em Cloudflare Workers/D1 **ou** no Node + SQLite self-hosted; no modo local, entrega a **mesma PWA** do build sem Cloudflare. Já tem identidade, empresas, sessões e filiais, além do recorte P3 de produtos, estoque, caixa e vendas com D1 (`0002_commerce.sql`).
- `docs/`: migração, UX, limites de segurança e implantação.

**Não existe uma segunda árvore `legacy/` no código ativo**. O commit original importado e os 900 arquivos continuam auditáveis no histórico Git; instaladores, Electron, auto-update Windows/macOS, CI do desktop, licença desktop e artefatos específicos não são carregados aqui.

## Estado atual — P3, P4 e P5 (fluxos web)

- **P3:** balcão, produtos, estoque por ledger, venda e pagamentos registrados, abertura, suprimento, sangria e fechamento reconciliado do caixa por filial; regras de cálculos importadas do núcleo canônico.
- **P4:** contas manuais a pagar/receber, liquidação parcial e consulta de saldo; relatórios de vendas, pagamentos, produtos, estoque, caixa e financeiro; exportação CSV, impressão/PDF no navegador. Nenhuma conta manual replica pagamentos de vendas.
- **P5:** o **mesmo renderer** com navegação adaptativa para desktop/celular, layout mobile, manifesto instalável, ícones 192/512 e Service Worker que guarda **somente arquivos públicos**. Offline é apenas casca de interface: a API e mutações exigem internet; não há fila offline.

**Status comercial:** a aplicação está configurada com `AUTH_ENABLED=false` em produção; login e mutações continuam bloqueados. A aprovação dos testes em Workerd/D1 local não equivale a aprovação de onboarding, migrações remotas, segurança, cobrança ou fiscal. **Não comercializar ainda** sem os gates da [implantação](docs/DEPLOY-CLOUDFLARE.md).

**Fora do escopo concluído:** cartão/PIX são *formas informadas*, não captura pelo adquirente; emissão NFC-e/NF-e, hardware/impressão térmica silenciosa, assinaturas, importação histórica, gestão avançada de clientes/restaurante/atacado e reconciliação bancária automática ainda exigem entregas próprias.

**Evidências exigidas para merge:** `npm run test` (núcleo + API), `npm run build` e `npm run check:web`, migrations no D1 local, dry-run Wrangler, testes Workerd e jornada Chromium incluindo caixa/financeiro/relatórios/PWA. Código do PDV Artisys original: não modificado.

## Segurança e canonicidade

1. **Uma fonte de verdade:** estoque por ledger, evento transacional, venda e caixa originais, sem gravação paralela no frontend nem efeitos repetidos.
2. **Por empresa:** identidade e autorização resolvidas pelo servidor a partir da sessão, sem confiar no tenant enviado por cliente.
3. **Sem renderização concorrente:** evoluir somente `apps/web` e preservar entradas, filtros, carrinho, scroll e estado durante efeitos assíncronos.
4. **Cloudflare isolada:** D1 e R2 novos, sem usar Worker, banco, dados ou licenças do PDV original.
5. **R$ 0 obrigatório para o núcleo inicial**, com Cloudflare Free e alternativa self-hosted; cobrança com Asaas é opção explícita posterior.
6. **Reestruturação incremental comprovada:** scripts `npm run test:core`, `npm run test:api` e dry-run Wrangler passam antes de cada merge.

## Execução self-hosted gratuita

O núcleo pode rodar em localhost com Node 22+ e SQLite, sem Cloudflare: execute `npm run build`, depois `cd apps/api && npm run dev`, e abra http://127.0.0.1:4175/. O acesso comercial permanece desabilitado por padrão até provisionamento e QA. Consulte [instalação self-hosted](docs/SELF-HOSTED.md). Não exponha HTTP local à LAN sem TLS.

## Documentação

- [Roadmap vigente de paridade](docs/ROADMAP-PARIDADE-56.md)
- [Setup e deploy Cloudflare](docs/DEPLOY-CLOUDFLARE.md)
- [Proveniência do código original (histórica)](docs/IMPORT-MANIFEST.md)
- [Contrato de fluxo e experiência](docs/ux/P1-P2-CONTRATO-EXPERIENCIA.md)

## Progresso e roadmap atual (56 capacidades)

A **fila única de implementação** é composta por **56 capacidades do desktop**; os 68 contratos das sete telas são verificações internas associadas a elas, não um segundo backlog. Use `npm run report:parity` para visualizar os quatro estados: copiado integralmente, copiado parcialmente, não copiado/não demonstrado e implementado aguardando auditoria de código. **Atenção:** ausência de prova (`gap`) não significa necessariamente ausência de código.

- [Roadmap operacional vigente — 56 capacidades, prioridades R0–R5 e política de migrations](docs/ROADMAP-PARIDADE-56.md)
- [Auditoria R0 e execução R1 — diagnóstico dos 21 itens e testes de suspensão/retomada](docs/parity/R0-R1-EXECUTION-20261018.md)
- Auditoria atualizada: `npm run audit:r0-r1` (56 capacidades e detalhamento dos 21 do R1, sem promoção automática de paridade).
- [Roadmap original de arquitetura/Cloudflare (histórico)](docs/ROADMAP-SAAS-CLOUDFLARE.md)

## Auditoria de paridade desktop/web

A matriz operacional em `docs/parity/desktop-web-matrix.json` verifica 68 contratos de sete telas e o inventário em `docs/parity/desktop-capability-inventory.json` cobre **todas as 56 capacidades publicadas** no manifesto `release/capabilities.json` do desktop original, fixado em `7efea9c`. A cópia verificável por SHA Git fica em `docs/parity/desktop-capabilities-baseline.json`. O escopo estendido não é prova de que todos os subfluxos já estejam catalogados ou equivalentes.

A paridade permanece **incompleta**. `npm run test:parity` executa testes de regressão do gate e valida links para as asserções dos testes Node/Chromium, a integridade de IDs, responsáveis, pré-requisitos e reivindicações; a CI executa os testes de domínio e E2E correspondentes. **Não** equiparar a existência de um arquivo a funcionalidade comprovada; testes automatizados de periféricos com simuladores e revisão independente de código demonstram conclusão de software; inspeção física é opcional e não bloqueia `covered`. Os estados `complete` só são aceitos com cobertura 100% do escopo e atestado rastreável de revisão/CI. Ver `docs/parity/P0-AUDIT-PLAN.md`.

## Auditoria de paridade do desktop

A paridade não é declarada automaticamente com build verde. A matriz de 68 contratos das telas e o inventário de 56 capacidades são independentes. O P0 gera cenários de comparação e artefatos auditáveis, preservando o código desktop fixado somente como referência. Use `npm run test:parity` para executar as verificações ou `npm run audit:parity` para gerar os relatórios em `qa-artifacts/parity/`. Cenários sem evidência permanecem pendentes, inclusive os que possuem testes parciais de API. Consulte `docs/parity/P0-AUDIT-PLAN.md`.

### HTTPS na rede local (P6, implantação self-hosted gratuita)

A interface web pode usar a mesma API autoritativa em **Node.js + SQLite local** sem Cloudflare e sem mensalidade. A implantação LAN exige TLS com certificado confiável nos terminais, autenticação habilitada explicitamente, firewall de rede interna e banco novo com migrações rastreadas. Início: `npm run serve:lan` após configurar as variáveis da documentação.

- [Manual de instalação HTTPS LAN, provisionamento e recuperação](docs/SELFHOST-LAN-HTTPS.md)
- `apps/api/src/local-migrations.mjs`: migrações transacionais com checksum; banco antigo sem histórico exige migração assistida (sem replay perigoso).
- `apps/api/src/https-lan-server.mjs`: PWA e API na mesma origem HTTPS, cookies Secure, validação de Host e CSRF na API.
- `apps/api/test/https-lan-server.test.mjs`: teste real com TLS temporário e 3 contas em 2 empresas; é prova automatizada de integração, não ensaio presencial (que é opcional).
- A aplicação precisa da API local acessível para confirmar transações: PWA offline mantém apenas a casca pública, não vendas.

