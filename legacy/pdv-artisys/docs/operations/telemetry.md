# Telemetria e diagnóstico opcional

A telemetria do ArtiSys é **opt-in, privacy-first e fail-open**. Ela existe para mapear fluxos reais, recorrência de bugs, versões afetadas e falhas técnicas sem transformar nuvem em requisito do PDV.

## Estado padrão e consentimento

A coleta nasce desligada:

```text
telemetry.enabled = false
telemetry.diagnostics = false
```

A autorização inicial não é feita em Configurações. Na primeira abertura da versão que introduz a telemetria, o ArtiSys apresenta a caixa **Privacidade e diagnóstico do ArtiSys** como parte da conclusão da atualização. Isso é necessário porque a versão anterior do aplicativo ainda não possui o novo código de consentimento para exibi-lo antes da instalação.

O usuário pode escolher:

- **Permitir e continuar**: registra o aceite versionado e habilita métricas de uso + diagnóstico;
- **Continuar sem compartilhar**: registra a decisão e mantém toda coleta desligada.

A escolha registra `telemetry.consent_version` e a data correspondente. Sem versão de consentimento aceita e `telemetry.consent_accepted_at`, o núcleo de telemetria não coleta nada mesmo se `telemetry.enabled=true` for escrito manualmente.

Depois de um aceite válido, **Configurações > Privacidade e diagnóstico** serve para desligar ou religar os envios já autorizados. A tela não pode ser usada para conceder a autorização inicial. Se os termos mudarem, basta aumentar a versão exigida para reapresentar o aviso.

Nas atualizações seguintes, caso ainda exista uma versão de termos pendente, o mesmo consentimento pode aparecer no fluxo do updater antes da instalação.

## Dados enviados

A primeira versão trabalha somente com eventos allowlisted, como início/conclusão de venda, devolução, navegação por rota normalizada e categorias técnicas de falha.

Identificadores de telemetria são UUIDs aleatórios próprios:

- `installation_id`;
- `terminal_id` de telemetria;
- `session_id`;
- versão do aplicativo;
- release/build;
- versão do schema local.

Eles não são derivados de MAC, hostname, usuário Windows, CPF/CNPJ, serial de equipamento ou ID comercial transmitido.

## Dados proibidos

A implementação bloqueia campos e valores associados a:

- nome ou identidade de cliente/operador;
- CPF/CNPJ;
- e-mail, telefone e endereço;
- senha, token, Authorization e credenciais;
- certificado, chave privada e CSC;
- XML/DANFE e conteúdo fiscal livre;
- PAN/CVV e dados de cartão;
- observações, mensagens livres, conteúdo de recibos e texto digitado.

O cliente aplica allowlist antes da fila local e o Worker repete a validação antes de persistir qualquer agregado.

## Funcionamento offline

Eventos aceitos entram em uma fila SQLite limitada no **servidor autoritativo**. Terminais LAN não abrem SQLite local nem recebem a credencial Cloudflare.

O envio é assíncrono em lotes. Falha de DNS, internet, Worker, D1 ou Analytics Engine não desfaz nem bloqueia venda, devolução, impressão, estoque, fiscal, restaurante, login ou startup.

A fila tem limite padrão de 5.000 eventos e prioriza retenção de diagnóstico/erro quando precisa descartar registros antigos.

## Cloudflare

O backend hospedado é opcional e isolado em `cloudflare/telemetry/`:

- **Workers**: endpoint HTTP;
- **Analytics Engine**: stream de eventos e métricas;
- **D1**: instalações, hash da credencial, fingerprints e receipts idempotentes de baixo volume.

D1 não é usado como armazenamento de todos os cliques/eventos.

## Credencial

Cada instalação possui uma credencial exclusiva de ingestão, separada de login, LAN, fiscal e demais segredos do PDV.

No Electron servidor ela é armazenada usando `safeStorage`. O Worker grava somente o hash; o texto claro é retornado apenas no primeiro registro/bootstrap.

## Provisionar automaticamente

Pré-requisitos:

- Node.js 22+;
- conta Cloudflare;
- acesso ao Wrangler (`npx wrangler` funciona sem instalação global).

Execute na raiz do repositório:

```bash
npm run telemetry:cloudflare:setup
```

Na primeira execução o script solicita/valida a autenticação do Wrangler e então:

1. localiza ou cria `artisys-telemetry` no D1;
2. grava o `database_id` no `wrangler.jsonc`;
3. confirma o binding `ANALYTICS`;
4. aplica as migrations D1 via binding `DB` e `--remote`;
5. publica o Worker;
6. valida `GET /health`;
7. imprime a URL final e a variável `PDV_TELEMETRY_ENDPOINT`.

O fluxo é idempotente: uma nova execução reutiliza o D1 existente quando existe exatamente um banco com o nome esperado.

## Ativar o endpoint no ArtiSys

Depois do provisionamento, configure explicitamente o host oficial:

```bash
PDV_TELEMETRY_ENDPOINT=https://<worker>.workers.dev
```

Endpoint vazio mantém o envio remoto desativado. Cloudflare nunca é dependência silenciosa do produto local-first.

No servidor headless, qualquer credencial externa necessária ao modo de envio deve ser fornecida explicitamente pelo operador; a ausência dela não impede o servidor de iniciar.

## Testes

Testes focados:

```bash
node --test test/telemetry-schema.test.js \
  test/telemetry-queue.test.js \
  test/telemetry-service.test.js \
  test/telemetry-consent-gate.test.js \
  test/telemetry-runtime.test.js \
  test/telemetry-effects.test.js \
  test/telemetry-desktop.test.js \
  test/telemetry-settings-ui.test.js \
  test/updater-telemetry-consent.test.js \
  test/updater-telemetry-consent-state.test.js \
  test/updater-telemetry-consent-first-run.test.js \
  test/cloudflare-telemetry-setup.test.js

npm run test:telemetry:cloudflare
```

Gate completo:

```bash
npm run verify:release
```

## Retenção

`event_receipts` é usado apenas para deduplicação de mutações agregadas de erro/controle e possui purge periódico. O Worker não cria receipt D1 para eventos comuns de fluxo.

Políticas de retenção, quotas e preços de Cloudflare devem ser revisadas antes de escala comercial, pois são condições externas ao código do ArtiSys e podem mudar.
