
# Roadmap vigente — entrega SaaS web como prioridade; paridade desktop como referência (56 IDs)

**Produto-alvo:** PDV Total **web/SaaS hospedado**: UI responsiva/PWA no navegador em PC, tablet e celular; API autoritativa remota por HTTPS, autenticação, empresas/filiais isoladas e Cloudflare Workers + D1 na faixa gratuita ou infraestrutura hospedada equivalente. **Não exige instalador, servidor local nem topologia LAN/terminal no estabelecimento.** Node.js + SQLite e HTTPS LAN permanecem **opções de implantação self-hosted**, sem bloquear o SaaS.

**Fonte histórica de paridade:** 56 capacidades publicadas pelo desktop PDV-ARTISYS no commit 7efea9c61f75be1536a1e516e917218f2b8bf2bf. Essa lista fornece rastreabilidade funcional; **não é o contrato de lançamento do SaaS**. A classificação de prioridade da versão web fica em `docs/parity/saas-delivery-scope.json`.

**Não somar 56 + 68:** as 68 operações das sete telas são contratos/testes subordinados às capacidades, nunca outro backlog de funcionalidades.

## Painel de acompanhamento

**`npm run report:saas` é o painel de execução prioritário:** 53 referências ao desktop no escopo web (33 cobertas, 20 parciais e 0 gaps), mais 3 capacidades locais opcionais fora do bloqueio de entrega. **`npm run report:parity`** continua exibindo todas as 56 capacidades da referência desktop e os contratos vinculados como evidência para auditoria. O total de 53 não substitui os gates SaaS de segurança, provisionamento, assinaturas e implantação.

| Estado exibido | O que representa | Próximo passo |
|---|---|---|
| Copiado integralmente | Capacidade coberta na matriz canônica, com certificação exigida pelo gate | Somente regressão |
| Copiado parcialmente | Há funcionamento/evidências de subconjuntos, mas faltam fluxos ou equivalência | Completar e testar o fluxo real |
| Não copiado / não demonstrado | Ainda não há prova de cópia integral (gap) | Primeiro verificar se falta código ou apenas evidência |
| Implementado, aguardando auditoria de código | Implementação revisada, testes e dependências concluídos; falta apenas auditoria automatizada/revisão de paridade | Validar evidência de software e classificar `covered` |

**Precisão obrigatória:** gap NÃO comprova ausência de código. O terceiro estado inclui casos ainda não investigados. Não promover a pronto por nome de arquivo, CI verde ou um cenário isolado. Auditoria de código exige revisão explícita e evidências executáveis. Testes em equipamento real não bloqueiam código pronto.

**Fotografia do inventário após PR #78 (`main@94cf5e1f`, 18/10/2026; consulte SHA atual):** 56 referências desktop: **33 cobertas, 23 parciais e 0 não demonstradas**. **Entrega SaaS prioritária:** 53 referências web (33 cobertas, 20 parciais) e três capacidades de implantação local explicitamente opcionais (`cap-001`, `cap-047`, `cap-056`). Por onda: R1 **21 cobertas**; R2 **11 cobertas / 3 parciais**; R3 **8 parciais / 0 lacunas sem implementação demonstrada** (cap-030 e cap-043 passaram a parciais após implementação e simulação, não a cobertas); R4 **1 coberta / 12 parciais**. Os 68 contratos subordinados registram **43 cobertos e 25 parciais**. Execute `npm run report:parity` para obter os valores do inventário versionado. A existência de testes de subconjunto não equivale à certificação integral; testes físicos não bloqueiam código.

## Ondas de implementação — 56 sem duplicação

| Onda | Capacidades | Conteúdo e gate |
|---|---|---|
| **R0 — Diagnóstico e gestão** | Transversal; nenhum ID adicional | Painel de 56, 68 contratos internos, rastreabilidade e estado verificável de código pronto |
| **R1 — PDV comercial e gestão** | cap-004–008, cap-011–024, cap-040, cap-052 (**21**) | **21/21 cobertas no inventário auditado**. Somente manutenção, regressão e correções comprovadas; não reabrir como implementação pendente |
| **R2 — infraestrutura reutilizável e alternativa local** | cap-001–003, cap-010, cap-042, cap-044–047, cap-051, cap-053–056 (**14**) | Contratos herdados de self-hosted/LAN. Os 11 já cobertos ficam preservados. **`cap-001`, `cap-047` e `cap-056` são opcionais e NÃO bloqueiam o SaaS hospedado**. Testar alternativas LAN apenas se essa modalidade for escolhida; UI responsiva mobile do SaaS é verificada pela PWA hospedada. |
| **R3 — Periféricos e protocolos (teste emulado)** | cap-025–030, cap-043, cap-050 (**8**) | Impressão, reimpressão, filas, balanças, gavetas e serial. Aceite de código: bridge local open source, drivers/protocolos com mocks e emuladores, fila, retry, reconexão simulada; impressão não determina sucesso da venda |
| **R4 — Alimentação e verticais** | cap-009, cap-031–039, cap-041, cap-048–049 (**13**) | Mesas, comandas, atendimento, KDS, pizza, delivery/retirada, padaria e relatórios específicos. Aceite: fluxo completo por perfil e segmento sem criar outra autoridade de vendas/estoque |
| **R5 — Certificação de código** | As mesmas 56, sem duplicação | Revisão de paridade, regressão, restore em banco temporário, segurança e E2E em Chromium responsivo; não exige equipamento físico nem piloto |

**Total exclusivo de R1–R4: 21 + 14 + 8 + 13 = 56.** R0 e R5 são gates de software, não novos itens.

### Fila prioritária atual — não reabrir a R1 concluída

**R1: manutenção e regressão, não nova implementação.** As 21 capacidades do R1 estão `covered` no inventário da `main` auditada. Não criar um segundo backlog de vendas, financeiro ou estoque; reabrir um ID apenas por regressão reproduzida, prova inválida ou requisito comprovadamente novo, com teste antes da correção.

**R2: nenhuma pendência obrigatória para o lançamento do SaaS hospedado.** `cap-001` (instalador e ciclo de servidor Windows local), `cap-047` (mobile acessando um servidor LAN) e `cap-056` (perfil de implantação servidor/terminal) ficam **adiados e opcionais**. Preservar as 11 capacidades R2 já cobertas e seus testes como infraestrutura reutilizável. **Não confundir `cap-047` com UX mobile web**, que é obrigatória na PWA acessível via Internet e tem testes de responsividade/Chromium próprios.

**R3: fechar as oito capacidades ainda parciais** (`cap-025` a `cap-030`, `cap-043`, `cap-050`). `cap-030` já grava identidade por empresa/filial na API/D1 e congela no momento da conclusão da venda; reimpressões usam a marca original (PNG no navegador/PDF, texto no conector/serial). `cap-029` já tem pré-conta não fiscal no checkout web, sem concluir venda, além do cupom definitivo. `cap-025` tem trabalhos idempotentes e reimpressões manuais com identidade própria; `cap-027` exige nova permissão serial após falhas. `cap-043` mantém a matriz de protocolos versionada e cenários emulados, mas depende também de `checkout-016` ainda parcial. Ainda são necessárias revisão comparativa dos demais subfluxos de impressão/KDS/caixa e certificação de paridade; não promover por testes isolados. Reaproveitar `tools/local-hardware-bridge/` e certificar paridade com o desktop, sem exigir periférico físico.

**R4: concluir os 12 itens parciais** (cap-009, cap-031, cap-032, cap-034–039, cap-041, cap-048 e cap-049), sem duplicar pedidos, caixa ou ledger. Priorizar divisão individual por pagador/item, corridas entre operadores, roteamento e recuperação do KDS, insumos da pizzaria, delivery, onboarding e relatórios; usar comparações executáveis com o desktop fixado.

**R5 — gates distintos:** **lançamento do SaaS web** requer jornadas de vendas/caixa/estoque, autenticação/RBAC, isolamento entre empresas, UI responsive PC/tablet/mobile, integrações necessárias, dados persistentes, rollback/backup e CI no SHA publicado. **Não depende de 56/56 referências desktop** nem da instalação local dos três itens opcionais. O certificado **separado** de equivalência integral com o desktop continua exigindo 56/56 capacidades e 68/68 contratos; não afirmar esse certificado apenas porque o SaaS pode ser publicado.

### Regra definitiva de pronto

**SaaS web pronto** = requisitos funcionais da versão hospedada cumpridos com API/banco canônicos, autorização, isolamento entre empresas, testes automatizados PC/tablet/mobile, segurança, operabilidade e deploy verificável; não exigir servidor ou instalador local do lojista. **Paridade desktop pronta** é certificação independente, com comparação de subfluxos do manifesto e testes/revisão; não exige equipamento físico. Uma instalação LAN para cliente específico continua opcional.

### Fechamento por capacidade

1. Inspecionar primeiro o desktop fixado, o código já existente, UI e API; registrar lacuna real versus prova faltante.
2. Implementar somente o comportamento ausente na jornada UI → permissão → domínio canônico → SQLite/D1 → estoque/caixa/financeiro.
3. Usar os contratos vinculados entre os 68 e executar casos nominal, autorização, isolamento de empresa e falha/recuperação; cobrir integração com periféricos por simuladores e testes determinísticos.
4. Se todos os subfluxos foram implementados e revisados, registrar revisão explícita e classificar **aguardando auditoria de código**. Com paridade funcional e testes automatizados verificados, mudar para **covered**, sem precisar testar equipamento real.
5. Não reabrir entregas por tarefas não relacionadas. Correções exigem teste de reprodução.

## Migrações: política para aplicativo ainda novo

As migrações SQL são incrementais e numeradas; a sequência vigente é de 0001 a 0026. Não são 26 versões distribuídas a clientes, nem importações de dados do desktop.

- Mudança de classificação **não** deve gerar migration. Só alterações reais do banco exigem mudança de schema.
- Não criar compatibilidade com bases de clientes antigos por padrão; como o app ainda não teve usuários, não inventar histórico a migrar. A importação de um banco desktop real seria tarefa separada, opcional e com consentimento.
- Examinar SQLite e D1 remoto antes de consolidar: estado de schema, histórico de migrations e presença de dados de qualquer ambiente.
- **Somente se todos os bancos-alvo forem descartáveis**, criar baseline de instalação limpa e testar bootstrap idêntico no Node/SQLite e D1. Não editar/apagar as migrações já aplicadas sem comprovação.
- Se houver dados a preservar, **manter migrações incrementais**, checksums e upgrade seguro; jamais recriar tabelas remotamente por suposição.
- Paridade é de comportamento, não de quantidade de migrations.

## Critério para merge/publicação

Uma CI verde isolada não prova paridade: exigir cenários por capacidade, regressão, perfil/tenant, falha/retry, integridade, navegadores e periféricos simulados. O teste físico NÃO bloqueia classificação, merge nem conclusão do código. Confirmar o SHA exato. O desktop original não pode sofrer alteração.

**Política de custo:** core obrigatório R$ 0, self-hosted, open source; Cloudflare Free opcional com limites. Cobrança Asaas/serviços pagos somente mediante opção explícita.

## Comandos e arquivos

- **npm run report:parity** — painel humano de 56 capacidades.
- **node scripts/p6-capability-report.mjs --json** — mesmo painel com dependências dos contratos.
- **node scripts/p6-capability-report.mjs --markdown** — tabela em Markdown.
- **npm run test:parity** — testes/guardrails, sem promoção automática de status.
- Fonte 56: docs/parity/desktop-capability-inventory.json
- Evidência 68: docs/parity/desktop-web-matrix.json
- Comparações: docs/parity/scenario-evidence.json
- Certificação de código: docs/parity/P0-AUDIT-PLAN.md

O arquivo `docs/ROADMAP-SAAS-CLOUDFLARE.md` conserva o plano de arquitetura SaaS (histórico); este documento é o roadmap vigente, **com execução web priorizada e paridade desktop como auditoria separada**. Referência de exclusões explícitas: `docs/parity/saas-delivery-scope.json`.
