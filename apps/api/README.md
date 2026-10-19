
# API do PDV TOTAL (Cloudflare Worker / D1 / Node self-hosted)

A API canônica implementa autenticação, associação tenant/filial, permissões RBAC, venda, estoque, caixa, financeiro, verticais e relatórios. O frontend PWA está em apps/web; a landing pública está em apps/landing. O core compartilhado em packages/core permanece como fonte única de regras.

O banco D1 hospedado é exclusivo do PDV TOTAL; migrations 0001..0031 são aplicadas no deploy da main via Cloudflare Builds. Cadastro da landing cria registros pendentes, e aprovação administrativa cria assinatura TRIAL de 14 dias. A abertura para lojistas depende de AUTH_ENABLED, provisionamento privado de proprietário e credencial de plataforma, sem segredo distribuído no JavaScript.

A PWA oferece Minha empresa para OWNER; o superadmin opera via scripts/saas-admin-cli.mjs, com token privado e aprovação auditada. Detalhes e smoke autenticado em docs/SAAS-FIRST-ACCESS.md. A API nunca reutiliza o banco de licenciamento do PDV desktop. Os testes usam Node, SQLite, Workerd/D1 e Chromium.
