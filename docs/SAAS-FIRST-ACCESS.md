# PDV TOTAL — Primeiro acesso e administração SaaS

## Interfaces implementadas

- A PWA autenticada em /app/ agora tem **Minha empresa** para o perfil OWNER: filiais, funcionários, cargos, convites de uso único, revogação de sessões e estado da assinatura.
- Funcionários sem conta podem inserir código de convite, nome, e-mail e senha na própria tela de login. O código não é enviado na URL nem persistido no navegador.
- O cadastro da landing cria empresa e proprietário **pendentes**, sem permissão operacional até aprovação privada.
- O superadmin da ArtiSys não usa um formulário público com credencial mestra no navegador: revisão de pendências, aprovação, bootstrap e mudanças de assinatura são operados por CLI Node privado.

## Fluxo de implantação do primeiro usuário real

1. Confirmar o build aprovado do Cloudflare Worker pdv-artisys-total na main e o esquema D1 da versão 0031.
2. Criar em Cloudflare Settings > Variables and Secrets um PLATFORM_ADMIN_TOKEN de 32 ou mais caracteres, aleatório e classificado como secret; não colocar em variáveis públicas, Git, URL, logs nem JavaScript distribuído aos clientes.
3. No computador administrativo, usar variáveis de ambiente privadas PDV_TOTAL_BASE_URL (origem HTTPS exata do Worker) e PLATFORM_ADMIN_TOKEN.
4. Rodar `node scripts/saas-admin-cli.mjs pending` para listar cadastros aguardando análise, e `node scripts/saas-admin-cli.mjs approve TENANT_ID` somente depois de confirmar a identidade e a legitimidade do solicitante. A aprovação é de uso único, auditada e concede TRIAL de 14 dias.
5. Em um banco sem empresa ativa, também há `node scripts/saas-admin-cli.mjs bootstrap` com PDV_OWNER_EMAIL, PDV_OWNER_NAME, PDV_OWNER_PASSWORD, PDV_TENANT_SLUG e PDV_TENANT_NAME definidos no ambiente privado. Não usar bootstrap se o primeiro cliente já foi aprovado.
6. Apenas depois de definir o proprietário, habilitar AUTH_ENABLED=true de forma versionada na configuração de produção. REGISTRATION_ENABLED permanece false até revisão da proteção antifraude. Sem essas condições, não abrir login a novos clientes.
7. Executar `node scripts/saas-admin-cli.mjs smoke` com PDV_OWNER_EMAIL e PDV_OWNER_PASSWORD privados. O teste faz login pela rede com cookie, confere sessão, tenant, filial, assinatura e revoga a sessão de homologação. Não imprime senha/token.
8. Abrir /app/ no PC e celular, entrar com o proprietário, usar Minha empresa, gerar convite para um caixa, ativar a conta de funcionário e verificar a impossibilidade de acessar dados de outra empresa.

## Testes automatizados

- `apps/api/test/saas-security.test.mjs`: aprovação administrativa única, bloqueio de cadastros pendentes, proteção OWNER e tenant A/B.
- `scripts/web-browser-e2e.mjs`: navegador Chromium desktop/mobile, login, painel, nova filial, convite, cadastro do funcionário e negação de área administrativa para o caixa.
- Evidências de interface: qa-artifacts/pdv-saas-admin-desktop.png e qa-artifacts/pdv-saas-admin-mobile.png, produzidas no workflow de QA.
- `scripts/saas-admin-ui.test.mjs`: contrato de separação entre a UI do lojista e credenciais privadas da plataforma.

## Limites de homologação

Sucesso no GitHub Actions e no Cloudflare Builds prova código, regressão automatizada e publicação, **não** que o usuário real conseguiu entrar no D1 de produção. Isso exige credencial e secret administrativos, os quais não devem ser criados nem expostos pelo build. Não considerar concluído o primeiro login real enquanto o teste autenticado não tiver sido executado no ambiente publicado.

Antes do lançamento comercial amplo, ainda faltam verificação de e-mail, recuperação de senha, MFA, políticas WAF de produção, checkout automático, observabilidade e ensaio independente de resposta a incidentes.
