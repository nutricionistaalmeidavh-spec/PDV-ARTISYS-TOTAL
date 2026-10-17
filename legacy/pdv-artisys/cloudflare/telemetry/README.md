# ArtiSys Telemetry Worker

Coletor opcional de telemetria do ArtiSys baseado em Cloudflare Workers, D1 e Workers Analytics Engine.

## Princípios

- o PDV continua funcionando sem este Worker;
- telemetria permanece desativada por padrão;
- D1 armazena somente cadastro de instalações, credenciais hashadas, fingerprints e receipts de idempotência;
- eventos de alto volume vão para Analytics Engine;
- payloads com campos não permitidos ou conteúdo sensível são rejeitados no Worker;
- corpos rejeitados e IPs de origem não são persistidos como telemetria.

## Endpoints

- `GET /health`
- `POST /v1/installations/register`
- `POST /v1/events`

O registro retorna uma credencial de ingestão em texto claro apenas na resposta inicial. O D1 armazena somente o hash.

## Desenvolvimento local

```bash
npm --prefix cloudflare/telemetry test
npx --prefix cloudflare/telemetry wrangler dev
```

## Provisionamento recomendado

Na raiz do repositório:

```bash
npm run telemetry:cloudflare:setup
```

O script verifica autenticação do Wrangler, reutiliza ou cria o D1 `artisys-telemetry`, atualiza o binding `DB`, aplica migrations remotas, publica o Worker e valida `/health`.

O binding do Analytics Engine é `ANALYTICS`, dataset `artisys_telemetry`.

Depois do deploy, configure explicitamente o host oficial do ArtiSys com o endpoint exibido:

```bash
PDV_TELEMETRY_ENDPOINT=https://<worker>.workers.dev
```

Não coloque esta URL como requisito do core local. Endpoint vazio significa que nenhum envio remoto é tentado.

## Migrations

As migrations ficam em `migrations/`. O setup aplica:

```bash
npx wrangler d1 migrations apply DB --remote --config cloudflare/telemetry/wrangler.jsonc
```

## Custos e limites

Quotas, preços e limites são controlados pela Cloudflare e podem mudar. Antes de escalar o número de instalações, confira a documentação oficial vigente para Workers, D1 e Analytics Engine.
