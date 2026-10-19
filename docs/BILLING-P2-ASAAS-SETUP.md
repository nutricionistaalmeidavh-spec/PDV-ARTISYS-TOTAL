# PDV Total — cobrança ArtiSys/Asaas e segurança P2

## Política e limites

O **core obrigatório é gratuito, open source e self-hosted** (Node/SQLite/HTTPS). A cobrança automática é um módulo **opcional e explicitamente habilitado**; nenhum pagamento é capturado pelo PDV operacional. A central [pagamentos-artisys](https://github.com/nutricionistaalmeidavh-spec/pagamentos-artisys) é a única responsável pelo gateway Asaas, cupom e confirmação do pedido. O PDV recebe eventos HMAC e armazena apenas o vínculo entre cobrança e tenant, em tabelas próprias de controle SaaS.

**Não há preços arbitrários nem credenciais Asaas dentro do repositório.** Para liberar o comércio, é necessário publicar as ofertas com preços reais desejados no painel ArtiSys, configurar os secrets dos dois Workers e executar uma compra de teste no ambiente de homologação. Sem esses passos, `ARTISYS_BILLING_ENABLED=false` mantém o núcleo operacional utilizável sem gateway.

## Contrato de ofertas e promoções

No painel privado do motor `pagamentos-artisys` (/admin):

| ID da oferta | Produto canônico | Modalidade | Entrega |
| --- | --- | --- | --- |
| `pdv-total-saas-mensal` | `pdv-total-saas` | `monthly` | `webhook` |
| `pdv-total-saas-anual` | `pdv-total-saas` | `yearly` | `webhook` |

Defina **manualmente o preço em centavos** em BRL para cada oferta e marque ativa somente após verificar checkout e conector. Não publicar produto alternativo que gere segunda assinatura; manter os dois IDs estáveis. Para promoções, use **Cupons** no painel do Pagamento ArtiSys (percentual e ativação/desativação); o valor definitivo é calculado pelo motor financeiro e jamais aceito diretamente do navegador do PDV.

O painel `/conta/` carrega o catálogo publicado da central, apresenta mensal/anual, envia eventual cupom ao mesmo checkout e redireciona para a URL HTTPS oficial do Asaas. O desconto é refletido no valor do pedido verificado.

## Variáveis privadas e links entre Workers

No **Worker de Pagamentos ArtiSys**, além do gateway já existente:

- `PAYMENTS_ENABLED=true` **somente após homologação**;
- `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_API_BASE_URL` (sandbox ou produção) e `PUBLIC_BASE_URL` configurados como secrets/variáveis privadas;
- `PRODUCT_CONNECTORS_JSON` contém `"pdv-total-saas": {"url":"https://SEU-PDV/api/v1/integrations/artisys/billing","secret":"SEGREDO_ALEATORIO_32_CARACTERES_OU_MAIS"}`;
- `CONNECTOR_ALLOWED_ORIGINS` deve incluir **somente** a origem HTTPS do Worker PDV;
- `PUBLIC_ORIGINS` não precisa conter o domínio do PDV para o fluxo backend-to-backend (o PDV chama o gateway sem Origin).

No **Worker PDV Total**:

- `ARTISYS_BILLING_SECRET`: o **mesmo segredo HMAC** do conector acima (secret, nunca variável pública);
- `ARTISYS_BINDING_SECRET`: outra chave aleatória de 32+ caracteres para vincular tenant/usuário ao pedido, conhecida **somente pelo PDV**;
- `ARTISYS_PAYMENTS_URL`: `https://pagamentos-artisys-central.nutricionistaalmeidavh.workers.dev`;
- `ARTISYS_PDV_MONTHLY_OFFER_ID=pdv-total-saas-mensal`;
- `ARTISYS_PDV_YEARLY_OFFER_ID=pdv-total-saas-anual`;
- `SAAS_ENTITLEMENTS_ENABLED=true`: faz valer vencimento/suspensão em mutações comerciais no servidor, preservando consulta;
- `ARTISYS_BILLING_ENABLED=true`: **somente depois** dos secrets e das duas ofertas estarem verificadas.

Para homologação, usar chaves sandbox em ambos e ativação controlada. Trocar para produção somente após validar webhooks reais e conciliação. Todos esses secrets devem ser configurados na Cloudflare/ambiente self-hosted, não em arquivos versionados.

**A central verifica pagamento confirmado via API Asaas autenticada**, antes de gerar entrega. O PDV valida HMAC do corpo, timestamp de até 5 minutos, ID de entrega, `orderId`, `buyerBinding` criptográfico, tenant, proprietário, e-mail, modalidade e total em centavos; cada entrega é persistida uma única vez antes de autorizar ou alterar o plano. `activate` ou `renew` estende 1 ou 12 meses (mês calendário), e `revoke` só suspende a assinatura se ela ainda estiver vinculada àquele pedido. A assinatura manual de outro pedido não é suspensa pelo estorno de um pedido antigo. **Criar pedido ou abrir checkout nunca libera acesso.**

Observação: um checkout cuja criação remota seja ambígua não deve ser repetido com novo ID indiscriminadamente. Consulte `/admin` da central e reconcilie o pedido antes de gerar outra tentativa; o PDV responde com erro em vez de inventar cobrança.

## Segurança P2

- `MFA_ENABLED=true` + secret `MFA_ENCRYPTION_KEY` aleatório com 32+ caracteres: permite TOTP gratuito por aplicativo, segredo protegido por AES-GCM no banco, desafio de segundo fator **antes** de emitir sessão, tentativas limitadas e 8 códigos de recuperação de uso único.
- `EMAIL_VERIFICATION_REQUIRED=true`: mantém sessão inicial limitada sem permitir dados de tenant até verificar o e-mail; configure antes `EMAIL_DELIVERY_URL` HTTPS e secret `EMAIL_DELIVERY_TOKEN` (mínimo 32 caracteres). Trata-se de um **webhook de entrega de e-mail** para serviço que você controla. Pode ser implementado gratuitamente com Postfix/Maddy+um pequeno bridge self-hosted; nenhum serviço pago é exigido. O bridge recebe `Authorization: Bearer ...` e JSON com `to`, `subject`, `text`, `link`.
- `/conta/`: segurança da conta, ativação/desativação do MFA, reenvio de confirmação e compras;
- `/verificar-email/#token=...`: remove o token da barra do navegador, envia POST no corpo JSON e confirma a conta. Tokens são salvos apenas como hash e têm prazo de 24 horas.

A chave MFA deve ser guardada em secret durável; **não trocá-la sem planejar a rotação**, pois os segredos TOTP existentes foram criptografados com a anterior. Ativar exigência de e-mail só depois de haver transporte SMTP/webhook operacional, para evitar bloquear usuários novos.

## Superadmin visual sem expor segredo permanente

O secret `PLATFORM_ADMIN_TOKEN` fica **apenas no CLI/ambiente privado**, como nas operações existentes. Para entrar em `/admin/` sem levar esse token ao navegador:

```bash
PDV_TOTAL_BASE_URL=https://SEU-PDV \
PLATFORM_ADMIN_TOKEN=... node scripts/saas-admin-cli.mjs painel
```

O comando retorna um link `/admin/#ticket=...` válido por **5 minutos e uma única utilização**. Ao abrir, o navegador troca o convite por uma sessão **HttpOnly, SameSite=Strict, Secure** com expiração em 30 minutos; o painel usa exclusivamente essa sessão, sem localStorage e sem exibir o token permanente. Logout revoga a sessão no banco. O convite nunca deve ser compartilhado.

O painel exibe cadastros pendentes, estabelecimentos, assinaturas, aprovações, concessões manuais e trilha de auditoria, além de link para o painel da central de pagamentos.

## Verificação e publicação

1. Testar as migrations 0032, 0033 e 0034 no D1 local e no Node self-hosted; novas bases são provisionadas a partir da cadeia existente sem migração de dados do PDV desktop.
2. Executar `npm run test`, `npm run build`, smoke Worker/D1 e E2E navegador.
3. Conferir `GET /api/v1/tenants/:id/billing/plans` para proprietário, e negação de operador/outro tenant; testar cupom ativo e inválido no sandbox.
4. Simular `license.activate`, `renew`, `revoke` com assinaturas HMAC válidas/inválidas e múltiplos retries; acompanhar `saas_billing_deliveries` e `saas_audit_events`.
5. Homologar o fluxo real Asaas + central ArtiSys no ambiente de teste com duas assinaturas, pagamento, recorrência e reembolso.
6. Somente com todos os gates aprovados, ligar os flags de MFA, e-mail, cobrança e `AUTH_ENABLED` no ambiente de destino.

A landing pública e o PDV original desktop não são alterações deste módulo.
