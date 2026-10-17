# ArtiSys PDV — P0 a P4: identidade, primeiro acesso e ativação Cloudflare

## Contexto

A `main` atual mantém o PDV local-first. Instalações novas usam `GET /api/v1/setup/status`, criam o primeiro administrador em `POST /api/v1/setup/admin` e depois fazem login separado em `POST /api/v1/auth/login`. Usuários são locais, identificados por `username`, e senhas são armazenadas com `scrypt` + salt.

A mudança deste documento cobre somente o PDV ArtiSys e implementa P0 a P4 do roadmap aprovado: evolução da identidade local, melhoria do primeiro acesso, separação entre autenticação local e conta comercial, serviço Cloudflare dedicado e ativação comercial por e-mail.

## Objetivo

Permitir que instalações novas sejam ativadas por e-mail/licença e tenham um primeiro acesso simples, sem prejudicar instalações já existentes e sem tornar Cloudflare requisito para a operação diária do PDV.

## Requisito principal de compatibilidade

Instalações existentes devem continuar funcionando após upgrade sem qualquer ação obrigatória do cliente.

Regras obrigatórias:

1. `username + senha` continua válido para todos os usuários existentes.
2. `email` é adicionado como campo opcional; migrations existentes nunca são reescritas.
3. nenhum usuário existente recebe e-mail inventado, placeholder ou obrigatório.
4. uma instalação existente já configurada (`countUsers() > 0`) nunca é redirecionada para ativação comercial automaticamente.
5. Cloudflare indisponível nunca bloqueia login local, caixa, venda, estoque, impressão, fiscal, devolução ou demais fluxos já existentes.
6. a ativação comercial é aplicada apenas a instalações novas quando explicitamente habilitada/configurada.
7. endpoints atuais de setup/login preservam contratos existentes sempre que possível.
8. rollback de app não deve deixar o banco em estado ilegível para a versão anterior além das colunas/tabelas adicionais toleradas pelo SQLite e pelo código legado.

## Escopo

### P0 — evolução da identidade local

Adicionar migration de release com:

- `users.email TEXT NULL`
- `users.email_normalized TEXT NULL`
- `users.email_verified_at TEXT NULL`
- `users.password_changed_at TEXT NULL`
- índice único parcial para `email_normalized` quando não nulo/vazio

Adicionar tabela local `installation_activation` com no máximo uma ativação vigente por instalação:

- `installation_id TEXT PRIMARY KEY`
- `account_email TEXT NOT NULL`
- `license_id TEXT NOT NULL`
- `activated_at TEXT NOT NULL`
- `activation_source TEXT NOT NULL`
- `metadata_json TEXT NULL`

Não criar tabela local de reset de senha nesta entrega; recuperação por e-mail fica para a fase seguinte ao P4.

O `catalog-service` passa a:

- normalizar e-mail por trim + lowercase;
- aceitar e-mail opcional em `createUser`/`upsertUser`;
- expor e-mail no `publicUser` somente quando presente;
- manter `username` obrigatório e compatível;
- preservar `verifyUserPassword(username,password)`.

### P1 — primeiro acesso sem login duplicado

Para instalações em modo local legado:

1. `setup/status` retorna `needsSetup:true` quando não há usuários.
2. a UI apresenta “Primeiro acesso ao ArtiSys”.
3. cria administrador com nome, usuário, senha, confirmação e e-mail opcional.
4. após `setupAdmin`, a UI executa `login` automaticamente usando as credenciais recém-criadas.
5. o usuário entra diretamente na home.

A API `POST /api/v1/setup/admin` permanece disponível e continua aceitando payload legado sem `email`.

### P2 — separar autenticação local de conta comercial

A autenticação operacional continua totalmente local.

Cloudflare não valida senha de operador e não recebe hash de senha local.

O PDV passa a ter uma abstração de conta comercial com configuração explícita:

- o desktop oficial usa por padrão `https://pdv-artisys.sistema-artisys.workers.dev` como `PDV_ACCOUNT_ENDPOINT`;
- `PDV_REQUIRE_COMMERCIAL_ACTIVATION=true` é o padrão do produto distribuído para toda instalação nova;
- um override explícito `PDV_REQUIRE_COMMERCIAL_ACTIVATION=false` existe apenas para desenvolvimento/uso interno; ausência de endpoint nunca libera silenciosamente uma instalação nova;
- instalações existentes já configuradas preservam o funcionamento local após upgrade e não dependem da disponibilidade do Cloudflare para operar.

O desktop/backend pode chamar o serviço remoto apenas para ativação/licença. Depois de ativado, o login continua local.

### P3 — Worker Cloudflare dedicado

Criar `cloudflare/account/`, separado de `cloudflare/telemetry/`.

Responsabilidades desta entrega:

- `GET /health`
- `POST /v1/activation/request`
- `POST /v1/activation/verify`
- `GET /v1/license/status`

A estrutura deve ser self-contained, testável localmente e sem dependência do Worker de telemetria.

D1 mínimo:

- `accounts`
- `licenses`
- `activation_tokens`
- `installations`
- `email_delivery_log`

A camada de envio deve ser abstraída. O core do PDV não depende dela; o Worker pode usar Cloudflare Email Sending quando configurado. Em desenvolvimento/testes deve existir transporte fake/in-memory.

Dados proibidos no serviço remoto:

- hashes/salts de senha local;
- vendas;
- clientes do estabelecimento;
- estoque;
- caixa;
- dados fiscais;
- credenciais locais de operador.

### P4 — ativação comercial por e-mail/licença

Quando `PDV_REQUIRE_COMMERCIAL_ACTIVATION=true` e a instalação ainda não possui usuários nem ativação local:

1. `setup/status` informa que ativação comercial é necessária.
2. a UI mostra “Ativar ArtiSys”.
3. usuário informa e-mail da compra e código de ativação.
4. backend local chama `POST /v1/activation/verify` no serviço configurado.
5. em caso de sucesso, persiste `installation_activation`.
6. UI segue para criação do administrador local, pré-preenchendo o e-mail validado.
7. cria admin local e faz login automático.

O primeiro administrador continua local. A ativação comercial não cria sessão operacional remota.

## Contratos locais propostos

### `GET /api/v1/setup/status`

Resposta compatível, adicionando campos opcionais:

```json
{
  "needsSetup": true,
  "activationRequired": false,
  "activationCompleted": false,
  "activatedEmail": null
}
```

Clientes antigos continuam consumindo `needsSetup` sem quebra.

### `POST /api/v1/setup/admin`

Payload legado continua válido:

```json
{
  "name": "Administrador",
  "username": "admin",
  "password": "senha-forte"
}
```

Novo payload opcional:

```json
{
  "name": "Administrador",
  "username": "admin",
  "email": "cliente@exemplo.com",
  "password": "senha-forte"
}
```

Se ativação comercial for obrigatória, o endpoint recusa setup antes da ativação local persistida.

### Novos endpoints locais

`POST /api/v1/setup/activation/request`

```json
{ "email": "cliente@exemplo.com" }
```

`POST /api/v1/setup/activation/verify`

```json
{
  "email": "cliente@exemplo.com",
  "code": "123456"
}
```

Esses endpoints são pré-auth apenas durante estado de instalação não configurada. Depois que existe usuário, devem responder conflito/indisponível para reduzir superfície de ataque.

## Identidade da instalação

Usar a identidade estável já disponível no runtime/configuração de instalação. Não derivar identidade de hostname, caminho local ou e-mail.

O Worker associa `installation_id` à licença somente após token válido.

## Segurança

- códigos de ativação nunca persistidos em texto claro no D1;
- armazenar hash do código/token;
- uso único;
- expiração configurável (padrão 30 minutos para ativação);
- limite de tentativas;
- rate limit lógico por e-mail/licença/instalação;
- respostas que não exponham detalhes internos de licença além do necessário;
- `cache-control: no-store` em endpoints sensíveis;
- segredos Cloudflare somente em secrets/bindings;
- logs nunca incluem código de ativação completo;
- `PDV_ACCOUNT_ENDPOINT` somente HTTPS fora de desenvolvimento/teste.

## Compatibilidade de upgrade

### Instalação existente com usuários

Após migration:

- colunas de e-mail ficam nulas;
- `setup/status.needsSetup` continua refletindo somente a existência do primeiro usuário local;
- uma instalação sem registro de ativação permanece com ativação comercial pendente mesmo se já possuir usuários locais;
- login local é bloqueado até a ativação inicial ser concluída; depois da ativação, username + senha continuam locais e funcionam offline;
- nenhuma chamada ao Cloudflare é feita para autenticação;
- nenhuma tela de ativação é exibida.

### Instalação nova sem configuração comercial

Com defaults:

- comportamento continua local;
- primeiro acesso melhorado;
- e-mail é opcional;
- setup + login automático.

### Instalação nova comercial

Somente com `PDV_REQUIRE_COMMERCIAL_ACTIVATION=true` e endpoint configurado:

- ativação precede criação do admin;
- falha de rede impede somente a primeira ativação, não a operação de instalações já ativadas.

## UX

### Modo local

Título: `Primeiro acesso ao ArtiSys`

Campos:

- Nome
- Usuário
- E-mail (opcional)
- Senha
- Confirmar senha

Ações:

- mostrar/ocultar senha
- `Criar administrador e entrar`

### Modo comercial

Etapa 1 — `Ativar ArtiSys`

- e-mail usado na compra
- código recebido por e-mail
- `Ativar`
- ação `Reenviar código`

Etapa 2 — `Criar administrador`

- e-mail validado bloqueado/readonly
- nome
- usuário
- senha
- confirmar senha
- `Criar e entrar`

## Testes obrigatórios

### Migration/compatibilidade

- banco legado com usuário existente migra sem perda de dados;
- usuário legado continua autenticando;
- e-mail nulo é aceito;
- e-mail novo é normalizado e único;
- migration idempotente.

### API

- `setup/status` preserva `needsSetup`;
- setup legado funciona sem e-mail;
- setup novo funciona com e-mail;
- instalação existente não exige ativação;
- instalação comercial nova exige ativação;
- ativação válida libera setup;
- ativação inválida/expirada não libera setup;
- endpoints de ativação deixam de aceitar chamadas depois do setup.

### UI/E2E

- instalação local nova: setup -> login automático -> home;
- instalação existente: login tradicional sem tela nova obrigatória;
- instalação comercial nova: ativação -> criação admin -> login automático;
- confirmação de senha divergente bloqueia submit;
- indisponibilidade Cloudflare em instalação já configurada não afeta login/operação.

### Cloudflare Worker

- health;
- request/verify de ativação;
- token hashado;
- token single-use;
- expiração;
- licença inválida/inativa;
- idempotência de instalação já ativada;
- transporte de e-mail fake em testes.

## Gates

Antes de merge:

- `npm test`
- testes dedicados de auth/setup/activation
- testes do Worker `cloudflare/account`
- `npm run lint:core`
- `npm run lint:desktop`
- `npm run verify`
- E2E de instalação legada e instalação nova

## Fora de escopo desta entrega

- recuperação de senha por e-mail;
- checkout/pagamento real;
- portal de cliente;
- gestão web de licenças;
- mudança do login operacional para autenticação remota;
- obrigar e-mail em caixa/gerente;
- SSO.

## Critério de conclusão

P0–P4 estão concluídos quando:

1. uma instalação existente em `main` pode atualizar e continuar usando usuário/senha sem qualquer cadastro adicional;
2. uma instalação nova local passa pelo primeiro acesso sem login duplicado;
3. uma instalação nova comercial pode ser ativada por e-mail/código via serviço Cloudflare dedicado;
4. após ativação, o administrador é criado localmente e o PDV opera offline normalmente;
5. a indisponibilidade do serviço Cloudflare não prejudica instalações existentes ou já ativadas;
6. todos os gates e testes de regressão passam.
