# Implantação do PDV Artisys Total na Cloudflare

Este Worker é **somente a fundação de identidade P1/P2**, não o PDV online completo.
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

- O deploy **não executa automaticamente** `apps/api/migrations/0001_identity.sql` no D1 remoto. Quando o D1 existir, aplique a migração conscientemente no banco **novo** (Cloudflare D1 Console ou `wrangler d1 execute pdv-artisys-total --remote --file apps/api/migrations/0001_identity.sql`). Nunca execute no D1 de licenciamento desktop.
- Antes da migração, `/api/v1/health` devolve **503 setup-required**; depois dela, **200 identity-ready**.
- `FILES` ainda não lê nem grava anexos. Não contratar plano pago automaticamente para habilitar R2.
- **Não existe `CLOUDFLARE_API_TOKEN` necessário no código**. O build Git autenticado e os bindings da plataforma são suficientes. Nunca versionar tokens de conta no GitHub.
- Senhas: **PBKDF2-SHA256 com 100.000 iterações**; esse teto pertence ao WebCrypto do Workers, não ao número de operações D1 nem a uma secret.
- Sessões: token aleatório de 256 bits; o banco armazena apenas o SHA-256; no HTTPS a sessão usa cookie HttpOnly/Secure.

## Bloqueio intencional para acesso público

O `wrangler.jsonc` define **`AUTH_ENABLED=false`**, portanto login responde 503 sem persistir tentativas de autenticação. Este é o estado seguro para um Worker de identidade que ainda não tem onboarding de clientes, MFA, recuperação de senha, defesa por IP nem operações de venda. A API `/api/v1/health` pode responder à sondagem, mas **não há painel, venda, estoque, caixa ou cobrança online**. Ativar login somente após gates de segurança e schema remoto verificado.

## Verificação de entrega

- Código: `npm run build`, `cd apps/api && npm test`.
- Worker: `npx wrangler deploy --dry-run`.
- Testes de integração: GitHub Actions `Verify SaaS canonical foundation` roda Wrangler em Workerd com D1 local, PBKDF2, login, isolamento por empresa, sessão e logout.
- Publicação real: abra **Implantações/Builds** do projeto Cloudflare e confirme que o commit da `main` passou. **Um GitHub Actions verde não comprova uma publicação verde.**

Se a Cloudflare marcar o check **Workers Builds: pdv-artisys-total** como falho, abra o próprio link do build no painel e confira a primeira mensagem de erro. A integração Cloudflare não disponibiliza os logs privados no GitHub; não tratar esse check como sucesso sem verificá-lo.

**Próximas etapas:** adaptar transações do domínio canônico ao D1, criar onboarding seguro, habilitar assinaturas mensais e implementar a interface web **sem renderer e mutations duplicados**, após testes de paridade.
