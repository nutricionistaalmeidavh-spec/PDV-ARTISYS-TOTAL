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

1. O build de produção da main aplica a migration 0030 no D1 isolado do PDV TOTAL.
2. Criar secret PLATFORM_ADMIN_TOKEN aleatório e com 32 ou mais caracteres nas Settings/Secrets do Worker. Nunca versionar ou expor esse valor no navegador.
3. Com AUTH_ENABLED=false, executar POST /api/v1/platform/bootstrap, de ambiente administrativo, com Origin igual ao Worker e Authorization Bearer com esse segredo. JSON: email, ownerName, password (12–256 caracteres), slug e name. Aceita apenas o primeiro tenant, atomicamente.
4. Um plano pode ser concedido por PUT /api/v1/platform/tenants/:id/subscription, com corpo contendo status, planKey e endsAt (ISO UTC). Exemplo: status ACTIVE, planKey basic, endsAt 2027-10-19T00:00:00.000Z.
5. Após validação do primeiro acesso e segurança, habilitar AUTH_ENABLED=true explicitamente. Para múltiplos tenants por um OWNER, habilitar TENANT_SELF_SIGNUP_ENABLED=true. A opção fica desligada por padrão.

## Isolamento, assinaturas e antiabuso

- TRIAL e ACTIVE com vencimento futuro autorizam escritas. PAST_DUE, SUSPENDED, CANCELLED e sem assinatura recusam mutações com HTTP 402. Consultas de um membro autorizado continuam disponíveis para exportação.
- Convites são aleatórios de 256 bits; apenas o hash SHA-256 entra no banco. O token é retornado uma vez ao proprietário. Ainda não existe envio automático por e-mail. Distribuir token por canal privado e nunca colocar em URL/log/analytics.
- E-mails de convites devem corresponder à conta autenticada. Contas inexistentes são criadas via cadastro por convite. Credenciais de contas existentes não podem ser substituídas por convite.
- Alterar tenantId, userId, URL, payload, status do plano ou botões do navegador não altera as permissões do servidor.
- Limite de falhas por e-mail e por IP de borda (15 por janela de 15 minutos). Em Cloudflare o CF-Connecting-IP é confiável na borda. Em self-hosted não habilitar TRUST_CF_CONNECTING_IP sem proxy que sobrescreva o header.
- Uma pessoa não pode remover seu próprio papel OWNER ou promover outro OWNER pela API comum. Eventos administrativos são registrados em saas_audit_events.
- Usar sempre HTTPS, política WAF Cloudflare e monitoramento antes de convidar clientes. Segredo administrativo não equivale a assinatura cliente.

## Pendências futuras
Não foram implantados MFA, recuperação de senha, verificação externa de e-mail, envio transacional de convites, checkout Asaas, antifraude de webhooks, painel visual de superadmin ou certificação pentest independente. A API de planos é administrativa, não um comprovante de pagamento.
