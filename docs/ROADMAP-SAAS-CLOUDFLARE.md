> **Histórico de arquitetura e implantação.** O roadmap operacional de paridade foi substituído por [Roadmap v2 — 56 capacidades](ROADMAP-OPERACIONAL.md). Os 68 contratos são critérios internos, não outra lista de funcionalidades. Este documento NÃO é o quadro de progresso vigente.

# Roadmap — ArtiSys PDV Total (SaaS web Cloudflare)

**Status:** planejamento técnico e importação da base; não é aplicação SaaS pronta.
**Origem imutável:** `nutricionistaalmeidavh-spec/PDV-ARTISYS` — commit `7efea9c61f75be1536a1e516e917218f2b8bf2bf`, correspondente à [release oficial v2.0.10 publicada em 15/10/2026](https://github.com/nutricionistaalmeidavh-spec/PDV-ARTISYS/releases/tag/v2.0.10). O `README.md` e `package.json` da árvore de origem ainda mencionam `2.0.1`, pois o workflow de Windows calcula a nova versão e executa `npm version` no runner durante o empacotamento, sem atualizar automaticamente a branch `main`.
**Destino:** `PDV-ARTISYS-TOTAL`. O código reaproveitável foi movido para `packages/core/` e a única interface para `apps/web/`. A importação íntegra inicial permanece **somente no histórico Git**; não existe aplicação desktop legada paralela na árvore ativa.
**Regra:** NÃO alterar `PDV-ARTISYS`, seu Worker `pdv-artisys`, suas licenças, sua base de clientes ou seus instaladores. Cloudflare SaaS nova, bancos novos, segredos novos e deploy separado.

## Objetivo e limites de custo

Oferecer PDV web responsivo/PWA, acessível pelo navegador (PC, tablet, celular), com login, empresas e filiais separadas, múltiplos operadores, controle de assinatura mensal e gestão centralizada pela ArtiSys, sem exigir instalador e sem depender de servidor local do lojista.

**Núcleo obrigatório livre, autocontido e portável:** Node/TypeScript + Hono (código aberto), SQL compatível com SQLite, migrações versionadas, front-end web sem dependência paga, testes Node/Playwright. Executável no Cloudflare Workers + D1 (faixa gratuita) **e** em implantação própria Node + SQLite (armazenamento de objetos S3 compatível opcional) com adapters e configuração. Não tornar um serviço pago dependência silenciosa.

**Atenção:** a faixa Free da Cloudflare possui limites diários e de armazenamento; excedê-los causa falhas de operação, não escala garantida a R$ 0. Medir uso, alertar e preparar migração/autohospedagem; nunca contratar Workers Paid, R2 com cobrança ou outro serviço pago automaticamente. R2 para imagens/anexos fica condicionado ao provisionamento explícito da faixa gratuita e aos limites, com alternativa de armazenamento local/S3 compatível.

## Arquitetura-alvo

```text
Browser / PWA responsiva (caixa, produtos, estoque, relatórios, admin)
     └── HTTPS → Cloudflare Worker /api (Hono)
                    ├── Auth + sessions + RBAC + tenant resolver
                    ├── Gate de assinatura (entitlements por empresa)
                    ├── Application services / domínio canônico reaproveitados
                    ├── SQL adapter → D1 (Cloudflare) ou SQLite (self-hosted)
                    ├── Object adapter → R2 (opcional) / S3 / filesystem local
                    └── Integrações opcionais: Asaas (webhooks), impressão auxiliar
```

**Um backend autoritativo por operação**: não gravar SQLite do cliente/navegador como fonte da verdade. **Tenant sempre derivado da sessão no servidor**, nunca confiado em `tenant_id` enviado pelo cliente. Terminais acessam a mesma API. Frontend web não pode importar `electron`, `node:fs`, `better-sqlite3` ou IPC.

Estrutura canônica atual: `apps/web` (UI única em adaptação), `apps/api` (API Workers/D1), `packages/core` (serviços, contratos originais, estado e testes canônicos). Evoluir os adaptadores de banco, autenticação, assinatura e contratos nessa estrutura **sem duplicar o núcleo ou criar segundo renderer**. Eliminar os trechos Node/IPC conforme a paridade web for provada.

## Fases de execução e critérios de aceite

| Fase | Prioridade | Entrega | Gate de conclusão |
|---|---|---|---|
| **P0 — Importação e limpeza estrutural** | Concluída | Importação íntegra verificada de 900 arquivos, depois extração única do núcleo e da interface para `packages/core` e `apps/web`; remoção de Electron/instaladores/arquivos exclusivos | Proveniência preservada no Git; fonte original inalterada; regressões do núcleo e build do Worker aprovados |
| **P1 — Fundação web** | Alta | Monorepo mínimo, Worker Hono `/api/health`, web SPA/PWA, dev local, DB abstraído, migrations, GitHub Actions de testes | Roda em dev local grátis, deploy de preview isolado; não alcança serviço desktop |
| **P2 — Contas e empresas** | Alta | `tenants`, `users`, `memberships`, `branches`, `roles`, sessões seguras, onboarding, recuperação e superadmin separados | Testes de isolamento A/B, RBAC por rota, CSRF, rate limit, auditoria, logout/revogação |
| **P3 — Núcleo transacional** | Crítica | Extrair contratos/serviços de catálogo, venda, pagamento registrado, estoque ledger, caixa, devolução, compras e pedidos; SQL adaptado ao D1 | Testes de paridade com dados fixos; venda idempotente; sem saldo negativo ou caixa duplo por retry |
| **P4 — Fluxos operacionais MVP** | Alta | Produtos/variações, clientes, vendas, caixa, estoque, relatórios e exportações; multiusuário em tempo real via revalidação | E2E simultâneo com 2 caixas/2 usuários, cancelamento, devolução, reabertura conforme regras |
| **P5 — UX web/PWA** | Alta | Migrar UI operacional Electron para navegação web desktop/mobile, responsividade e acessibilidade, estados de erro/latência | QA Playwright em PC/tablet/celular, teclado e leitor USB como teclado, instalação opcional PWA |
| **P6 — Assinaturas SaaS** | Alta | `plans`, `subscriptions`, `invoices`, `payment_events`, permissões/limites canônicos, painel ArtiSys de planos e tenants | Sem liberar por criar cobrança; liberar apenas por pagamento confirmado ou concessão manual auditada |
| **P7 — Extras e segmentos** | Média | Alimentação, KDS, QR, atacado, compras avançadas, relatórios complexos, mídias, integrações | Paridade de regras da origem e autorização em API; cenários E2E por vertical |
| **P8 — Operação e publicação** | Crítica | Migração de dados, backups/restauração, exportação, monitoramento de limites Free, políticas LGPD, recuperação de incidentes, documentação comercial | Piloto com dados reais consentidos, rollback ensaiado, zero regressões críticas, observabilidade validada |

### Sequência de trabalho sugerida

1. Fechar P0 e P1 antes de qualquer deploy público de comércio.
2. P2 e P3 bloqueiam produção: **nenhuma venda multiempresa sem isolamento e idempotência testados**.
3. Entregar MVP P4/P5 somente após cobrir venda, estoque e caixa integralmente.
4. Ligar P6 em **modo manual gratuito** inicialmente. Integração **Asaas opcional**, já usada no ecossistema ArtiSys, somente por configuração explícita; avaliar taxas antes de ativar.
5. P7 por partes, respeitando módulos existentes; P8 antes de abrir assinatura comercial a novos lojistas.

## Modelo de dados mínimo (não duplicar fontes de verdade)

- **Identidade:** `tenants`, `branches`, `users`, `memberships`, `roles`, `sessions`, `audit_events`.
- **Comercial:** `products`, `product_variants`, `customers`, `suppliers`, `sales`, `sale_items`, `sale_payments`, `returns`, `sale_sessions`.
- **Estoque:** `inventory_ledger` imutável, `inventory_locations`, `inventory_reservations`, projeções regeneráveis (não um segundo saldo autoritativo).
- **Caixa:** `cash_sessions`, `cash_movements`, `cash_closings` (movimentos associados à sessão original).
- **SaaS:** `plans`, `subscriptions`, `subscription_cycles`, `billing_invoices`, `billing_events` com `provider_event_id` único.
- Toda tabela de negócio relacionada a empresa recebe `tenant_id`, índices por empresa e políticas de acesso em **todas** as consultas e mutações. `branch_id` quando pertinente, mas não substitui `tenant_id`.
- UUID/ULID estável por entidade, versões de linha para concorrência otimista, timestamps UTC e valores monetários em centavos inteiros (sem float).
- `UNIQUE (tenant_id, idempotency_key)` nas operações mutáveis; registrar `request_hash` e `response` da execução concluída. Proteger contra concorrência e retries; D1 `batch`/transações conforme capacidade real comprovada, com testes de corrida.
- Outbox durável para efeitos externos; não acoplar commit de venda ao sucesso de impressão, webhooks ou e-mail.

## Assinatura mensal e acesso

**Separar o pagamento da assinatura ArtiSys do pagamento de vendas do comerciante.** O SaaS não deve processar/guardar dados sensíveis de cartão das compras de balcão.

Estados sugeridos: `TRIAL`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCELLED`; política configurável de carência. Guardas no backend, não só na UI. Em bloqueio, preservar acesso de leitura/exportação e dados do lojista conforme política contratual; não apagar dados automaticamente. Superadmin pode conceder assinatura manualmente, com autor, motivo, período e trilha de auditoria.

**Cobrança zero-dependência:** registro manual de pagamentos/confirmações para testes e pilotos (sem cobrança automatizada), sem depender de serviço terceiro. **Automação de cobrança opcional:** adaptador Asaas com webhook validado, deduplicação por ID, estados de pagamento reais, tratamento de falha, estorno, chargeback e reconciliação. Criar assinatura externa **não** equivale a pagamento confirmado. Toda tarifa e contratação do gateway requer escolha explícita.

## Navegador versus hardware físico

- Leitor USB de código de barras que emula teclado funciona nos inputs da web.
- Impressão não fiscal: primeiro fluxo pelo diálogo do navegador e layout 80 mm; ponte local **opcional** para impressão silenciosa/gaveta/balança/porta COM (o navegador não fornece todos esses recursos de forma uniforme).
- QR público, garçom e KDS podem ser web/PWA com credenciais próprias.
- **Não prometer emissão fiscal**: a origem declara documentos não fiscais. Emissão de NFC-e/NF-e, SAT, SEFAZ e certificados é projeto e conformidade separados.

## Migração da versão instalada

Nunca compartilhar DB do desktop em produção nem fazer sync bidirecional implicitamente. Criar CLI **exportador somente leitura** para SQLite legado; checar schema/versão/manifesto, pré-visualizar contagens, mapear `tenant_id` e `branch_id`, importar com chaves idempotentes em banco novo, preservar IDs/snapshots, auditar saldos, vendas, caixa, devoluções e relatórios. Testar backup/rollback; só executar em cliente real com consentimento e janela de corte.

## Gate de segurança, QA e custo

- Testes unitários do domínio + integração SQL real (D1 local via Wrangler) + testes E2E browser + concorrência dupla + anti-tenant-leak + webhooks duplicados/falsificados.
- Sessões `HttpOnly`, `Secure`, `SameSite`; CSRF nas mutações com cookie; CORS restrito, CSP, rate limiting, logs sanitizados, proteção a força bruta e segregação superadmin/tenant.
- Credenciais exclusivamente em secrets do runtime. Sem transferir `ADMIN_TOKEN`/pepper do Worker legado e sem ler banco de licenças de produção.
- Exportação e exclusão conformes LGPD; backups, restauração testada e limites de retenção. Documentar responsabilidade pelo serviço.
- Painel mínimo: solicitações/dia, leituras e gravações D1, tamanho DB, storage, consumo por tenant, custos e alarmes de limite; testar falha limpa por limite. Sem ativar plano pago sem aprovação explícita.
- GitHub Actions: smoke no PR e QA completo antes de merge; deploy Cloudflare só de novo Worker e D1 depois de aprovação.

## Primeira vertical comercial para MVP

Lojas e balcão simples: produtos, busca/código de barras, clientes, vendas, desconto com permissão, pagamentos registrados manualmente, estoque, caixa, relatórios e 1+ operadores; um tenant com 1 filial inicialmente. Alimentação, atacado, compras e CRM avançado chegam após estabilidade.

## Referências verificadas (17/10/2026)

- Origem: https://github.com/nutricionistaalmeidavh-spec/PDV-ARTISYS
- Cloudflare: https://developers.cloudflare.com/workers/platform/pricing/ ; https://developers.cloudflare.com/d1/platform/limits/ ; https://developers.cloudflare.com/d1/reference/faq/ ; https://developers.cloudflare.com/r2/pricing/
- Asaas: https://docs.asaas.com/reference/criar-nova-assinatura ; https://docs.asaas.com/docs/sobre-os-webhooks
