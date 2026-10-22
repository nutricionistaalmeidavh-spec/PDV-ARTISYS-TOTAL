# PDV Total no subdomínio da ArtiSys

O PDV Total atende o endereço **https://pdv.artisys.dev** diretamente pelo mesmo
Worker `pdv-artisys-total`. Não é criada uma segunda API ou aplicação.

| Recurso | URL no domínio ArtiSys |
| --- | --- |
| Landing | `https://pdv.artisys.dev/` |
| Login / aplicativo | `https://pdv.artisys.dev/app/` |
| API | `https://pdv.artisys.dev/api/v1/...` |
| Saúde do backend | `https://pdv.artisys.dev/api/v1/health` |
| Redefinição da senha | `https://pdv.artisys.dev/recuperar-senha/` |

## Contrato de compatibilidade

- `workers_dev: true` permanece ativo. O endereço antigo
  `https://pdv-artisys-total.nutricionistaalmeidavh.workers.dev` continua funcionando.
- A configuração adiciona um único `routes` do tipo `custom_domain`, sem
  reescrever caminhos, trocar `main`, vincular outro D1 ou alterar o binding `ASSETS`.
- O frontend usa `/api/v1/...` na **mesma origem**. Cookies seguros, política de
  origem e sessões ficam vinculados ao endereço em uso. Uma sessão iniciada no
  `workers.dev` não é compartilhada automaticamente com `pdv.artisys.dev`,
  por segurança.
- A Central ArtiSys Pagamentos mantém `PDV_TOTAL_PLATFORM_URL`, URLs de
  conectores HMAC, checkout e webhooks já configurados. **Não altere** essas URLs,
  segredos ou `PUBLIC_ORIGINS` apenas para publicar este subdomínio.
- Links de recuperação de senha são criados a partir da origem da requisição:
  se o usuário solicitar em `pdv.artisys.dev`, receberá um link no próprio domínio.

## Ativação e verificação

A configuração está em `wrangler.jsonc` e será aplicada pelo próximo deploy
autorizado na Cloudflare da branch `main`. A zona `artisys.dev` deve estar
na **mesma conta Cloudflare** do Worker; confira em **Workers & Pages →
pdv-artisys-total → Settings → Domains & Routes** se aparece
`pdv.artisys.dev` como *Custom Domain*. Normalmente a Cloudflare cria DNS
e certificado HTTPS automaticamente. Se já houver um registro DNS ou outro
produto usando esse hostname, resolva o conflito no painel **antes** de publicar,
sem remover registros existentes às cegas.

Conferir depois do deploy:
1. `https://pdv.artisys.dev/api/v1/health` devolve o mesmo estado de saúde
   do endereço `workers.dev`.
2. Landing e `/app/` carregam sem redirecionar para domínios externos.
3. Login, logout, redefinição de senha e convite no novo domínio.
4. O endpoint de administração HMAC e a cobrança seguem acessíveis pelo
   `workers.dev`, mantendo a integração antiga.
5. Não afirmar que o hostname está ativo sem consultar Domains & Routes e
   fazer requisições reais por HTTPS.

**Reversão:** remova só a entrada `routes` do custom domain em nova revisão
do `wrangler.jsonc` e publique novamente. Não remova D1, R2, segredos, nem
`workers_dev: true`. O antigo `workers.dev` continuará como fallback.
