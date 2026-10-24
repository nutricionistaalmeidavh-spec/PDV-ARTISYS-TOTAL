# PDV Total — Cadastro, aprovação e teste grátis

## Estado de cada etapa

1. A landing pública oferece **Solicitar teste grátis**. O formulário envia `POST /api/v1/auth/register` à **mesma origem HTTPS**. O backend exige `REGISTRATION_ENABLED=true`, `AUTH_ENABLED=true`, valida senha, rate limit e honeypot. A solicitação cria **tenant e associação OWNER inativos**, sem licença ou escrita operacional. Respostas de cadastro novo, repetido e honeypot usam texto/status público equivalente para não expor se o e-mail já existe.
2. O painel **ArtiSys Pagamentos**, através da integração privada assinada `/api/v1/integrations/artisys/platform`, executa `action:tenants` para listar pendentes e `action:approve` com `tenantId` para avaliar a solicitação. O navegador do lojista nunca recebe segredo da plataforma. Repetir aprovação devolve 409; não reinicia o trial.
3. Após a **aprovação**, o PDV ativa a associação existente e grava `saas_subscriptions` como `TRIAL`, por **14 dias contados a partir da aprovação**, na mesma base D1. O usuário entra com **a senha que definiu no cadastro**. A emissão de trial não significa pagamento.
4. Com `EMAIL` ou ponte de e-mail configurada, a aprovação envia um aviso ao **e-mail do OWNER** com link público do PDV, data de expiração e instrução de login, **sem senha ou token em URL**. Se o envio falhar, a aprovação já persistida permanece válida e a central recebe `emailSent:false` para contato manual; não deve repetir a aprovação (nem conceder novo trial).
5. Para **liberação comercial manual por meses**, a central pode executar `action:owner-license` com `email`, `months`, `reason` e, quando aplicável, `tenantId`. O backend localiza a empresa pelo **OWNER**, não por funcionário. Se ela existe, não cria outra. A licença de meses é registrada separadamente em `saas_admin_licenses` e o e-mail contém instruções para definir/redefinir senha em link de uso único. Isso não simula evento confirmado pelo Asaas; assinaturas pagas automatizadas usam seu conector próprio.

## Gates comerciais e segurança

- A abertura de cadastros públicos **não libera automaticamente** nenhuma empresa. Revisão privada segue obrigatória. `TENANT_SELF_SIGNUP_ENABLED=false` mantém desligada a criação livre de novas empresas por um OWNER.
- Não ativar automaticamente `MFA_ENABLED`, `EMAIL_VERIFICATION_REQUIRED` ou o modo offline; são decisões separadas de implantação.
- Em produção, conferir proteção de borda para abuso de cadastro, integridade do D1, email de aprovação **recebido** em caixa de teste e convite do lojista. CI com `EMAIL.send` simulado não certifica entrega externa.
- O servidor de email pode falhar após a transação de aprovação; exibir `emailSent:false` no painel e comunicar o lojista diretamente. Nunca marcar envio bem-sucedido se o provider rejeitar.
- A nova flag `REGISTRATION_ENABLED=true` é versionada em `wrangler.jsonc`, preservando origem, rotas, bindings D1, R2 e todos os secrets existentes. Deploy automático acontece somente quando aprovada e integrada à `main`.

## Testes

`node --experimental-sqlite --test apps/api/test/commercial-onboarding.test.mjs` cobre solicitação, revisão privada assinada, ausência de login antes da aprovação, autorização após aprovação, janela de 14 dias, e-mail, acesso por meses e ausência de duplicidade da empresa.

`npm run check:landing`, `npm run test:api`, `npm run test:operations` e `npm run build` permanecem gates existentes; validação pública em produção deve ser feita sem cadastrar pessoas reais fictícias ou criar licenças pagas não autorizadas.
