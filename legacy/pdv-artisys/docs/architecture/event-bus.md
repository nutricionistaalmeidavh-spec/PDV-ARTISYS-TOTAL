# PDV ArtiSys — Domain Event Bus

## Objetivo

O PDV usa um EventBus de domínio para desacoplar o núcleo operacional da UI e dos efeitos derivados. Uma operação canônica altera o estado uma vez, grava um evento durável na outbox e, depois, os módulos interessados processam esse evento.

O módulo é derivado da arquitetura de EventBus criada no Plennus Clinic em 2026-09-09, mas foi generalizado para o domínio de PDV e preparado para efeitos síncronos ou assíncronos.

## Fluxo

```text
UI / Atalho / Leitor / API local
            |
            v
      Application Service
            |
      valida comando
            |
            v
      transação canônica
       |             |
       |             +--> Domain Event Outbox
       v
 banco operacional
            |
            v
   DomainEventDispatcher
            |
            v
      DomainEventBus
     /      |       \
 Estoque  Fiscal  Impressão ...
     \      |       /
      efeitos idempotentes
```

## Componentes incorporados

### `js/core/domain-event-bus.js`

- `subscribe(eventName, handler)`
- `publish(event)` para subscribers síncronos
- `publishAsync(event)` para efeitos assíncronos
- validação mínima do envelope
- prevenção de registro duplicado do mesmo handler
- isolamento de falhas entre subscribers
- `unsubscribe` retornado por `subscribe`
- zero dependências externas

### `js/core/domain-event-dispatcher.js`

Processa eventos pendentes de uma outbox persistente. Um evento só é marcado como despachado quando todos os subscribers terminam sem falha.

Contrato esperado do adaptador de outbox:

```js
{
  async listPending(limit) {},
  async markDispatched(eventId) {},
  async recordFailure(eventId, message) {}
}
```

A implementação concreta será ligada ao banco escolhido para o servidor local. O EventBus não depende de SQLite, PostgreSQL ou outro banco específico.

### `js/core/idempotent-domain-effect.js`

Wrapper de efeitos derivados baseado em `effectKey`. Ele impede que uma reconciliação repita um efeito já aplicado.

Contrato esperado do `effectStore`:

```js
{
  async hasApplied(eventId, effectKey) {},
  async markApplied(effect) {}
}
```

Exemplos de chaves estáveis:

- `inventory.sale-completed`
- `receipt.sale-completed`
- `fiscal.sale-completed`
- `audit.cash-session-closed`

### `js/core/pdv-event-types.js`

Catálogo canônico inicial de nomes de eventos para vendas, pagamentos, caixa, estoque, impressão, fiscal, hardware e backup.

## Envelope canônico

```js
{
  eventId,
  type,
  aggregate,
  aggregateId,
  occurredAt,
  actor: {
    userId,
    role,
    terminalId
  },
  source,
  mutationId,
  payload
}
```

`eventId` deve ser estável por operação. `mutationId` deve ser propagado quando a operação vier de outro terminal da LAN para correlação e deduplicação ponta a ponta.

## Outbox durável

Quando o banco operacional for definido, a implementação deve preservar este modelo lógico:

```sql
CREATE TABLE domain_events (
  event_id        TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  aggregate_type  TEXT NOT NULL,
  aggregate_id    TEXT NOT NULL,
  mutation_id     TEXT,
  source          TEXT NOT NULL,
  actor_json      TEXT NOT NULL,
  payload_json    TEXT NOT NULL,
  occurred_at     TEXT NOT NULL,
  dispatched_at   TEXT,
  last_error      TEXT
);

CREATE TABLE domain_event_effects (
  event_id        TEXT NOT NULL,
  effect_key      TEXT NOT NULL,
  aggregate_type  TEXT NOT NULL,
  aggregate_id    TEXT NOT NULL,
  applied_at      TEXT NOT NULL,
  PRIMARY KEY (event_id, effect_key)
);
```

O SQL acima é o contrato lógico; tipos e sintaxe finais serão adaptados ao banco escolhido.

## Eventos iniciais do PDV

### Venda

- `sale.opened`
- `sale.item-added`
- `sale.item-removed`
- `sale.discount-applied`
- `sale.suspended`
- `sale.resumed`
- `sale.completed`
- `sale.cancelled`

### Pagamento

- `payment.recorded`
- `payment.reversed`

### Caixa

- `cash-session.opened`
- `cash-session.supply-added`
- `cash-session.withdrawal-recorded`
- `cash-session.closed`

### Estoque

- `inventory.movement-recorded`
- `inventory.low-stock`

### Impressão

- `receipt.requested`
- `receipt.printed`
- `receipt.failed`

### Fiscal

- `fiscal.issue-requested`
- `fiscal.issued`
- `fiscal.failed`
- `fiscal.cancelled`

### Infraestrutura

- `hardware.status-changed`
- `backup.completed`
- `backup.failed`

## Regra para `sale.completed`

A finalização da venda não deve chamar diretamente estoque, impressora ou fiscal a partir da UI.

```text
CompleteSaleCommand
      |
      v
SaleService
      |
      +--> grava venda/pagamentos
      +--> grava sale.completed na outbox
      |
      v
commit
      |
      v
Dispatcher
      |
      +--> inventory.sale-completed
      +--> receipt.sale-completed
      +--> fiscal.sale-completed
      +--> audit.sale-completed
```

Se, por exemplo, estoque for aplicado e fiscal falhar, a reconciliação posterior não baixa o estoque novamente: o `effectKey` do estoque já estará registrado.

## Autoridade na rede local

O terminal cliente pode originar comandos, mas a transição canônica e a gravação da outbox devem acontecer no processo/serviço que possui autoridade sobre o banco compartilhado. O EventBus local do terminal não deve produzir efeitos administrativos concorrentes com o servidor.

## Limites

- EventBus não é banco de dados.
- EventBus não é message broker de rede.
- EventBus não substitui transações.
- Eventos não devem transportar segredos ou payloads desnecessariamente grandes.
- UI não deve ser subscriber responsável por consistência de negócio.
- Efeitos críticos precisam ser idempotentes e reconciliáveis.
