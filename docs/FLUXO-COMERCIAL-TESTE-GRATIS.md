# PDV Total — cadastro público e teste grátis automático

## Jornada comercial (sem aprovação manual)

1. A landing oferece **Começar teste grátis**. O formulário envia `POST /api/v1/auth/register` à mesma origem HTTPS. O Worker exige `REGISTRATION_ENABLED=true` e `AUTH_ENABLED=true`, senha forte, rate limit por IP Cloudflare e honeypot.
2. Para e-mail novo, uma única transação D1 cria usuário, empresa, filial e associação OWNER **ativos**, além de assinatura `TRIAL` válida até 14 dias após o cadastro, e registra `PUBLIC_AUTO_TRIAL_STARTED` na auditoria. **Nenhuma intervenção da ArtiSys** é necessária. Tentativa com o mesmo e-mail não renova o trial, cria outra empresa ou substitui senha.
3. O formulário autentica com o e-mail e a senha recém-digitados e abre `/app/` imediatamente. Se o e-mail já existir, apresenta orientação genérica de login/recuperação, sem identificar a existência de uma conta pela resposta de cadastro.
4. Quando existir transporte de e-mail configurado, o Worker envia boas-vindas com URL HTTPS do PDV e data de término, sem senha nem link de acesso privilegiado. Falha no envio **não desfaz** uma assinatura válida ou obriga aprovação manual.
5. Terminada a avaliação de 14 dias, o backend bloqueia **mutações** comerciais pela regra de entitlements até haver assinatura ativa ou licença administrativa válida. O acesso de leitura/exportação autorizado permanece conforme política do sistema.
6. Para licenças comerciais manuais, a central **ArtiSys Pagamentos** usa `action:owner-license`, com e-mail do OWNER, quantidade de meses e motivo. O backend encontra a empresa já criada, sem duplicá-la, e envia um link de definição de senha de uso único. Os planos pagos via Asaas continuam no conector independente e só concedem acesso por evento autenticado e reconciliado.

## Limites e controles

- A criação de *outras* empresas por um mesmo proprietário segue desativada: `TENANT_SELF_SIGNUP_ENABLED=false`. O cadastro público só registra um novo e-mail não utilizado.
- O rate limit vigente permite até 3 solicitações por origem/IP na janela de 15 minutos. A borda deve restringir automação maliciosa e o painel administrativo mantém revogação/bloqueio de assinaturas. Um e-mail diferente ainda pode iniciar outro trial; exigir verificação de endereço e controles antiabuso adicionais antes de oferecer uso irrestrito.
- MFA e obrigatoriedade de confirmação de e-mail continuam conforme flags próprias, sem mudança automática para contas antigas. O modo offline LAN permanece opt-in e ainda requer homologação física.
- Respostas de cadastro novo, e-mail repetido e honeypot são indistinguíveis para prevenir enumeração. O login autenticado confirma o acesso, não a resposta pública isolada.
- Os segredos, rotas, bindings D1/R2, identidade de remetente, webhooks Asaas e integração assinada entre Workers permanecem preservados.

## Critérios de qualidade

- Regressão em `apps/api/test/commercial-onboarding.test.mjs` exige: tenant + OWNER ativos, TRIAL 14 dias desde o cadastro, primeira autenticação, expiração exata, ausência de aprovação pendente, e-mail de boas-vindas, resistência a repetição/renovação e liberação posterior por meses no mesmo tenant.
- `apps/api/test/public-registration.test.mjs`: validação, transação, IP rate limit, CSRF de mesma origem, honeypot, e-mail duplicado e modo desabilitado.
- `scripts/public-landing.test.mjs` confirma a interface do trial e que login/cadastro usam a mesma API canônica.
- Conferir CI integral, Worker de produção, sessão real, entregabilidade do e-mail e eventos reais Asaas antes de declarar vendas totalmente automatizadas. Testes com e-mail simulado não comprovam entrega externa.

**Implantação:** esse fluxo só entra em produção após PR revisada, CI aprovado e merge na `main`, que aciona automaticamente a Cloudflare. Não realizar alterações manuais no Wrangler ou D1 de produção fora do deploy canônico.
