# PDV TOTAL — Segurança, multiempresa e assinaturas

## Arquitetura
O sistema mantém a única API canônica Cloudflare Workers/D1 e o motor existente de estoque, vendas e caixa. Cada operação resolve autenticação e associação ao tenant no backend. A interface nunca atribui planos pagos ou permissões.

## API de administração

| Método | Caminho | Acesso |
|---|---|---|
| POST | /api/v1/platform/bootstrap | Segredo da plataforma; somente banco sem tenants |
| PUT | /api/v1/platform/tenants/:id/subscription | Segredo da plataforma; auditoria |
| POST | /api/v1/tenants | Proprietário já cadastrado; opção desligada por padrão; máximo 3 empresas |
| POST | /api/v1/tenants/:id/branches | Proprietário; assinatura válida |
| POST | /api/v1/tenants/:id/invitations | Proprietário; token de 48 horas; não pode nomear OWNER |
| GET | /api/v1/tenants/:id/invitations | Proprietário; sem acesso ao token após criação |
| POST | /api/v1/tenants/:id/invitations/:inviteId/revoke | Proprietário |
| POST | /api/v1/auth/register-invite | Pessoa nova que recebeu convite por canal privado |
| POST | /api/v1/invitations/accept | Usuário autenticado, e-mail correspondente |
| PATCH | /api/v1/tenants/:id/members/:userId/role | Proprietário, sem alteração de OWNER |
| POST | /api/v1/tenants/:id/members/:userId/revoke | Proprietário, sem remover OWNER |
| GET | /api/v1/auth/sessions | Própria conta |
| DELETE | /api/v1/auth/sessions/:sessionId | Própria conta |
| GET | /api/v1/tenants/:id/subscription | Membro, leitura própria |

## Implantação segura

1. O build de produção da main aplica a migration 0031 no D1 isolado do PDV TOTAL.
2. Criar secret PLATFORM_ADMIN_TOKEN aleatório e com 32 ou mais caracteres nas Settings/Secrets do Worker. Nunca versionar ou expor esse valor no navegador.
3. Com AUTH_ENABLED=false, executar POST /api/v1/platform/bootstrap, de ambiente administrativo, com Origin igual ao Worker e Authorization Bearer com esse segredo. JSON: email, ownerName, password (12–256 caracteres), slug e name. Aceita apenas o primeiro tenant, atomicamente.
4. Um plano pode ser concedido por PUT /api/v1/platform/tenants/:id/subscription, com corpo contendo status, planKey e endsAt (ISO UTC). Exemplo: status ACTIVE, planKey basic, endsAt 2027-10-19T00:00:00.000Z.
5. Após validação do primeiro acesso e segurança, habilitar AUTH_ENABLED=true explicitamente. Para múltiplos tenants por um OWNER, habilitar TENANT_SELF_SIGNUP_ENABLED=true. A opção fica desligada por padrão.

## Isolamento, assinaturas e antiabuso

- TRIAL e ACTIVE com vencimento futuro autorizam escritas. PAST_DUE, SUSPENDED, CANCELLED e sem assinatura recusam mutações com HTTP 402. Consultas de um membro autorizado continuam disponíveis para exportação.
- Convites são aleatórios de 256 bits; apenas o hash SHA-256 entra no banco. O token é retornado uma vez ao proprietário. No Worker com Cloudflare Email Sending e remetente verificado, o convite é enviado automaticamente por e-mail e o token NÃO é retornado no navegador. No core self-hosted sem provedor de envio, a entrega privada manual continua disponível, sem custos. Nunca colocar tokens em URL/log/analytics.
- E-mails de convites devem corresponder à conta autenticada. Contas inexistentes são criadas via cadastro por convite. Credenciais de contas existentes não podem ser substituídas por convite.
- Alterar tenantId, userId, URL, payload, status do plano ou botões do navegador não altera as permissões do servidor.
- Limite de falhas por e-mail e por IP de borda (15 por janela de 15 minutos). Em Cloudflare o CF-Connecting-IP é confiável na borda. Em self-hosted não habilitar TRUST_CF_CONNECTING_IP sem proxy que sobrescreva o header.
- Uma pessoa não pode remover seu próprio papel OWNER ou promover outro OWNER pela API comum. Eventos administrativos são registrados em saas_audit_events.
- Usar sempre HTTPS, política WAF Cloudflare e monitoramento antes de convidar clientes. Segredo administrativo não equivale a assinatura cliente.

## Pendências futuras
A API já oferece MFA TOTP, confirmação de e-mail, recuperação de senha de uso único e superadmin em sessão privada. O Cloudflare Email Sending é uma integração opcional para operação hospedada; a entrega efetiva exige domínio remetente autorizado e `EMAIL_FROM` correto no Worker. Ainda requerem homologação independente a entrega real, DNS de autenticação de e-mail (SPF/DKIM/DMARC), monitoramento, WAF e pentest. A API de planos é administrativa, não um comprovante de pagamento.

## Aprovação de inscrições da landing

O cadastro público em `/api/v1/auth/register` deixa empresa e OWNER com `active=0`, sem assinatura. A credencial privada de plataforma permite `GET /api/v1/platform/tenants` para revisar solicitações pendentes e `POST /api/v1/platform/tenants/:tenantId/approve` para ativar uma empresa uma única vez com avaliação de 14 dias, tudo de forma atômica e auditada. Login anterior à aprovação é bloqueado. Nenhum sinalizador enviado pelo navegador pode aprovar empresas.

## Acesso do proprietário e operações privadas

O OWNER possui painel **Minha empresa** na PWA; as ações administrativas da plataforma permanecem fora do browser. Para revisão/aprovação de contas e smoke com login real, consulte [Primeiro acesso](SAAS-FIRST-ACCESS.md).

## E-mails automáticos com Cloudflare Email Service

- O Worker `pdv-artisys-total` declara binding `EMAIL` (`send_email`) e a identidade do remetente `EMAIL_FROM=welcome@artisys.dev`. Apenas o backend invoca `env.EMAIL.send()`; nenhuma chave de envio aparece na landing, PWA ou Git.
- Para produção, o domínio `artisys.com.br` precisa estar habilitado em Cloudflare **Email Service → Email Sending** com remetente autorizado, SPF/DKIM/DMARC verificados. A assinatura Cloudflare do proprietário é integração explicitamente opt-in; não é dependência do core Node + SQLite.
- Com envio configurado, novos convites chegam automaticamente por e-mail e a API não retorna o código ao navegador. Solicitações de verificação enviam link único por e-mail com validade de 24 horas; recuperação de senha é solicitada em `/recuperar-senha/`, gera link de 20 minutos, bloqueia repetição excessiva, consome o token uma vez e revoga todas as sessões do usuário. MFA inscrito permanece ativo.
- Sem serviço de e-mail, instalações self-hosted preservam convites com código manual e não simulam recuperação por e-mail: a API informa claramente que o transporte não foi configurado. Integrações privadas de e-mail HTTP continuam opcionais via `EMAIL_DELIVERY_URL` e `EMAIL_DELIVERY_TOKEN`; não exigem Cloudflare nem plano pago.
- O CI usa `EMAIL_FROM=disabled-in-local-e2e` para validar o fluxo manual sem despachar mensagens externas. Unit tests verificam envio com `EMAIL.send` simulado. **Build verde não comprova entrega externa**: antes de abrir autenticação, executar um envio controlado a uma caixa real e conferir o recebimento e a mensagem no painel de observabilidade do Email Service.
