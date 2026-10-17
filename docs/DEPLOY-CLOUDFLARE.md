# Implantação do PDV Artisys Total na Cloudflare

Este Worker contém identidade P1/P2 e fluxos operacionais P3–P5 (catálogo, ledger de estoque, caixa reconciliado, vendas, financeiro manual, relatórios e PWA instalável). **Ainda não é um SaaS pronto para clientes ou assinatura recorrente.**
O PDV Artisys original está preservado **somente em seu próprio repositório**. Neste repositório, o núcleo reaproveitado vive em `packages/core/` e a única UI sob adaptação em `apps/web/`. Electron e instaladores desktop não são publicados aqui.

## Integração do GitHub

Na Cloudflare, em **Workers & Pages → pdv-artisys-total → Configurações → Builds**, confira:

| Configuração | Valor |
| --- | --- |
| Repositório | `nutricionistaalmeidavh-spec/PDV-ARTISYS-TOTAL` |
| Branch de produção | `main` |
| Diretório raiz | `/` |
| Nome do Worker | `pdv-artisys-total` |
| Build | `npm run build` |
| Deploy | `npx wrangler deploy` |
| Preview | `npx wrangler preview` |

`wrangler.jsonc` da raiz é a **única fonte canônica de configuração**. Não existe configuração `legacy/` ativa neste repositório. O merge em `main` aciona o serviço de builds da Cloudflare **se a conexão Git estiver ativa e o build do painel estiver correto**; GitHub Actions executa apenas QA e não publica uma segunda cópia.

## D1, R2 e segredos

O Worker declara o D1 **`DB`** com nome **`pdv-artisys-total`** e um binding R2 **`FILES`** reservado. São recursos novos e separados dos serviços de licença do PDV Artisys desktop. Wrangler 4 aceita auto-provisionamento sem IDs fictícios; o ID real pode permanecer somente no ambiente Cloudflare. Confira os bindings reais em **Settings → Bindings** antes de ativar clientes.

- O deploy **não executa automaticamente** migrações no D1 remoto. **Ordem obrigatória do banco canônico:** `0001_identity.sql` → `0002_commerce.sql` → `0003_cash_finance.sql` → `0004_advanced_finance.sql` → `0005_vertical_parity.sql` → `0006_desktop_parity.sql` → `0007_stock_transfers.sql` → `0008_transaction_reversals.sql` → `0009_catalog_inventory.sql`. Faça backup e aplique apenas os arquivos faltantes no D1 isolado `pdv-artisys-total`; nunca execute estas migrações no banco/licenciamento do aplicativo desktop. Em banco **novo e isolado**, aplique em ordem `apps/api/migrations/0001_identity.sql`, `apps/api/migrations/0002_commerce.sql` e `apps/api/migrations/0003_cash_finance.sql` e `apps/api/migrations/0004_advanced_finance.sql` (Cloudflare D1 Console ou `wrangler d1 execute pdv-artisys-total --remote --file <arquivo>`). Nunca execute no D1 do PDV original. Validar backup e o estado do banco antes de migrar dados reais.
- Antes da migração, `/api/v1/health` devolve **503 setup-required**; depois dela, **200 identity-ready**.
- `FILES` ainda não lê nem grava anexos. Não contratar plano pago automaticamente para habilitar R2.
- **Não existe `CLOUDFLARE_API_TOKEN` necessário no código**. O build Git autenticado e os bindings da plataforma são suficientes. Nunca versionar tokens de conta no GitHub.
- Senhas: **PBKDF2-SHA256 com 100.000 iterações**; esse teto pertence ao WebCrypto do Workers, não ao número de operações D1 nem a uma secret.
- Sessões: token aleatório de 256 bits; o banco armazena apenas o SHA-256; no HTTPS a sessão usa cookie HttpOnly/Secure.

## Bloqueio intencional para acesso público

O `wrangler.jsonc` define **`AUTH_ENABLED=false`**, portanto login responde 503 sem persistir tentativas de autenticação. Este é o estado seguro para um Worker cujo frontend P3 e backend transacional estão sob QA e ainda não têm onboarding de clientes, recuperação de senha, defesa de abuso e monitoramento de produção. A interface estática pode ser carregada, mas **login e operações comerciais são bloqueados** no servidor. Não há cobrança online integrada. Ativar login somente após gates de segurança e schema remoto verificado.

## Verificação de entrega

- Código: `npm run build`, `cd apps/api && npm test`.
- A paridade avançada de bancos/recorrências/DRE depende de `0004_advanced_finance.sql` aplicado no banco D1 de cada ambiente antes de liberar o módulo. Importação OFX/CSV é manual, com prévia local; não há integração Open Banking automatizada nem custo obrigatório de terceiros.
- Worker: `npx wrangler deploy --dry-run`.
- Testes de integração: GitHub Actions `Verify SaaS canonical foundation` roda Wrangler/Workerd, D1 local, PBKDF2, isolamento de empresa, ciclo completo de venda e duas jornadas reais no Chromium (incluindo 390 px). Os testes atuais registram 57 testes do núcleo e 14 da API.
- Publicação real: abra **Implantações/Builds** do projeto Cloudflare e confirme que o commit da `main` passou. **Um GitHub Actions verde não comprova uma publicação verde.**

Se a Cloudflare marcar o check **Workers Builds: pdv-artisys-total** como falho, abra o próprio link do build no painel e confira a primeira mensagem de erro. A integração Cloudflare não disponibiliza os logs privados no GitHub; não tratar esse check como sucesso sem verificá-lo.

### Status e evidência de publicação

A PR #5 e a `main` correspondente tiveram build Cloudflare de produção aprovado em 17/10/2026. O novo P3–P5 deve ser conferido **pelo commit exato** no painel após merge; o sucesso de QA no GitHub não prova automaticamente o status de um novo build nem a aplicação das migrations em D1 remoto.

### Histórico de falhas do build

O check de integração **Workers Builds: pdv-artisys-total** no GitHub retornou falha tanto na `main` anterior ao P3 (commit `97c7626d`) quanto na PR #5. O diagnóstico do erro remoto precisa do log do painel Cloudflare; Wrangler dry-run e GitHub CI **passarem não eliminam esse bloqueio**.

Conferir `https://dash.cloudflare.com/` → Workers & Pages → `pdv-artisys-total` → Builds/Implantações → build com falha; copiar a **primeira mensagem técnica de erro**, checar comandos Build/Deploy configurados e o status dos bindings D1 `DB` e R2 `FILES`. Não preencher IDs e tokens inventados, e não habilitar recursos pagos para contornar o problema. Sem esse log, não há comprovação de deploy remoto.

**Próximas etapas:** resolver o build remoto, aplicar e verificar as migrações no banco isolado, criar onboarding seguro, habilitar assinaturas mensais sob controle, e ampliar gradualmente a paridade online do núcleo e da interface **sem renderer ou mutations duplicados**.


## PWA e isolamento de dados

- Manifesto `manifest.webmanifest`, ícones PNG gerados no build e `sw.js` baseado no **mesmo renderer** `apps/web/`.
- O Service Worker guarda exclusivamente os assets públicos distribuídos em `dist/web/`, com cache versionado por hash; **nunca** responde a `/api/*` nem intercepta POST/PUT/PATCH/DELETE.
- Offline exibe shell/cadastro como leitura local de assets, mas autenticação, venda, estoque, caixa e financeiro exigem conexão real. **Sem fila de mutations offline**, sem salvar dados de clientes em cache do SW.
- Em deploy, verificar `/manifest.webmanifest`, `/sw.js`, ícones 192/512 e navegação a 390 px; o build não deve carregar scripts Electron ou gerar uma segunda UI.

## Checklist operacional antes de liberar login

1. Verificar no painel Cloudflare o build do commit da `main`, nome `pdv-artisys-total`, bindings `DB` (D1 novo) e `FILES` (R2 reservado), sem compartilhar recursos do PDV original.
2. Aplicar migrations **somente** no D1 do PDV Total e validar esquema, backups, tenant e branch reais antes de habilitar autenticação.
3. Verificar perfis e permissões, proteção contra abuso, gerenciamento/recuperação de senhas, consistência de fechamento e conciliação de pagamentos em ambiente de homologação.
4. Implantar preços/assinaturas com estados explícitos e habilitar contas de clientes somente quando os gates comerciais estiverem aprovados.
5. Não ativar `AUTH_ENABLED=true` apenas porque a interface passou no Chromium; produção deve permanecer fechada enquanto qualquer gate acima estiver pendente.

- Transferências entre filiais usam `inventory_transfers` + dois lançamentos imutáveis no ledger em uma transação D1. Aplicar `0007_stock_transfers.sql` antes de habilitar o botão Transferir na versão web. O `AUTH_ENABLED=false` permanece até provisionamento, testes e liberação explícita.

### P1 — devoluções e reversões

Aplicar `0008_transaction_reversals.sql` somente após a migration `0007_stock_transfers.sql`, com backup e confirmação de schema. A migração cria registros **append-only** de devolução de venda concluída, reembolso com motivo, reversão de comissão/crédito e compensação de liquidação financeira. Caixas já fechados não recebem reembolso retroativo: um estorno em dinheiro exige sessão nova aberta, com saldo suficiente. Um reembolso de crediário já quitado é bloqueado para conciliação manual. A alteração do código não executa migração remota nem ativa `AUTH_ENABLED`; não liberar operações antes da validação do schema remoto.

### P2 — Catálogo, kits e reservas

Aplicar `0009_catalog_inventory.sql` **depois** da `0008_transaction_reversals.sql` apenas no banco isolado, após backup e QA. A migração adiciona metadados de produtos, variantes com SKUs próprios, composição de kits, alocação imutável dos componentes vendidos, histórico de custo por entrada e reservas atômicas por filial. Não ativar clientes nem publicar sem migração confirmada; serviços pagos permanecem opcionais.
