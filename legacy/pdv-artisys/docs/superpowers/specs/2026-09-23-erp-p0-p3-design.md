# ERP P0-P3 — Base gerencial, gestão empresarial, conciliação e automação financeira

Data: 2026-09-23
Branch: `feat/erp-p0-p3`

## Objetivo

Evoluir o PDV ArtiSys para entregar ao dono da empresa uma camada de gestão financeira mais completa sem substituir os núcleos já existentes. O PDV continua sendo a fonte de verdade para vendas, compras, estoque, caixa, contas a pagar/receber, auditoria, módulos, backup, importação genérica e EventBus/outbox.

Este escopo cobre P0, P1, P2 e P3 do roadmap aprovado:

- P0: base gerencial integrada;
- P1: gestão empresarial;
- P2: bancos e conciliação;
- P3: automação financeira.

Contabilidade por partidas dobradas, plano de contas, Diário, Razão, Balancete e Balanço ficam fora desta entrega.

## Restrições arquiteturais

1. Não duplicar EventBus, outbox, auditoria, RBAC, backup/restore, sistema de módulos ou importador CSV/XLSX que já existem no PDV.
2. Não substituir `js/domains/finance/finance-service.js`.
3. Reutilizar conceitos e lógica madura do repositório `sistemafinanceiro`, adaptando para o modelo de dados e serviços do PDV.
4. Reusar `@artisys/finance-domain` para normalização, fingerprints, classificação e sugestões de conciliação.
5. Toda nova mutação deve ser idempotente quando houver risco de retry/reprocessamento.
6. Nenhuma conciliação pode efetuar baixa financeira silenciosa. O usuário confirma a ação.
7. O core deve permanecer local-first e sem serviço pago obrigatório.
8. Todas as migrations devem ser incrementais e preservar instalações existentes.

## P0 — Base gerencial integrada

### Capacidades

- categorias financeiras estruturadas para receitas e despesas;
- grupos de DRE;
- centros de custo;
- vínculo consistente `sourceType/sourceId` para lançamentos originados de venda, compra, devolução, caixa e demais fatos suportados;
- regras de projeção que leem os serviços canônicos existentes sem criar um segundo livro financeiro;
- integração do `@artisys/finance-domain` como dependência reutilizável pinada/vendorizada para P2;
- invariantes de idempotência para efeitos derivados e projeções;
- documentação dos contratos de origem financeira que P1-P3 consumirão.

### Critério funcional

Venda, compra, devolução, baixa e estorno devem continuar usando os serviços atuais do PDV. P0 apenas normaliza classificação, origem e dimensões gerenciais necessárias para que relatórios, conciliação e automações funcionem com consistência.

## P1 — Gestão empresarial

### Capacidades

- fluxo de caixa realizado;
- fluxo de caixa projetado em 7, 30 e 90 dias;
- DRE por caixa/realização;
- DRE por competência;
- dashboard do empresário com faturamento, resultado, margem, saldo, a pagar, a receber, vencidos e principais despesas;
- comparação entre períodos;
- análise por categoria e centro de custo;
- drill-down dos indicadores para as entidades de origem quando houver `sourceType/sourceId`.

### Fontes de verdade

- vendas e devoluções: domínio de vendas/devoluções existente;
- custos e margem: snapshots históricos de custo do PDV;
- compras: procurement existente;
- pagar/receber e baixas: finance-service existente;
- caixa: cash service existente.

A camada gerencial é projeção/relatório; não cria um segundo livro financeiro.

## P2 — Bancos e conciliação

### Capacidades

- contas bancárias continuam representadas em `financial_accounts`;
- importação de OFX como novo formato específico de extrato;
- reutilização do importador existente para fluxo de preview/commit quando aplicável;
- armazenamento de lotes de extrato e transações normalizadas;
- `sourceFingerprint` para impedir reimportação da mesma ocorrência;
- `businessFingerprint` apenas para sinalizar possível duplicidade;
- classificação determinística por regras;
- sugestão de conciliação com contas a pagar/receber;
- sugestão de conciliação com recebimentos/vendas quando houver correspondência segura;
- identificação de transferências entre contas próprias;
- confirmação manual antes de criar vínculo ou baixa;
- histórico/auditoria de cada decisão `accepted`, `rejected` ou `manual`.

### Fluxo

`arquivo OFX -> preview -> normalização -> fingerprints -> regras -> sugestões -> revisão do usuário -> commit -> conciliação confirmada`

Nenhuma importação deve alterar saldo de contas a pagar/receber por conta própria.

## P3 — Automação financeira

### Capacidades

- recorrências de contas a pagar e receber;
- geração idempotente por competência/data de vencimento;
- pausa, retomada e encerramento de recorrência;
- alertas de contas vencidas;
- alertas de contas a vencer;
- alerta de saldo baixo por conta;
- alertas derivados de projeção de caixa negativa;
- painel de previsão 7/30/90 dias;
- estado lido/oculto dos alertas;
- nenhuma duplicação da verdade financeira: alertas são derivados dos dados existentes.

## Modelo de integração

```text
Venda / Compra / Caixa / Financeiro
              |
              v
     serviços canônicos do PDV
              |
              +------> EventBus / outbox existentes
              |
              +------> Base gerencial P0
              |
              +------> Reporting / Gestão P1
              |
              +------> Extratos / Conciliação P2
              |
              +------> Recorrências / Alertas P3
```

## UI

A navegação existente será ampliada sem criar um segundo aplicativo.

- `Financeiro`: pagar/receber, contas, extratos e conciliação;
- `Gestão`: visão geral, DRE, fluxo de caixa, custos/margens, centros de custo e comparação;
- `Alertas`: pode aparecer como superfície própria ou painel integrado, conforme encaixe na UI atual.

A interface deve priorizar linguagem de dono de empresa, não terminologia contábil técnica.

## E2E obrigatório

Nenhuma funcionalidade deste escopo é considerada concluída sem fluxo E2E no Electron real registrado em `qa/artisys-qa.config.json` e incluído em `full` e `release.criticalFlows`.

### P0

- `finance-management-base-e2e`
- `finance-source-link-e2e`
- `finance-dimensions-e2e`
- `finance-base-idempotency-e2e`

O fluxo P0 deve cobrir, no mínimo: venda -> caixa; compra -> pagar; baixa parcial/total; devolução/estorno; persistência de categoria/centro; origem rastreável; retry/restart sem duplicação.

### P1

- `business-dashboard-e2e`
- `dre-e2e`
- `cashflow-e2e`
- `period-comparison-e2e`
- `cost-center-e2e`

### P2

- `statement-ofx-e2e`
- `statement-dedupe-e2e`
- `reconciliation-payable-e2e`
- `reconciliation-receivable-e2e`
- `bank-transfer-e2e`

### P3

- `finance-recurrence-e2e`
- `recurrence-idempotency-e2e`
- `financial-alerts-e2e`
- `cash-projection-e2e`

## Critério de aceite dos fluxos

Cada fluxo E2E deve, quando aplicável, cobrir:

1. criação/configuração pela UI;
2. persistência no SQLite através da API/IPC real;
3. leitura de volta na UI;
4. efeito financeiro esperado;
5. ausência de duplicação em retry/reexecução;
6. estorno/cancelamento quando a funcionalidade tiver reversão;
7. restart/reabertura para dados que precisam sobreviver ao processo;
8. RBAC para mutações sensíveis;
9. auditoria da ação;
10. integração com regressões existentes de venda, compra, caixa e financeiro.

## Gates

Para cada fase:

1. testes unitários/domínio em RED antes da implementação;
2. implementação mínima para GREEN;
3. testes de integração/API;
4. fluxo E2E Electron real;
5. registro do fluxo no QA config;
6. inclusão em `full` e `release.criticalFlows`;
7. execução dos regressivos existentes relevantes;
8. `verify` e `verify:release` verdes antes de considerar a fase pronta.

## Fora de escopo

- plano de contas contábil;
- partidas dobradas;
- Livro Diário/Razão;
- Balancete;
- Balanço Patrimonial;
- ECD/ECF/SPED;
- Open Finance obrigatório;
- API bancária paga;
- baixa automática silenciosa a partir do extrato.
