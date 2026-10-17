# QA Cross-Cutting Hardening — Design

**Date:** 2026-09-25  
**Status:** design for implementation  
**Target:** PDV ArtiSys `main`  
**Branch:** `feat/qa-crosscut-hardening`

## Goal

Evoluir o QA atual do PDV ArtiSys para detectar sistematicamente regressões de UX, bugs transversais, inconsistências entre renderer/backend, combinações de estado, falhas de sincronização e regressões de release antes da publicação.

A mudança deve aproveitar a infraestrutura existente (`node:test`, ArtiSys QA, Playwright/Electron, `ui-sweep`, `product-report`, GitHub Actions) e manter o core obrigatório R$ 0, self-hosted/open source, sem SaaS pago como dependência.

## Problem Statement

A suíte atual cobre muitas capacidades e fluxos concretos, mas vários bugs recentes pertencem a classes de regressão que atravessam componentes:

- estado de módulo diverge entre backend, renderer e outro terminal;
- launcher/rota permanece visível ou navega para destino incorreto depois de alteração externa;
- exceção interna é classificada como erro de cliente;
- UI quebra apenas em um viewport específico;
- rerender invalida input/foco/seleção;
- erro de rede, console ou HTTP 5xx aparece durante um fluxo que funcionalmente parece passar;
- executável Windows empacotado abre, mas ainda não é funcionalmente exercitado.

O objetivo não é apenas aumentar o número de testes. O objetivo é tornar invariantes globais do produto executáveis como gates.

## Existing Foundation

O projeto já possui:

- testes de domínio, integração, release e paridade backend/UI com `node:test`;
- runtime ArtiSys QA baseado em Playwright/Electron;
- múltiplos viewports (`desktop`, `compactDesktop`, `tablet`, `mobile`);
- perfis `quick`, `full` e `release`;
- E2E de módulos, checkout, impressão, relatórios, fiscal e UX;
- `ui-sweep.js`, que já coleta falhas de navegação, page errors, request failures, HTTP errors, links suspeitos e controles sem label;
- `product-report.js`, que já consegue bloquear por critical checks/findings, HTTP 5xx, request failures, console errors e gaps críticos de coverage;
- artifacts de QA no CI;
- smoke de aplicação Windows empacotada.

A implementação deve integrar e generalizar essas peças, não criar um segundo framework de QA.

## Architectural Principles

1. **Invariantes acima de casos isolados.** Um bug encontrado em uma feature deve originar um contrato reutilizável quando a mesma classe puder existir em outras features.
2. **Renderer não é autoridade de regra de negócio.** Módulos, autorização e integridade continuam impostas no backend; o QA verifica a paridade entre superfícies.
3. **Fail closed em release.** Console error inesperado, request failure, HTTP 5xx, regressão estrutural crítica ou gap de contrato crítico bloqueiam release.
4. **PR rápido; profundidade crescente.** Checks baratos rodam em todo PR; checks combinatórios/pesados rodam em `main` e release.
5. **Determinismo.** Seeds, fixtures e combinações geradas devem ser reproduzíveis.
6. **Evidence first.** Toda falha E2E relevante deve preservar screenshot/trace/video/log/relatório suficiente para reprodução.
7. **Sem dependência paga.** Node, Playwright, SQLite, ferramentas open source e CI atual são suficientes para o core.

## Scope

### Phase A — Cross-Cutting Gate

Criar um gate `qa:crosscut` que execute contratos globais independentes das features individuais.

Contratos iniciais:

- `module-state-contract`
- `navigation-contract`
- `http-error-contract`
- `renderer-health-contract`
- `idempotency-contract` para operações críticas já compatíveis com retry

O gate deve produzir relatório agregado usando `product-report` e falhar quando houver blocker crítico.

### Phase B — Generic Module Contract Matrix

O registry `MODULES` passa a ser a fonte para gerar testes de contrato de módulos opcionais.

Para cada módulo aplicável, validar quando possível:

- estado listado pelo backend é coerente com setting canônico;
- `ON -> OFF` converge no renderer sem restart;
- `OFF -> ON` converge no renderer sem restart;
- launcher/entrada associada fica invisível ou indisponível quando OFF;
- operações específicas protegidas pelo backend rejeitam com `MODULE_DISABLED` quando OFF;
- dependências declaradas em `dependsOn` impedem configuração inválida;
- alteração por outro cliente/terminal converge para a UI atual;
- navegação antiga não deve redirecionar silenciosamente para tela não relacionada.

Nem todo módulo possui hoje a mesma superfície de UI. O contrato será data-driven: o registry de QA pode declarar `launcherSelector`, `route`, `protectedProbe` e `supportsLiveSync`. Ausência explícita de uma capacidade não deve ser inventada pelo teste; deve aparecer como coverage metadata.

### Phase C — Structural UX Sweep

Expandir o `ui-sweep` existente para detectar invariantes estruturais em cada página/rota visitada:

- overflow horizontal do documento;
- elementos interativos visíveis totalmente fora do viewport;
- sobreposição relevante entre controles interativos visíveis;
- controles sem nome acessível;
- foco em elemento oculto/desabilitado;
- links/botões de navegação sem destino válido quando deveriam navegar;
- erros de console;
- page errors;
- request failures;
- HTTP 5xx.

A detecção de overlap deve evitar falsos positivos comuns (elementos contidos, overlays/modal ativos, badges, ícones internos). O scanner reporta finding com seletor/retângulos/evidence; somente categorias explicitamente críticas bloqueiam release.

### Phase D — Product Gate Integration

`product-report.js` será usado como gate real, não somente utilitário isolado.

O agregador receberá:

- checks dos flows;
- resultados do structural sweep;
- console errors;
- network errors;
- findings estruturais;
- coverage de contratos;
- evidence paths.

Política inicial de release:

- critical check failures: 0
- critical findings: 0
- HTTP 5xx: 0
- request failures inesperadas: 0
- console errors inesperados: 0
- uncovered critical contracts: 0

Overrides existentes só podem liberar gate com razão explícita e devem ficar registrados no artifact.

### Phase E — State Matrix / Pairwise Runner

Criar um gerador determinístico de cenários pairwise para evitar produto cartesiano completo.

Dimensões iniciais para flows compatíveis:

- module: on/off
- role: operator/admin
- cash: closed/open
- server lifecycle: normal/reconnect
- printer: simulated/absent
- viewport: desktop/compactDesktop
- database: fresh/migrated fixture

O gerador deve produzir um conjunto mínimo onde todo par de valores de dimensões diferentes apareça pelo menos uma vez, com seed/version explícito no relatório.

No primeiro rollout, pairwise não roda em todo PR. Ele entra em `main`/release e pode ser filtrado por domínio.

### Phase F — Fault Injection and Recovery

Adicionar fault adapters somente nos pontos que já possuem boundaries controláveis no runtime de teste.

Falhas iniciais:

- request timeout/reconnect;
- HTTP 500 simulado em endpoint não destrutivo;
- printer absent/simulated failure;
- retry da mesma intenção/operação crítica para validar idempotência;
- reinício controlado do servidor entre leitura e reconciliação quando o harness suportar sem flakiness.

Critérios após falha:

- nenhuma duplicação de venda/efeito;
- estoque/caixa permanecem consistentes;
- retry não duplica effect/outbox;
- UI apresenta estado recuperável;
- não existem erros silenciosos de console;
- reconexão converge para estado canônico.

Falhas de disco/SQLite locking profundo ficam fora do primeiro rollout se exigirem infraestrutura específica não determinística no CI.

### Phase G — Coverage by Risk

Adicionar cobertura de código com ferramentas nativas/open source, priorizando branch coverage em domínios críticos.

Grupos críticos:

- sales
- payments
- cash
- inventory
- returns
- fiscal
- database migrations
- eventbus/effects
- modules/settings

Política preferida:

- baseline por domínio;
- código alterado não reduz coverage do domínio/arquivo;
- thresholds de branch mais altos em domínio do que em renderer;
- capability coverage existente continua independente e obrigatória.

Não usar coverage percentual global como único gate.

### Phase H — Packaged Windows Functional Smoke

Evoluir o smoke do workflow Windows de “processo permaneceu aberto” para um smoke funcional mínimo no app empacotado.

Fluxo alvo:

1. iniciar executável empacotado em modo QA/local;
2. aguardar bootstrap saudável;
3. validar que a janela principal responde;
4. navegar para Home/PDV;
5. executar uma operação não destrutiva ou venda fixture isolada quando o harness Windows permitir;
6. encerrar normalmente;
7. falhar se renderer crashar, servidor local falhar ou surgir erro fatal.

Se automação de UI nativa do executável empacotado for instável no runner Windows, o primeiro passo pode validar API local + renderer health do processo empacotado, mantendo o smoke atual como fallback temporário documentado.

### Phase J — Mutation Testing

Adicionar mutation testing open source somente para domínios críticos, em job periódico/manual de profundidade.

Não bloquear todo PR inicialmente.

Escopo inicial sugerido:

- money/payment rules
- pricing
- cash rules
- inventory rules
- return rules
- module service

Mutantes sobreviventes geram relatório; threshold passa a bloquear release somente depois que a suíte estabilizar.

## QA Manifest Changes

O manifesto atual define `includeDesktop` e `includeNetwork`, mas essas capacidades não devem permanecer flags decorativas.

A implementação deve:

- consumir explicitamente `includeNetwork` no profile runner/gate;
- não executar comparações visuais por screenshot;
- preservar `includeDesktop` para smoke do executable quando aplicável;
- remover overrides `false` de `full`/`release` quando a respectiva capacidade estiver implementada e estável;
- manter `quick` minimalista.

Perfis alvo:

### `quick`

- smoke crítico;
- contratos baratos;
- sem pairwise pesado;
- sem mutation;
- sem comparação visual por screenshot.

### `full`

- flows funcionais existentes;
- `qa:crosscut`;
- structural UX sweep;
- network/console health;
- sem comparação visual por screenshot.

### `release`

- tudo de `full`;
- state matrix selecionada;
- fault/recovery crítico;
- packaged desktop smoke;
- zero uncovered critical contracts.

## New/Changed Components

### `qa/runtime/src/crosscut-runner.js`

Orquestra contratos transversais e normaliza resultados no formato de check/finding/evidence.

Não conhece regras de negócio específicas; delega aos contracts.

### `qa/runtime/src/contracts/*.js`

Contratos isolados com API pequena, por exemplo:

```js
await runContract({ context, policy })
// => { checks, findings, coverage, evidence }
```

### `qa/runtime/src/module-contracts.js`

Mapeia `MODULES` para probes declarativos de QA. A fonte de verdade dos IDs/dependências continua sendo `module-registry.js`.

### `qa/runtime/src/ui-sweep.js`

Mantém crawler/inventory atual e ganha structural findings.

### `qa/runtime/src/product-report.js`

Permanece responsável por normalização e política de gate. Não deve incorporar crawling ou regras específicas de módulos.

### `qa/runtime/src/profile-runner.js`

Passa a executar capacidades adicionais conforme perfil e agregar seus resultados ao report final.

### `qa/artisys-qa.config.json`

Declara os novos flows/capabilities/policies sem duplicar regras do runtime.

### `test/*`

Testes unitários do gerador pairwise, contratos, scanner geométrico, gate e configuração.

### `.github/workflows/verify.yml`

Integra gates por custo:

- PR/main normal: verify + E2E + crosscut adequado;
- release: profundidade total configurada;
- artifacts sempre preservados em falha.

## Data Flow

```text
profile
  -> functional flows
  -> crosscut contracts
  -> structural/network/console sweep
  -> optional visual checks
  -> optional state/fault scenarios
        |
        v
 normalized checks/findings/coverage/evidence
        |
        v
 product-report / product gate
        |
        +--> PASS
        |
        +--> FAIL + artifacts
```

O release gate não depende de parsing de texto de logs; recebe resultados estruturados.

## Error Handling

- Falha do próprio harness em um check crítico é `failed`, nunca `skipped` silenciosamente.
- Capacidade não suportada deve ser `not-applicable`/coverage metadata com razão explícita.
- Timeout deve registrar etapa, target e evidence atual.
- Falhas de rede esperadas por fault injection devem ser marcadas como esperadas para não contaminar `unexpected network errors`.
- Qualquer exceção inesperada no runner produz finding crítico `qa-harness-error`.
- Overrides de gate requerem razão e são visíveis no relatório.

## Flakiness Policy

- Sem `sleep` arbitrário quando existir estado observável.
- Preferir `waitFor` por condição canônica.
- Seeds determinísticos.
- Retries do framework não podem esconder bug; default continua sem retry para checks determinísticos.
- Teste flaky identificado é corrigido ou isolado com issue/documentação; não é simplesmente aumentado timeout indefinidamente.

## Regression Library

Criar uma taxonomia para bugs reais, inicialmente em metadata/documentação do QA:

- `state-sync`
- `navigation`
- `rerender`
- `responsive-layout`
- `authorization`
- `idempotency`
- `migration`
- `http-classification`
- `concurrency`
- `recovery`

Quando um bug for corrigido, o teste deve registrar a categoria. Quando a categoria admitir generalização, preferir contrato transversal a teste hiper-específico.

## CI Strategy

### Pull Request

Bloqueia por:

- lint/syntax/docs;
- unit/integration/release tests atuais;
- capability checks atuais;
- `qa:quick`;
- contratos transversais baratos;
- coverage diff quando disponível.

### Main

Adiciona:

- `qa:full`;
- `qa:crosscut` completo;
- structural UX sweep;
- selected pairwise.

### Release

Adiciona:

- `qa:release`;
- fault/recovery crítico;
- packaged desktop functional smoke;
- policy de zero blocker crítico.

A implementação pode inicialmente manter os jobs no mesmo workflow; separar jobs só quando isso melhorar diagnóstico/paralelismo.

## Performance Budget

O novo QA não deve tornar feedback de PR impraticável.

Targets iniciais:

- checks crosscut baratos: executáveis no mesmo orçamento do E2E atual;
- pairwise e fault injection: fora do caminho rápido de PR;
- mutation: periódico/manual;
- capturas de tela, quando necessárias, são evidência diagnóstica e não comparadas a imagens esperadas.

O relatório deve incluir duração por check para permitir posterior otimização baseada em dados.

## Security and Privacy

- Não capturar secrets/tokens em artifacts;
- reutilizar redaction já existente no product report;
- fixtures não devem conter dados reais de cliente;
- telemetry não é requisito para execução do QA;
- nenhum artifact deve depender de serviço externo pago.

## Acceptance Criteria

A arquitetura é considerada implantada quando:

1. existe `qa:crosscut` documentado e executável;
2. pelo menos módulo/rota/http/renderer-health possuem contratos transversais;
3. módulos opcionais possuem coverage matrix declarativa e Restaurante deixa de ser caso único hardcoded;
4. structural UX sweep detecta overflow, elementos interativos fora do viewport e overlap crítico com fixtures unitárias;
5. console error, request failure inesperada e HTTP 5xx alimentam o product gate;
6. `product-report` participa do gate real de `full`/`release`;
7. profile flags implementadas não ficam decorativas;
8. CI preserva artifacts dos novos checks;
9. pelo menos um conjunto pairwise determinístico é executável fora do `quick`;
10. pelo menos um cenário fault/recovery crítico valida idempotência/consistência;
11. coverage por risco é produzido para domínios selecionados sem substituir capability coverage;
13. smoke do Windows empacotado valida mais que permanência do processo, ou registra um fallback técnico comprovado;
14. nenhuma dependência SaaS paga é necessária.

## Delivery Order

Para reduzir blast radius, implementar na seguinte ordem:

1. integrar `product-report` ao pipeline e criar `qa:crosscut` mínimo;
2. generalizar module contract matrix;
3. expandir structural UX sweep;
4. ativar network/console gate;
5. introduzir coverage por risco;
7. adicionar pairwise runner;
8. adicionar fault/recovery selecionado;
9. melhorar packaged Windows smoke;
10. adicionar mutation testing periódico.

Cada etapa deve manter `main` verde antes da próxima.

## Non-Goals

- reescrever o runtime de QA em outro framework;
- depender de BrowserStack, Percy, Datadog, Sentry ou equivalentes pagos;
- tentar todas as combinações cartesianas de estados;
- pixel-diff de todas as telas/viewports desde o primeiro PR;
- simular hardware fiscal real no CI genérico onde já existe certificação específica;
- refatorar domínios de negócio sem necessidade para os contratos de QA.

## Compatibility

A mudança deve ser incremental:

- scripts atuais (`qa:quick`, `qa:full`, `qa:release`) continuam válidos;
- flows atuais continuam válidos;
- novos campos de manifesto devem possuir defaults seguros;
- instalações/runtime de produção não carregam dependências adicionais de QA;
- artifacts novos ficam restritos a desenvolvimento/CI.
