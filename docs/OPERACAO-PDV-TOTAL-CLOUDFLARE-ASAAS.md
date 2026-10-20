# PDV TOTAL — fechar Cloudflare, superadmin e cobrança Asaas

Este runbook descreve a configuração **operacional**, não uma comprovação de que o deploy ou pagamentos estejam ativos. O SaaS pago é **opcional**: o núcleo Node/SQLite self-hosted permanece gratuito, sem obrigação de Asaas ou Cloudflare.

## 1. Publicação e logs: primeiro pré-requisito

No Cloudflare Workers → `pdv-artisys-total` → Configurações → Builds:

| Item | Valor |
| --- | --- |
| Repositório | `nutricionistaalmeidavh-spec/PDV-ARTISYS-TOTAL` |
| Branch | `main` |
| Diretório raiz | `/` |
| Build | `npm run build` |
| Deploy | `npx wrangler deploy` |

A `main` contém `package.json`; o erro ENOENT de 17/10 às 10h34 (Brasília) é anterior ao commit que criou esse arquivo. Se a **nova** execução falhar, inspecione **o primeiro erro do log de build atual** em vez de alterar comandos indiscriminadamente. O build executa `scripts/cloudflare-d1-bootstrap.mjs`: caso o D1 `pdv-artisys-total` ainda não exista, precise de permissões ou as migrations falhem, o deploy **deve abortar** até o problema ser corrigido; nunca use o banco de outro sistema.

Bindings esperados: D1 `DB` → `pdv-artisys-total`; R2 `FILES` (bucket exclusivo); Cloudflare Email Sending `EMAIL` (opcional, remetente autorizado). Confirme nome, ID real e autorização no Dashboard. Sem D1 inicializado, a API pode responder 503.

O `wrangler.jsonc` versionado ativa **Workers Logs**, `invocation_logs`, amostragem de 100% durante homologação e **ocultação das query strings** (`redact_query_string`), para reduzir vazamento de parâmetros sensíveis. Não emitir tokens, Authorization, Cookie, senhas, payloads completos de cadastros ou pagamentos em `console.*`. Em volume elevado, ajustar a amostragem e verificar os limites de uso/retensão do plano Cloudflare. Logs de **invocação do Worker** só aparecem depois que a implantação é concluída e recebe tráfego; **não corrigem falhas ocorridas antes do deploy**, que continuam em **Logs de build**.

## 2. Superadmin privado do PDV TOTAL

Depois de confirmar build publicado, D1 migrado e HTTPS:

1. Adicione em Cloudflare → Worker `pdv-artisys-total` → Settings → Variables & Secrets o **secret** `PLATFORM_ADMIN_TOKEN`: valor aleatório, próprio deste Worker, com pelo menos 32 caracteres. Não use `ADMIN_TOKEN` do Pagamentos ArtiSys nem publique no Git.
2. Em computador administrativo confiável com Node.js 22+ e checkout deste repositório, configure `PDV_TOTAL_BASE_URL` com a origem HTTPS real do Worker e `PLATFORM_ADMIN_TOKEN` no **ambiente privado**.
3. Execute `node scripts/saas-admin-cli.mjs painel`. Ele gera `/admin/#ticket=...`: convite de **uso único válido por 5 minutos**. A interface troca o convite por sessão HttpOnly/Secure de **30 minutos**. Não envie o convite a terceiros.
4. Para um banco sem clientes ativos, crie o primeiro proprietário via `node scripts/saas-admin-cli.mjs bootstrap` com `PDV_OWNER_EMAIL`, `PDV_OWNER_PASSWORD`, `PDV_OWNER_NAME`, `PDV_TENANT_SLUG`, `PDV_TENANT_NAME` definidos privadamente. Como alternativa, se habilitar cadastro público depois, revise solicitantes com `pending` e `approve TENANT_ID`. Nunca execute bootstrap numa empresa já existente.
5. Confirme autenticação com `node scripts/saas-admin-cli.mjs smoke` e `PDV_OWNER_EMAIL`/`PDV_OWNER_PASSWORD` privados, depois teste `/app/` e `/conta/` no navegador.

Exemplo PowerShell **sem digitar o segredo em parâmetros ou histórico**:

```powershell
$env:PDV_TOTAL_BASE_URL = "https://pdv-artisys-total.nutricionistaalmeidavh.workers.dev"
$adminSecret = Read-Host "PLATFORM_ADMIN_TOKEN" -AsSecureString
$env:PLATFORM_ADMIN_TOKEN = [System.Net.NetworkCredential]::new("", $adminSecret).Password
node scripts/saas-admin-cli.mjs painel
Remove-Item Env:\PLATFORM_ADMIN_TOKEN
```

O token de plataforma não vai para o JavaScript nem para um formulário de login público. O acesso do **proprietário da loja** é separado do **superadmin ArtiSys**.

### Flags e email

O `wrangler.jsonc` versionado mantém por padrão `AUTH_ENABLED=false`, `REGISTRATION_ENABLED=false`, `MFA_ENABLED=false`, `EMAIL_VERIFICATION_REQUIRED=false`, `ARTISYS_BILLING_ENABLED=false`. **Não considere um toggle manual no Dashboard definitivo**: vars definidas no `wrangler.jsonc` podem voltar ao valor versionado no próximo deploy. Habilite cada flag com alteração controlada de configuração, QA e novo deploy, quando os pré-requisitos estiverem comprovados.

Para confirmar e-mails, convites e recuperação de senha, o Worker declara `send_email: EMAIL` e `EMAIL_FROM=welcome@artisys.dev`. O domínio/remetente exatos precisam estar autorizados no Cloudflare Email Sending e ter autenticação SPF/DKIM/DMARC correta; teste a chegada real antes de exigir verificação. O transporte HTTPS privado `EMAIL_DELIVERY_URL` + `EMAIL_DELIVERY_TOKEN` também é suportado, especialmente no self-hosted. Sem transporte confiável, mantenha `EMAIL_VERIFICATION_REQUIRED=false`. Ative MFA apenas com `MFA_ENCRYPTION_KEY` secreto durável de 32+ caracteres e teste TOTP/códigos de recuperação.

## 3. Configuração da central Pagamentos ArtiSys

Este é um Worker **diferente**: `pagamentos-artisys-central`, repositório `nutricionistaalmeidavh-spec/pagamentos-artisys`. Nesse Worker use `npm run check` para build e `npx wrangler deploy` para deploy. O `wrangler.jsonc` da central já ativa observabilidade; não precisa duplicar.

Verifique `/healthz` e o D1 `PAGAMENTO_ARTISYS_DB`. Abra `https://pagamentos-artisys-central.nutricionistaalmeidavh.workers.dev/admin`, protegido por **secret próprio `ADMIN_TOKEN`** de 32+ caracteres.

Em Variables & Secrets, configure:

| Chave | Finalidade |
| --- | --- |
| `ADMIN_TOKEN` | Administração da central; distinto do token da plataforma PDV |
| `PUBLIC_BASE_URL` | Origem HTTPS pública do Worker Pagamentos |
| `PUBLIC_ORIGINS` | Origens web autorizadas quando necessário, sem curingas |
| `ASAAS_API_BASE_URL` | Sandbox: `https://api-sandbox.asaas.com/v3`; produção: `https://api.asaas.com/v3` |
| `ASAAS_API_KEY` | Chave do ambiente Asaas selecionado, como secret |
| `ASAAS_WEBHOOK_TOKEN` | Token exclusivo do webhook Asaas, como secret |
| `PRODUCT_CONNECTORS_JSON` | Mapa HMAC privado de produtos para os Workers destinatários |
| `CONNECTOR_ALLOWED_ORIGINS` | Permitir somente a origem HTTPS do PDV |
| `PAYMENTS_ENABLED` | `true` **somente depois** de homologação; antes manter desabilitado |

No **Asaas** configure o webhook para
`https://pagamentos-artisys-central.nutricionistaalmeidavh.workers.dev/v1/webhooks/asaas`,
com o **mesmo** `ASAAS_WEBHOOK_TOKEN`, eventos de checkout e, quando validados, renovação/cancelamento/estorno. Não confundir a URL Asaas com a URL do conector PDV.

No `/admin` da central, cadastre **duas ofertas reais** e defina pessoalmente os valores em centavos BRL:

| Oferta | Produto | Sale type | Delivery mode |
| --- | --- | --- | --- |
| `pdv-total-saas-mensal` | `pdv-total-saas` | `monthly` | `webhook` |
| `pdv-total-saas-anual` | `pdv-total-saas` | `yearly` | `webhook` |

Os cupons percentuais também são cadastrados **somente na central**. Deixe as ofertas desativadas até testar o conector e a confirmação de pagamento.

## 4. Vincular os dois Workers sem compartilhar secrets indevidos

Gere **duas** chaves aleatórias distintas com 32+ caracteres e armazene-as em gerenciador privado: `SEGREDO_HMAC_PDVTOTAL` e `SEGREDO_BINDING_PDVTOTAL`.

**Worker Pagamentos**, secret `PRODUCT_CONNECTORS_JSON` (substitua os marcadores, sem expor os valores reais em Git, prints ou mensagens):

```json
{
  "pdv-total-saas": {
    "url": "https://pdv-artisys-total.nutricionistaalmeidavh.workers.dev/api/v1/integrations/artisys/billing",
    "secret": "SEGREDO_HMAC_PDVTOTAL"
  }
}
```

`CONNECTOR_ALLOWED_ORIGINS` deve incluir exatamente `https://pdv-artisys-total.nutricionistaalmeidavh.workers.dev`.

**Worker PDV TOTAL**, em Secrets:

- `ARTISYS_BILLING_SECRET`: **o mesmo** `SEGREDO_HMAC_PDVTOTAL` do conector.
- `ARTISYS_BINDING_SECRET`: `SEGREDO_BINDING_PDVTOTAL`, **diferente**, exclusivo do PDV.

O `wrangler.jsonc` do PDV já define `ARTISYS_PAYMENTS_URL` e os dois IDs de ofertas; não é preciso duplicar o catálogo nem a adquirência. Depois de verificar sandbox, webhook Asaas, eventos HMAC, idempotência, renovação e cancelamento, habilite o gateway `PAYMENTS_ENABLED=true` e **por alteração controlada** `ARTISYS_BILLING_ENABLED=true` no PDV. O proprietário compra por `/conta/`. O dinheiro é confirmado na central antes de o servidor PDV estender o entitlement.

## 5. Critérios mínimos para declarar produção pronta

- Cloudflare Builds da `main` confirma o **SHA exato** publicado (não apenas CI verde no GitHub); D1 isolado, 35 migrations e bindings reais verificados.
- `/api/v1/health`, superadmin por ticket, bootstrap/OWNER, login e recuperação de senha validados em ambiente publicado.
- Cloudflare Email Sending ou bridge homologado antes de `EMAIL_VERIFICATION_REQUIRED=true`; chave MFA persistente e recuperação conferida antes de exigir MFA.
- Sandbox Asaas valida pedido mensal e anual, cupom válido/inválido, webhook autenticado, HMAC, duplicata, expiração, reembolso e isolamento tenant A/B; nenhuma liberação por redirect sem pagamento.
- Depois disso, rodar compra controlada em produção e validar painel/observabilidade, alertas, rate limiting, políticas LGPD e plano de restauração.
- Os logs de Worker **não** substituem os logs de build. Não publicar tokens de sessão, Admin, API Asaas ou dados pessoais em capturas de tela ou logs compartilhados.

**Fonte:** `docs/BILLING-P2-ASAAS-SETUP.md`, `docs/SAAS-FIRST-ACCESS.md`, `docs/SAAS-SECURITY-OPERATIONS.md` e `pagamentos-artisys/docs/CLOUDFLARE.md`. A ativação externa exige acesso autorizado à Cloudflare e à conta Asaas, que não é fornecido por este repositório.

## Administração centralizada no ArtiSys Pagamentos

A interface operacional única fica em \`https://pagamentos-artisys-central.nutricionistaalmeidavh.workers.dev/admin\`.
A central autentica o operador pelo \`ADMIN_TOKEN\` **que já existe nela**; não compartilhe esse token com o PDV. No backend, ela envia solicitações HMAC com um segredo **novo e exclusivo**, \`ARTISYS_PLATFORM_BRIDGE_SECRET\`, configurado como Secret com o **mesmo valor** nos dois Workers. Não é o token Asaas, nem o segredo de cobrança \`ARTISYS_BILLING_SECRET\`. A assinatura associa timestamp, nonce e corpo da solicitação; o D1 do PDV registra cada nonce para negar replay.

No Worker \`pagamentos-artisys-central\`, configure a variável (texto) \`PDV_TOTAL_PLATFORM_URL=https://pdv-artisys-total.nutricionistaalmeidavh.workers.dev\`, e o Secret \`ARTISYS_PLATFORM_BRIDGE_SECRET\`. No Worker \`pdv-artisys-total\`, adicione somente o mesmo Secret \`ARTISYS_PLATFORM_BRIDGE_SECRET\`. Nenhuma chave ou JSON dos demais produtos deve ser alterado.

**Ordem de ativação sem bloqueio:** (1) publique o PDV com a migration \`0036_central_platform_bridge.sql\`; (2) publique o painel da central com o proxy backend; (3) confirme ambos os Workers e cadastre as variáveis/segredos; (4) coloque no PDV \`ARTISYS_PLATFORM_CENTRAL_ENABLED=true\` **somente após** a central exibir empresas reais e conseguir realizar as operações autorizadas. Antes desse último passo, a administração antiga permanece funcional. Após o corte, \`/api/v1/platform/*\` (token permanente, ticket e /admin legado) é recusado; a única interface funcional é a central.

**Escopo da central:** ler resumo, empresas e auditoria; aprovar empresa (trial); inicializar a primeira loja num banco realmente novo. **Sem alterar assinaturas pagas manualmente:** o estado \`ACTIVE\` pago só deve ser atualizado pela entrega de pagamento validado HMAC da central. Os direitos de acesso continuam armazenados no D1 do PDV; a central continua dona dos pedidos, preços, cupons e confirmação do Asaas.

**Segurança operacional:** não apagar o Secret antigo \`PLATFORM_ADMIN_TOKEN\` durante a transição. Após validar o corte, ele não autentica nenhuma rota de plataforma; pode ser removido numa etapa posterior. Nenhum segredo deve ser enviado para a interface pública, Git ou logs. Não habilitar o corte se o build Cloudflare do PDV ainda falhar.
