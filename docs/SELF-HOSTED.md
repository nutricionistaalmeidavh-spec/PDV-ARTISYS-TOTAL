# PDV TOTAL — instalação local gratuita (self-hosted)

A instalação básica usa apenas **Node.js 22+, SQLite e a interface Web/PWA do próprio projeto**. Sem conta Cloudflare, D1, serviço pago ou código duplicado. O servidor mantém UI e API na mesma origem.

## Instalar e iniciar

No repositório PDV-ARTISYS-TOTAL:

```sh
npm run build
cd apps/api
npm run dev
```

Acesse **http://127.0.0.1:4175/**. O primeiro comando gera dist/web com a mesma interface publicada nos Workers; o segundo aplica as migrações locais e inicia o servidor em loopback. O banco usa apps/api/.local/pdv-total.sqlite por padrão, com WAL.

**Primeiro acesso:** antes de habilitar autenticação, provisione uma empresa e um administrador seguindo apps/api/README.md (usar credenciais reais e não colocar senhas no Git). A variável AUTH_ENABLED permanece **false** por padrão. Habilite AUTH_ENABLED=true **somente após** provisionar a base e confirmar testes de isolamento e senha. Login não é liberado silenciosamente.

Para testes de ambiente sem produção:

```sh
npm run build
node scripts/smoke-selfhosted.mjs
```

O teste sobe Node+SQLite em porta aleatória na máquina, consulta a API e a interface PWA, e encerra o processo.

## Segurança e escopo

- Servidor HTTP escuta **apenas 127.0.0.1/localhost**. Não configurar PDV_HOST=0.0.0.0 com cookies inseguros.
- Acesso LAN em celular/tablet agora possui servidor HTTPS dedicado opcional. Exige TLS confiável nos dispositivos, origem exata e firewall interno; não é homologação física. Consulte [HTTPS LAN](SELFHOST-LAN-HTTPS.md).
- Asset server expõe apenas arquivos do build, bloqueia traversal e não serve o SQLite, código do projeto, .env ou arquivos privados.
- Mesma sessão e autorização da API canônica; isolamento entre empresas, RBAC e dados comerciais nunca são resolvidos pelo serviço estático.
- O service worker mantém somente assets públicos. Operações comerciais e consultas precisam de conexão ativa; nenhuma mutação é enfileirada offline.
- Hardware local (impressora, balança, gaveta) continua via bridge opcional, sujeito a autorização e homologação física.
- PDF utiliza impressão do navegador. XLSX é criado localmente, sem rede externa.
- Faça backups consistentes de SQLite e arquivos WAL com o servidor encerrado; nunca suba dados reais no Git.
- Consulte o [roadmap operacional](ROADMAP-OPERACIONAL.md) para criterios de aceite.

## Implantação alternativa

Cloudflare Workers/D1/R2 continuam uma **opção** independente; são recursos configuráveis e não uma dependência para executar o núcleo local. Não ativar pagamentos, emissão fiscal ou provedores comerciais por padrão.
