# PDV ArtiSys — Core E02–E06

## Resultado

O bloco E02–E06 entrega o coração operacional do PDV antes da definição da UI final.

```text
Terminal desktop
      |
      | HTTP/LAN /api/v1
      v
PDV Local Server
      |
      +--> autenticação/autorização
      +--> catálogo
      +--> vendas
      +--> estoque
      +--> caixa
      |
      +--> SQLite
      |      + migrations
      |      + outbox
      |      + effect keys
      |
      +--> EventBus / Dispatcher
```

O arquivo SQLite nunca deve ser aberto pelos terminais por pasta compartilhada. Existe um único processo servidor responsável pelas gravações.

## Reuso aplicado

### PDVNexus

Foram portados e refinados contratos maduros do PDV anterior:

- resolução de pagamentos e troco;
- validação de crédito;
- movimentos e inventário de estoque;
- cálculo de fechamento de caixa;
- ciclo de conclusão/cancelamento de vendas;
- padrão de `node:sqlite`/`DatabaseSync`;
- padrão de servidor HTTP local.

As regras foram convertidas para centavos inteiros e separadas da persistência/UI.

### CLINICASMEDICAS

Foram reaproveitados os padrões de:

- migrations versionadas/idempotentes;
- auditoria com sanitização de campos sensíveis.

## Mudanças deliberadas em relação ao código antigo

Não foram copiados:

- dinheiro em `float`;
- snapshot JSON como banco principal;
- reset destrutivo de dados quando muda a versão instalada;
- senha em texto simples;
- baixa de estoque dentro da função que conclui venda;
- CORS wildcard;
- autorização baseada apenas no renderer.

## E02 — Banco e servidor local

SQLite via `node:sqlite` e `DatabaseSync`, com foreign keys, `busy_timeout=5000`, WAL para arquivo, transações `BEGIN IMMEDIATE` e migrations não destrutivas.

Tabelas principais: `users`, `categories`, `products`, `customers`, `suppliers`, `inventory_balances`, `inventory_movements`, `sales`, `sale_items`, `payments`, `cash_sessions`, `cash_movements`, `audit_log`, `domain_events` e `domain_event_effects`.

A API LAN usa `/api/v1`, sessão emitida pelo servidor, roles verificadas no servidor, limite de body e CORS sem wildcard por padrão.

## E03 — Cadastros

Categorias, produtos, clientes, fornecedores e usuários `admin`, `manager`, `cashier`. SKU/barcode são únicos quando informados. Documentos são normalizados. Senhas usam `scrypt` com salt aleatório e comparação em tempo seguro.

## E04 — Estoque

`inventory_movements` é histórico imutável; `inventory_balances` é projeção de leitura. Há abertura, compra, ajustes, inventário, baixa de venda, reversão por cancelamento e baixo estoque. Estoque negativo é bloqueado.

Baixa/reversão usam duas proteções contra repetição: `eventId + effectKey` e unicidade de movimento por evento/produto/tipo.

## E05 — Vendas

Estados: `OPEN`, `SUSPENDED`, `COMPLETED`, `CANCELLED`. O servidor recalcula preço/totais. Há desconto, múltiplos pagamentos, crédito de cliente, conclusão e cancelamento gerencial com motivo.

`completeSale()` grava venda, pagamentos e `sale.completed` na mesma transação. Estoque e caixa são efeitos pós-commit do EventBus. `cancelSale()` preserva histórico e emite `sale.cancelled`.

## E06 — Caixa

Uma sessão OPEN por terminal, fundo inicial, suprimento, sangria, pagamentos de venda, reversão e fechamento com esperado/contado/divergência. Movimentos são imutáveis e venda/reversão são idempotentes.

## Fluxo integrado

```text
completeSale()
   |
   +--> sales/payments
   +--> domain_events: sale.completed
   |
  COMMIT
   |
Dispatcher
   |
   +--> inventory.sale-completed
   +--> cash.sale-completed
```

No cancelamento, efeitos equivalentes fazem a reversão sem apagar histórico. Se um subscriber futuro falhar, o evento fica pendente; no retry, efeitos já aplicados não se repetem.

## Segurança atual

- banco não exposto pela rede;
- statements parametrizados;
- senha hash/salt;
- sessão randômica com expiração;
- roles verificadas no servidor;
- limite de body e JSON inválido rejeitado;
- CORS sem `*` por padrão;
- bind LAN exige `PDV_INSTALL_TOKEN` no entrypoint;
- auditoria remove chaves sensíveis.

## Runtime

Em Node.js 22.16.0, `node:sqlite` funciona, mas ainda emite `ExperimentalWarning`. O runtime Electron final deve manter uma versão com `DatabaseSync` ou receber adapter equivalente sem alterar os serviços de domínio.

## Verificação

A suíte cobre migrations/rollback, catálogo/hashes, pagamento misto/troco/crédito, estoque, EventBus/outbox/retry, lifecycle de venda, fechamento de caixa, restart do SQLite e API HTTP completa.

## Fora deste bloco

E07+ cobre impressora/leitor/balança/gaveta, NFC-e/NF-e, TEF, backup/restore operacional, UI final, relatórios, instalador/atualizador e piloto em cliente.
