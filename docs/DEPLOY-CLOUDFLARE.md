# Implantação do PDV Artisys Total na Cloudflare

Este Worker tem **identidade P1/P2 e recorte transacional P3** (catálogo, ledger de estoque, abertura de caixa e vendas). Ainda não é um SaaS pronto para clientes ou cobrança recorrente.
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

- O deploy **não executa automaticamente** migrações no D1 remoto. Em banco **novo e isolado**, aplique em ordem `apps/api/migrations/0001_identity.sql` e `apps/api/migrations/0002_commerce.sql` (Cloudflare D1 Console ou `wrangler d1 execute pdv-artisys-total --remote --file <arquivo>`). Nunca execute no D1 do PDV original. Validar backup e o estado do banco antes de migrar dados reais.
- Antes da migração, `/api/v1/health` devolve **503 setup-required**; depois dela, **200 identity-ready**.
- `FILES` ainda não lê nem grava anexos. Não contratar plano pago automaticamente para habilitar R2.
- **Não existe `CLOUDFLARE_API_TOKEN` necessário no código**. O build Git autenticado e os bindings da plataforma são suficientes. Nunca versionar tokens de conta no GitHub.
- Senhas: **PBKDF2-SHA256 com 100.000 iterações**; esse teto pertence ao WebCrypto do Workers, não ao número de operações D1 nem a uma secret.
- Sessões: token aleatório de 256 bits; o banco armazena apenas o SHA-256; no HTTPS a sessão usa cookie HttpOnly/Secure.

## Bloqueio intencional para acesso público

O `wrangler.jsonc` define **`AUTH_ENABLED=false`**, portanto login responde 503 sem persistir tentativas de autenticação. Este é o estado seguro para um Worker cujo frontend P3 e backend transacional estão sob QA e ainda não têm onboarding de clientes, recuperação de senha, defesa de abuso e monitoramento de produção. A interface estática pode ser carregada, mas **login e operações comerciais são bloqueados** no servidor. Não há cobrança online integrada. Ativar login somente após gates de segurança e schema remoto verificado.

## Verificação de entrega

- Código: `npm run build`, `cd apps/api && npm test`.
- Worker: `npx wrangler deploy --dry-run`.
- Testes de integração: GitHub Actions `Verify SaaS canonical foundation` roda Wrangler/Workerd, D1 local, PBKDF2, isolamento de empresa, ciclo completo de venda e duas jornadas reais no Chromium (incluindo 390 px). Os testes atuais registram 57 testes do núcleo e 14 da API.
- Publicação real: abra **Implantações/Builds** do projeto Cloudflare e confirme que o commit da `main` passou. **Um GitHub Actions verde não comprova uma publicação verde.**

Se a Cloudflare marcar o check **Workers Builds: pdv-artisys-total** como falho, abra o próprio link do build no painel e confira a primeira mensagem de erro. A integração Cloudflare não disponibiliza os logs privados no GitHub; não tratar esse check como sucesso sem verificá-lo.

### Bloqueio real de publicação observado

O check de integração **Workers Builds: pdv-artisys-total** no GitHub retornou falha tanto na `main` anterior ao P3 (commit `97c7626d`) quanto na PR #5. O diagnóstico do erro remoto precisa do log do painel Cloudflare; Wrangler dry-run e GitHub CI **passarem não eliminam esse bloqueio**.

Conferir `https://dash.cloudflare.com/` → Workers & Pages → `pdv-artisys-total` → Builds/Implantações → build com falha; copiar a **primeira mensagem técnica de erro**, checar comandos Build/Deploy configurados e o status dos bindings D1 `DB` e R2 `FILES`. Não preencher IDs e tokens inventados, e não habilitar recursos pagos para contornar o problema. Sem esse log, não há comprovação de deploy remoto.

**Próximas etapas:** resolver o build remoto, aplicar e verificar as migrações no banco isolado, criar onboarding seguro, habilitar assinaturas mensais sob controle, e ampliar gradualmente a paridade online do núcleo e da interface **sem renderer ou mutations duplicados**.

