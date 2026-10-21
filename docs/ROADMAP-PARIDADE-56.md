
# Roadmap vigente — entrega SaaS web como prioridade; paridade desktop como referência (56 IDs)

**Produto-alvo:** PDV Total **web/SaaS hospedado**: UI responsiva/PWA no navegador em PC, tablet e celular; API autoritativa remota por HTTPS, autenticação, empresas/filiais isoladas e Cloudflare Workers + D1 na faixa gratuita ou infraestrutura hospedada equivalente. **Não exige instalador, servidor local nem topologia LAN/terminal no estabelecimento.** Node.js + SQLite e HTTPS LAN permanecem **opções de implantação self-hosted**, sem bloquear o SaaS.

**Fonte histórica de paridade:** 56 capacidades publicadas pelo desktop PDV-ARTISYS no commit 7efea9c61f75be1536a1e516e917218f2b8bf2bf. Essa lista fornece rastreabilidade funcional; **não é o contrato de lançamento do SaaS**. A classificação de prioridade da versão web fica em `docs/parity/saas-delivery-scope.json`.

**Não somar 56 + 68:** as 68 operações das sete telas são contratos/testes subordinados às capacidades, nunca outro backlog de funcionalidades.

## Painel de acompanhamento

### Atualização da `main` — 21/10/2026 (`f4a5a1d`)

- A landing pública recebeu apresentação premium, galeria responsiva e movimento, preservando o login dentro da própria landing e o acesso à aplicação canônica.
- Financeiro avançou com carteiras/contas, transferências internas, estorno de liquidações, filtros e trilha de auditoria. Isso reduz a lacuna funcional de `finance-051`, `finance-052`, `finance-053` e `finance-056`, mas os contratos continuam parciais até completar as comparações independentes exigidas pela matriz.
- Histórico de caixas e vendas ganhou filtros e evidências adicionais; a classificação formal continua em **44 contratos cobertos, 24 parciais e 0 gaps**, com **49/496 comparações independentes**.
- Ajustes de UX priorizados nesta rodada: destino do produto configurado somente no cadastro canônico; atalhos do Início antes dos indicadores; cadastro rápido e canônico de cliente no Atacado; criação de mesa por botão **+ Mesa**.
- Desempenho web/PWA: shell autenticado servido imediatamente pelo cache versionado com atualização em segundo plano; cadastros de referência compartilhados por 20 segundos e invalidados em qualquer escrita; conciliação bancária paginada em lotes de 50 e coberta por índices alinhados às consultas. APIs de saldo, caixa, estoque e permissões continuam sem cache persistente.
- Próxima fila funcional: alertas financeiros de recorrência (`finance-057`), plano de contas/grupos DRE integral (`finance-054`), exportações XLSX/PDF equivalentes (`reports-068`) e ampliação sistemática das 447 comparações ainda pendentes.

**`npm run report:saas` é o painel de execução prioritário:** 53 referências ao desktop no escopo web (53 cobertas, 0 parciais e 0 gaps), mais 3 capacidades locais opcionais fora do bloqueio de entrega. **`npm run report:parity`** continua exibindo todas as 56 capacidades da referência desktop e os contratos vinculados como evidência para auditoria. O total de 53 não substitui os gates SaaS de segurança, provisionamento, assinaturas e implantação.

| Estado exibido | O que representa | Próximo passo |
|---|---|---|
| Copiado integralmente | Capacidade coberta na matriz canônica, com certificação exigida pelo gate | Somente regressão |
| Copiado parcialmente | Há funcionamento/evidências de subconjuntos, mas faltam fluxos ou equivalência | Completar e testar o fluxo real |
| Não copiado / não demonstrado | Ainda não há prova de cópia integral (gap) | Primeiro verificar se falta código ou apenas evidência |
| Implementado, aguardando auditoria de código | Implementação revisada, testes e dependências concluídos; falta apenas auditoria automatizada/revisão de paridade | Validar evidência de software e classificar `covered` |

**Precisão obrigatória:** gap NÃO comprova ausência de código. O terceiro estado inclui casos ainda não investigados. Não promover a pronto por nome de arquivo, CI verde ou um cenário isolado. Auditoria de código exige revisão explícita e evidências executáveis. Testes em equipamento real não bloqueiam código pronto.

**Fotografia versionada da entrega funcional R4 (19/10/2026; confira o SHA atual):** 56 referências desktop: **53 cobertas, 3 parciais e 0 não demonstradas**. **Entrega SaaS prioritária:** 53 referências web (53 cobertas, 0 parciais), mais três capacidades opcionais de instalação local (`cap-001`, `cap-047`, `cap-056`). Por onda: R1 **21 cobertas**; R2 **11 cobertas / 3 parciais** (não bloqueiam SaaS); R3 **8 cobertas / 0 parciais**; R4 **13 cobertas / 0 parciais**. Os 68 contratos subordinados registram **44 cobertos e 24 parciais**, sem contagem dupla. Os sete itens funcionais desta rodada têm testes de software; a versão hospedada ainda exige segurança, backup, deploy e QA completos. `npm run report:parity` valida evidência executável por capacidade. Homologação física de dispositivos é separada.

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

**R3: oito capacidades cobertas no contrato de software web (`cap-025` a `cap-030` e `cap-043`)** com cenários independentes e reutilização do renderizador canônico (venda, mesa, cozinha, caixa), fila SQLite idempotente e protocolo KDS claim/ACK, WebSerial reconectável, pesagem estável, 250 ciclos de estresse, impressora ESC/POS CP850 e raster PNG bounded. `checkout-016` também foi certificado com lançamentos SCALE/MANUAL idempotentes e estoque/valor canônicos. **`cap-050` coberta em simulação de protocolos suportados**, que engloba outras variações integradas de scanner/balança/gaveta; tratar sem reabrir as sete concluídas. A homologação física por modelo é separada e opcional. A implantação continua sendo SaaS no navegador, sem servidor Windows obrigatório.

**R4: treze capacidades cobertas no escopo de software SaaS.** Concorrência de mesa/comanda, checkout único, KDS, receitas e pizzas, delivery/retirada, senhas, onboarding, chamados e relatório operacional foram testados. A `cap-032` agora combina rateio por item/pagador, adiantamentos com estorno imutável antes do checkout e acerto entre turnos, sem duplicar lançamentos; a divisão deve ser definida antes de atribuir adiantamentos a pessoas. `0029` reconcilia a guarda transacional do caixa no banco; migrações remotas e publicação exigem backup, validação e deploy explícitos.

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

As migrações SQL são incrementais e numeradas; a sequência vigente é de 0001 a 0042. Não são 42 versões distribuídas a clientes, nem importações de dados do desktop.

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

**Situação após a rodada 19/10/2026:** sete dos sete itens prioritários concluídos no escopo de software testado; inventário 53 `covered` e 3 `partial` históricos, todos os 3 fora da exigência da versão SaaS hospedada (instalador/LAN). Escopo SaaS: 53 `covered` / 0 `partial`. Ver `docs/parity/R3-R4-SEVEN-SOFTWARE-ACCEPTANCE-20261019.md`.
