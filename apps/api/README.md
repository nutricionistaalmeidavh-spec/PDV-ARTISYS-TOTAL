# PDV Artisys Total — fundação P1/P2

Este diretório contém **somente a nova borda de identidade** do SaaS. Não há renderer paralelo, checkout paralelo, estoque paralelo, gravação de vendas ou tentativa de rodar Electron em Workers.

## Contrato canônico preservado

O Worker importa diretamente do snapshot os módulos:
- `js/core/auth/principal-resolver.js`;
- `js/core/auth/authorization-service.js`;
- `js/core/auth/default-profiles.js`, que lê `permission-registry.js`.

Assim, os perfis e permissões não são reescritos com nomes concorrentes. `OWNER` equivale ao perfil canônico `ADMINISTRATOR` **apenas dentro da própria empresa**. O `tenant_id` é sempre verificado por associação ativa no servidor; a existência de um ID ou rota não dá acesso.

## Executar localmente (gratuito, Node 22+)

```bash
cd apps/api
npm test
npm run dev
```

O modo local usa `node:sqlite` do Node (experimental no Node 22), arquivo `.local/pdv-total.sqlite`. Somente localhost é permitido no servidor HTTP de desenvolvimento. **Não expor esta porta à internet.**

Provisionamento local, com variáveis de ambiente (não registrar senhas no shell history nem versionar `.env`):

```bash
PDV_OWNER_EMAIL=admin@example.com PDV_OWNER_NAME=Administrador \
PDV_TENANT_SLUG=loja-demo PDV_TENANT_NAME='Loja Demo' \
PDV_OWNER_PASSWORD='senha-forte-de-exemplo' node --experimental-sqlite src/provision.mjs --local
```

Para o D1, execute o mesmo comando **sem `--local`** para gerar `.local/provision.seed.sql`. Crie D1 **novo** e aplique `migrations/0001_identity.sql` e depois o seed via Wrangler em operação explícita. Apague o seed depois. **Nunca** aplicar migrações ao D1 da licença do PDV desktop.

Antes de deploy, substitua o `database_id` de zeros em `wrangler.jsonc` pelo ID do D1 novo. Este repositório **não executa deploy automaticamente** e não habilita cobrança. Core totalmente sem serviços pagos; Cloudflare Workers + D1 no Free sujeito aos limites, e alternativa local SQLite.

## API disponível

| Método | Endpoint | Requisito |
| --- | --- | --- |
| GET | `/api/v1/health` | Público; somente estado da borda |
| POST | `/api/v1/auth/login` | Mesmo Origin; e-mail, senha; cookie HttpOnly |
| GET | `/api/v1/auth/session` | Sessão ativa |
| DELETE | `/api/v1/auth/session` | Sessão + mesmo Origin |
| GET | `/api/v1/tenants` | Sessão; somente associações ativas |
| GET | `/api/v1/tenants/:id/context` | Associação ativa ao tenant |
| GET | `/api/v1/tenants/:id/branches` | Associação ativa; filiais do próprio tenant |
| GET | `/api/v1/tenants/:id/members` | `users.view` do perfil canônico |

Não há endpoints novos de criação/edição de produtos, vendas, estoque, caixa ou quaisquer outras mutations de negócio. Esse fluxo depende da **adaptação do núcleo original com transações e idempotência reais no D1**; nunca de uma segunda implementação.

## Limites intencionais antes de produção

- Não há UI web funcionando: o renderer Electron permanece no snapshot, sem duplicá-lo.
- Não há onboarding self-service, redefinição de senha, MFA ou painel superadmin.
- Não há cobrança de assinatura, serviço fiscal ou integração de hardware.
- Não há API de negócio: bloquear as operações evita dupla fonte de verdade.
- Rate limit persistente por e-mail é defesa inicial; no lançamento público acrescentar defesa por IP/rede, auditoria, testes contra abuso e políticas de expiração/revogação.
- O provisionador SQL serve somente para **bootstrap de instalação nova** e não é a API canônica de mutações.
- Node SQLite usa API experimental no Node 22. Planejar runtime LTS estável antes de operação self-hosted comercial.

## Gates para P3

Criar testes de paridade dos contratos do `SaleService`, `CashService`, ledger de estoque, depreciação de caixa, outbox e idempotência sob concorrência. Só expor as rotas comerciais após implementar uma adaptação transacional consistente; não usar um `tenant_id` controlado pelo navegador diretamente como chave de autorização.
