# ERP Financeiro P0–P3

## Objetivo e escopo

O módulo ERP Financeiro amplia o PDV ArtiSys com **Gestão** financeira gerencial para o empresário. O core é local-first, **self-hosted** e funciona **sem dependência paga obrigatória**. Integrações externas pagas, quando existirem, devem ser oferecidas apenas como opcionais explícitos e não podem ser requisito para DRE, Fluxo de caixa, OFX, Conciliação, Recorrências ou Alertas.

Este escopo é gerencial. Ele **não implementa contabilidade por partidas dobradas**, não substitui escrituração contábil, obrigações fiscais, SPED ou a atuação do contador. As capacidades fiscais existentes continuam separadas e obedecem aos próprios gates de produção.

## Fonte de verdade

| Capacidade | Fonte canônica | Observação |
| --- | --- | --- |
| Contas, pagar/receber, baixas e estornos | `js/domains/finance/finance-service.js` | Serviço financeiro canônico; não há segundo motor financeiro |
| Categorias, grupos DRE e centros de custo | `js/domains/finance/finance-dimensions.js` | Dimensões gerenciais persistidas |
| Gestão, DRE, Fluxo de caixa e comparação | `js/domains/finance/finance-management.js` | DRE suporta caixa e competência |
| OFX | `js/domains/finance/statement-import.js` + `ofx-parser.js` | Preview/commit e deduplicação por origem |
| Conciliação | `js/domains/finance/reconciliation.js` | Sugestão nunca liquida; liquidação exige confirmação manual explícita |
| Recorrências | `js/domains/finance/recurrence.js` | Geração idempotente por ocorrência |
| Alertas | `js/domains/finance/finance-alerts.js` | Estado de leitura/ocultação não altera o financeiro |
| API | `server/erp-finance-router.js` | Superfície HTTP autenticada |
| Desktop | `desktop/renderer/erp-finance-*.js` | Gestão, OFX, conciliação, recorrências e alertas |

O domínio compartilhado em `vendor/artisys-finance-domain` é uma cópia versionada e local. O runtime não depende de serviço externo para funcionar.

## Fases

### P0 — fundação gerencial

Categorias financeiras, grupos de DRE, centros de custo, competência e vínculo de origem. Baixas parciais, liquidação total e estorno continuam no serviço financeiro canônico.

### P1 — Gestão

A rota **Gestão** expõe indicadores, DRE, Fluxo de caixa, comparação de períodos e projeções. A DRE por caixa considera liquidações ativas; a DRE por competência considera a competência do lançamento. Estornos deixam de compor a visão de caixa.

### P2 — OFX e Conciliação

O fluxo de extrato é `preview -> commit -> transações`. A identidade da ocorrência do arquivo é separada da similaridade de negócio, preservando duas transações legítimas de mesmo valor/descrição quando possuem FITIDs diferentes. Reimportar a mesma ocorrência não a duplica.

A Conciliação gera sugestões, mas **não altera o lançamento antes da confirmação manual**. Aceitar uma sugestão pode liquidar o contas a pagar/receber. Rejeitar não liquida. Transferências entre contas próprias são vinculadas como transferência e não criam receita ou despesa.

### P3 — Recorrências, Alertas e projeções

Recorrências geram pagar/receber de forma idempotente, inclusive depois de recarregar/reabrir o aplicativo. Alertas são derivados de dados financeiros e guardam apenas estado de apresentação (`read_at`/`hidden_at`). Projeções usam horizontes 7/30/90 dias.

## API e RBAC

Leituras e mutações ERP Financeiro exigem sessão válida e papel `admin` ou `manager` no router atual. Principais rotas:

- `/api/v1/erp-finance/dre-groups`, `/categories`, `/cost-centers`;
- `/api/v1/erp-finance/dashboard`, `/dre`, `/cashflow`, `/compare`, `/drilldown`;
- `/api/v1/erp-finance/statements/preview`, `/statements/:id/commit`, `/statement-transactions`;
- `/api/v1/erp-finance/reconciliation/:transactionId/suggestions|accept|reject|manual`;
- `/api/v1/erp-finance/transfers/suggestions|confirm`;
- `/api/v1/erp-finance/recurrences`, `/recurrences/generate`, `/recurrences/:id/status`;
- `/api/v1/erp-finance/alerts` e ações `read|hide|unhide`.

## Gates obrigatórios

Os fluxos E2E históricos deste plano continuam legados. O gate atual de UI é `npm run qa:e2e:p0`, baseado em `all-pages-audit` e executado no Electron em 1366×768; `qa:validate` apenas valida a configuração do harness. Cenários transacionais adicionais devem ser especificados a partir da UI atual antes de ampliarem o gate.
