# PDV ArtiSys — Core E02–E06 Design

## Escopo

Implementar o coração operacional do PDV ArtiSys sem depender da UI final:

- E02 — banco e servidor local;
- E03 — cadastros;
- E04 — estoque;
- E05 — motor de vendas;
- E06 — caixa e pagamentos.

O sistema continuará desktop/local-first, operando na rede LAN do cliente e sem dependência de SaaS/web.

## Decisão arquitetural

### Abordagem escolhida

Usar um **serviço local central** como autoridade da rede. O banco fica somente na máquina servidor. Os terminais conversam com o serviço por API LAN e nunca abrem o arquivo de banco por compartilhamento de pasta.

Banco inicial: **SQLite**, acessado exclusivamente pelo processo servidor.

Motivos:

- instalação e suporte simples no cliente;
- zero necessidade de administrar um SGBD separado;
- bom desempenho para o perfil inicial de um PDV pequeno/médio;
- concorrência controlada porque existe um único processo de escrita;
- migrations, backup e restore simples;
- possibilidade futura de substituir o adapter por PostgreSQL sem alterar domínio/UI.

Não será usado SQLite diretamente sobre SMB/Windows Share.

### Alternativas descartadas nesta fase

1. PostgreSQL local desde o início: mais forte para alta concorrência, porém aumenta muito a instalação, backup, atualização e suporte em cliente.
2. Banco embutido aberto diretamente por cada terminal: simples no começo, mas cria risco de corrupção, locking de arquivo e inconsistência em LAN.

## Visão geral

```text
Terminal 01 ----\
Terminal 02 -----+---- HTTP/LAN ----> PDV Local Server
Terminal 03 ----/                         |
                                          +--> Application Services
                                          +--> Domain
                                          +--> SQLite
                                          +--> Domain Event Outbox
                                          +--> EventBus / Dispatcher
```

A UI futura chama somente Application/API. Regras de estoque, venda e caixa não ficam em componentes visuais.

## Estrutura prevista

```text
server/
  local-server.js
  router.js
  middleware/
    error-handler.js
    request-context.js

js/core/
  database/
    sqlite-database.js
    migrations.js
    transaction.js
    outbox-store.js
    effect-store.js

js/domains/
  catalog/
    product-service.js
    customer-service.js
    supplier-service.js
    user-service.js
  inventory/
    inventory-service.js
  sales/
    sale-service.js
    pricing.js
  cash/
    cash-session-service.js
    payment-service.js

js/repositories/
  product-repository.js
  customer-repository.js
  supplier-repository.js
  user-repository.js
  inventory-repository.js
  sale-repository.js
  cash-repository.js
```

## E02 — Banco e servidor local

### Banco

O schema inicial terá pelo menos:

- schema_migrations;
- domain_events;
- domain_event_effects;
- users;
- categories;
- products;
- customers;
- suppliers;
- inventory_balances;
- inventory_movements;
- sales;
- sale_items;
- payments;
- cash_sessions;
- cash_movements;
- audit_log.

### Regras

- foreign keys ativas;
- WAL mode;
- busy timeout;
- migrations versionadas e idempotentes;
- valores monetários persistidos em centavos inteiros;
- quantidade em unidade decimal normalizada;
- timestamps ISO-8601;
- soft delete quando histórico depender da entidade;
- transações explícitas nas operações críticas.

### Serviço LAN

O servidor expõe API local versionada, inicialmente `/api/v1`.

Endpoints administrativos e operacionais serão separados. Toda mutação recebe um request/mutation id para auditoria e deduplicação futura.

O serviço deve poder escutar em `127.0.0.1` para modo standalone e em IP LAN configurável para modo servidor.

## E03 — Cadastros

### Produtos

Campos mínimos:

- id;
- sku interno;
- código de barras;
- descrição;
- categoria;
- unidade;
- preço de venda em centavos;
- custo em centavos;
- estoque controlado;
- estoque mínimo;
- ativo;
- timestamps.

Código de barras e SKU devem ser únicos quando informados.

### Clientes

Campos mínimos:

- id;
- nome;
- documento;
- telefone;
- email;
- observações;
- ativo.

Documento é normalizado antes da persistência.

### Fornecedores

Cadastro básico com documento, nome, contato e status.

### Usuários e permissões

Perfis iniciais:

- admin;
- gerente;
- caixa.

Permissões serão avaliadas no servidor, nunca somente na UI.

## E04 — Estoque

### Autoridade

`inventory_movements` é o histórico imutável. `inventory_balances` é a projeção atual para leitura rápida.

### Tipos iniciais

- opening;
- purchase;
- sale;
- sale-cancel;
- adjustment-in;
- adjustment-out;
- inventory-count.

### Regras

- nenhuma alteração direta de saldo fora do InventoryService;
- cada movimento possui referência de origem;
- baixa de venda é idempotente via EventBus/effectKey;
- cancelamento gera movimento inverso, não apaga histórico;
- estoque negativo será bloqueado por padrão, com política configurável futura;
- estoque mínimo poderá publicar `inventory.low-stock`.

## E05 — Motor de vendas

### Estados

- OPEN;
- SUSPENDED;
- COMPLETED;
- CANCELLED.

### Operações

- abrir venda;
- adicionar item;
- alterar quantidade;
- remover item;
- aplicar desconto permitido;
- suspender;
- retomar;
- registrar pagamentos;
- concluir;
- cancelar.

### Cálculo

O servidor é autoridade sobre preço final e totais.

Todos os cálculos monetários usam centavos inteiros. Nenhum total vindo da UI é confiado diretamente.

### Conclusão

`completeSale()` executa em transação:

1. valida estado OPEN;
2. valida itens;
3. recalcula subtotal/descontos/total;
4. valida pagamentos;
5. persiste venda/pagamentos;
6. altera status para COMPLETED;
7. grava `sale.completed` na outbox;
8. commit.

Depois do commit, o dispatcher aplica efeitos idempotentes:

- `inventory.sale-completed`;
- `receipt.sale-completed` futuramente;
- `fiscal.sale-completed` futuramente;
- `audit.sale-completed`.

A venda concluída não depende de a impressora ou o fiscal estarem online naquele instante.

### Cancelamento

Venda concluída não é apagada. O cancelamento gera `sale.cancelled`, audit trail e reversões derivadas idempotentes.

## E06 — Caixa e pagamentos

### Sessão de caixa

Estados:

- OPEN;
- CLOSED.

Operações:

- abertura com fundo inicial;
- suprimento;
- sangria;
- entrada de venda;
- estorno/cancelamento;
- fechamento;
- conferência e divergência.

Apenas uma sessão aberta por terminal/operador conforme regra configurada.

### Formas de pagamento iniciais

- CASH;
- PIX;
- DEBIT_CARD;
- CREDIT_CARD;
- OTHER.

O modelo já deve aceitar múltiplos pagamentos na mesma venda.

### Dinheiro e troco

Somente CASH participa do cálculo de troco. O troco é persistido na venda/caixa para auditoria.

### Fechamento

O fechamento registra:

- saldo inicial;
- entradas por forma de pagamento;
- suprimentos;
- sangrias;
- cancelamentos/estornos;
- esperado em dinheiro;
- valor contado;
- divergência;
- operador e timestamps.

## EventBus

O EventBus existente é infraestrutura obrigatória para efeitos derivados. Eventos críticos entram primeiro na outbox dentro da transação canônica e só então são despachados.

Exemplos:

- `sale.completed` -> estoque, auditoria, fiscal, impressão;
- `sale.cancelled` -> reversão de estoque/auditoria;
- `cash-session.opened` -> auditoria;
- `cash-session.closed` -> auditoria/relatórios;
- `inventory.low-stock` -> alertas futuros.

Cada efeito crítico usa `eventId + effectKey` para idempotência.

## Concorrência

O SQLite é acessado por um único serviço central. Operações de escrita críticas rodam em transação. A API não expõe SQL arbitrário.

Para evitar dupla finalização de venda:

- status é revalidado dentro da transação;
- atualização usa condição de estado esperado;
- requisições repetidas podem usar mutationId/idempotency key.

## Segurança

- bind LAN configurável;
- token de sessão/autorização interno;
- hashes de senha, nunca senha em texto puro;
- roles verificadas no servidor;
- validação de payload;
- limites de tamanho;
- logs sem dados sensíveis desnecessários;
- endpoints administrativos protegidos;
- nenhuma operação de filesystem exposta diretamente ao terminal.

## Testes

### Unitários

- pricing;
- regras de venda;
- estoque;
- caixa;
- permissões;
- idempotência.

### Integração

- migrations em banco vazio;
- venda completa -> outbox -> baixa de estoque;
- retry de evento sem dupla baixa;
- cancelamento -> reposição de estoque;
- múltiplos pagamentos;
- abertura/sangria/suprimento/fechamento;
- concorrência de conclusão;
- constraints de SKU/código de barras.

### Rede

- servidor inicia em porta configurada;
- healthcheck;
- terminal indisponível não afeta servidor;
- restart do servidor preserva banco/outbox;
- evento pendente volta a ser reconciliado no bootstrap.

## Critério de conclusão E02–E06

O bloco estará concluído quando for possível, sem UI final:

1. iniciar o servidor local;
2. cadastrar produto/cliente/usuário;
3. registrar estoque;
4. abrir caixa;
5. criar venda com itens;
6. receber em uma ou mais formas;
7. concluir a venda;
8. baixar estoque via evento idempotente;
9. consultar a venda e o caixa;
10. cancelar uma venda e reverter estoque;
11. fechar o caixa;
12. reiniciar o servidor sem perder dados nem eventos pendentes.

## Fora do escopo deste bloco

- UI final;
- impressão real;
- integração fiscal real;
- TEF/POS integrado;
- balança;
- sincronização cloud;
- SaaS;
- multiempresa remoto.
