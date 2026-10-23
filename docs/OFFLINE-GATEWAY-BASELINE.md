# Gateway offline SaaS — cópia inicial protegida (SEM venda offline)

**Estado:** implementação parcial D1 → SQLite para leitura; o servidor local
não possui outbox de vendas/caixa/estoque para gravar mudanças de volta no D1.
O código bloqueia operações comerciais de uma réplica para evitar perdas ou
vendas duplicadas. Não habilitar como contingência comercial real.

## Fluxo existente

1. Em Cloudflare de testes, definir a variável OFFLINE_SYNC_ENABLED=true,
   depois de aplicar migration 0046_offline_gateway.sql (após 0044 e 0045
   reservadas para telemetria). Por padrão a integração fica desligada.
2. Owner faz login, entra em Configurações > Funcionamento offline,
   seleciona a filial e autoriza o PC para cópia inicial. A API
   POST /api/v1/tenants/{tenantId}/offline/gateways devolve gateway ID e
   credencial de 256 bits UMA VEZ. O D1 guarda apenas hash SHA-256.
   Salvar segredo só no PC com permissões do sistema operacional.
3. No PC do estabelecimento instalar Node 22+, baixar a PWA e configurar
   HTTPS local com certificado de autoridade confiável pelos celulares.
   Usar BANCO SQLITE NOVO, isolado, disco criptografado e firewall LAN.
4. Variáveis no PC (secrets não devem entrar no Git, atalhos públicos, QR
   ou logs):
    PDV_OFFLINE_REPLICA_ENABLED=true
    OFFLINE_CLOUD_ORIGIN=https://<worker-cloudflare>/
    OFFLINE_TENANT_ID=<id>
    OFFLINE_BRANCH_ID=<id>
    OFFLINE_GATEWAY_ID=<id-gerado>
    OFFLINE_GATEWAY_TOKEN=<credencial-gerada>
    LOCAL_DB_PATH=<caminho-absoluto-db>
    PDV_PUBLIC_ORIGIN=https://<dns-interno>:8443
    PDV_LAN_PORT=8443
    PDV_BIND_HOST=0.0.0.0
    PDV_TLS_KEY=<arquivo>
    PDV_TLS_CERT=<arquivo>
    AUTH_ENABLED=true
5. Rodar npm run serve:lan. A primeira cópia precisa de internet e falha
   se não houver snapshot válido. O PC recebe SOMENTE empresa, filial,
   perfis, usuários associados e hashes PBKDF2, categorias, catálogo e
   saldos de estoque. Não copia sessões, segredos centrais, outros
   clientes, vendas, caixa, pagamentos, histórico, fotos R2 ou DRE.
6. O garçom escaneia o QR temporário no HTTPS local, entra com o MESMO
   e-mail/senha criado no SaaS e vincula o aparelho à filial. Uma nova
   sessão local é criada; o cookie do domínio Cloudflare não é compartilhado.
7. Desligando apenas a internet, mantendo o Wi-Fi e PC: login e consulta
   local continuam até no máximo 24 horas desde a última cópia; venda
   offline continua bloqueada (HTTP 503). O PC consulta a nuvem a cada
   60 segundos para atualizar a cópia, se possível.
8. Owner pode revogar o gateway por DELETE
   /api/v1/tenants/{tenantId}/offline/gateways/{gatewayId}.
   Se a Cloudflare recusar credencial ou detectar incompatibilidade de
   segurança, o servidor local marca ERROR e bloqueia autenticação.

## Salvaguardas

- NUNCA fazer export integral do D1 multitenant nem copiar cookies.
- Snapshot isolado por tenant/branch, checagem de schema/foreign keys,
  transação atômica SQLite, nunca sobrescrever instalação com vendas.
- Se qualquer conta sincronizada tiver MFA ativo, rejeitar o bootstrap
  (HTTP 412). Não degradar MFA para login de senha simples.
- Com verificação de e-mail obrigatória, contas ativas não verificadas
  bloqueiam a cópia.
- O segredo de gateway jamais vai ao QR ou browser do funcionário.
- Não confundir BASELINE_ONLY com sincronização bidirecional READY.

## Bloqueadores para a venda offline funcionar de verdade

1. Snapshot consistente do domínio inteiro (comandas, vendas, ledger,
   crediário, compras, permissões e anexos), cursores e versionamento.
2. Outbox transacional SQLite de todas as mutações, IDs canônicos e
   reenvio idempotente ao D1 com ACK depois da confirmação.
3. Fencing e exclusividade de escrita por filial durante partição WAN,
   conflitos sem "última escrita ganha" em dinheiro/estoque.
4. Revogação, MFA e verificação compatíveis com contas locais, janela
   segura de desconexão e restaurar acessos após sincronização.
5. Testes físicos Safari/iPhone, impressora, múltiplos garçons/caixas,
   queda e volta da rede, concorrência e longa duração.

Somente depois desses testes o sistema deve permitir novas vendas no
modo Funcionamento offline em um cliente real.
