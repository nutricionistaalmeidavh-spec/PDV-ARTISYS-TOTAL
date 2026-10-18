
# Roadmap v2 — Paridade única do PDV Total (56 capacidades)

**Fonte de verdade:** as 56 capacidades publicadas pelo desktop PDV-ARTISYS no commit 7efea9c61f75be1536a1e516e917218f2b8bf2bf. **Produto:** PDV-ARTISYS-TOTAL, web/PWA com API gratuita Node.js + SQLite; Cloudflare opcional.

**Não somar 56 + 68:** as 68 operações das sete telas são contratos/testes subordinados às capacidades, nunca outro backlog de funcionalidades.

## Painel de acompanhamento

O comando **npm run report:parity** lista uma vez cada uma das 56 capacidades e mostra os contratos vinculados apenas como evidência interna.

| Estado exibido | O que representa | Próximo passo |
|---|---|---|
| Copiado integralmente | Capacidade coberta na matriz canônica, com certificação exigida pelo gate | Somente regressão |
| Copiado parcialmente | Há funcionamento/evidências de subconjuntos, mas faltam fluxos ou equivalência | Completar e testar o fluxo real |
| Não copiado / não demonstrado | Ainda não há prova de cópia integral (gap) | Primeiro verificar se falta código ou apenas evidência |
| Implementado, aguardando homologação | Implementação revisada explicitamente, com testes e dependências concluídos; certificação pendente | Homologar, não reimplementar |

**Precisão obrigatória:** gap NÃO comprova ausência de código. O terceiro estado inclui casos ainda não investigados. Não promover a pronto por nome de arquivo, CI verde ou um cenário isolado. Aguardando homologação exige revisão explícita e evidências listadas.

**Fotografia em 18/10/2026:** 56 capacidades: 0 integrais, 14 parciais, 42 não demonstradas, 0 formalmente aguardando homologação. Internamente, os 68 contratos estão em 23 cobertos e 45 parciais. Estes são números históricos; consultar a saída gerada para o estado atual.

## Ondas de implementação — 56 sem duplicação

| Onda | Capacidades | Conteúdo e gate |
|---|---|---|
| **R0 — Diagnóstico e gestão** | Transversal; nenhum ID adicional | Painel de 56, 68 contratos internos, rastreabilidade, distinguir implementação e homologação |
| **R1 — PDV comercial e gestão** | cap-004–008, cap-011–024, cap-040, cap-052 (**21**) | Venda, cliente, vendedor, desconto, devoluções, variações, kits, estoque, compras, caixa, financeiro, relatórios, atacado/importações. Aceite: jornada real completa na UI, resultados iguais ao desktop e lançamentos reconciliados |
| **R2 — Self-hosted e rede local** | cap-001–003, cap-010, cap-042, cap-044–047, cap-051, cap-053–056 (**14**) | API SQLite, HTTPS LAN, terminais independentes, credenciais revogáveis, backup/restauração, diagnósticos. Aceite: testes com duas máquinas físicas, recuperação e segurança sem SaaS obrigatório |
| **R3 — Periféricos físicos** | cap-025–030, cap-043, cap-050 (**8**) | Impressão, reimpressão, filas, balanças, gavetas e serial. Aceite: bridge local open source quando necessária, testes físicos por modelo/SO e reconexão; impressão não determina sucesso da venda |
| **R4 — Alimentação e verticais** | cap-009, cap-031–039, cap-041, cap-048–049 (**13**) | Mesas, comandas, atendimento, KDS, pizza, delivery/retirada, padaria e relatórios específicos. Aceite: fluxo completo por perfil e segmento sem criar outra autoridade de vendas/estoque |
| **R5 — Certificação/piloto** | As mesmas 56, sem duplicação | Revisão independente, regressão, testes físicos aplicáveis, restore, segurança, QA PC/tablet/celular e piloto consentido |

**Total exclusivo de R1–R4: 21 + 14 + 8 + 13 = 56.** R0 e R5 são gates, não novos itens.

### Fila prioritária antes de abrir novas frentes

**Fechar R1:** venda completa (desconto/perfis, múltiplas configurações do mesmo SKU, suspensão, retomada, pagamento), cliente/vendedor, devolução/cancelamento com efeitos corretos, estoque por filial, caixa por terminal, relatórios/CSV e reconciliação financeira. Reaproveitar implementação e testes atuais; não reescrever o que já existe.

**R2 em paralelo:** LAN segura, 2 terminais reais, credenciais, backup/restore com SQLite; manter core R$ 0.

**R3 e R4 conforme dependências:** homologar equipamentos fisicamente sem bloquear funcionalidades puramente lógicas; não chamar restaurante/periféricos de integrais antes de provar fluxos completos.

### Fechamento por capacidade

1. Inspecionar primeiro o desktop fixado, o código já existente, UI e API; registrar lacuna real versus prova faltante.
2. Implementar somente o comportamento ausente na jornada UI → permissão → domínio canônico → SQLite/D1 → estoque/caixa/financeiro.
3. Usar os contratos vinculados entre os 68 e executar casos nominal, autorização, isolamento de empresa e falha/recuperação; incluir teste físico apenas onde pertinente.
4. Se todos os subfluxos foram implementados e revisados, registrar revisão explícita e classificar **aguardando homologação**. Se a certificação passar, mudar o inventário canônico para **covered**.
5. Não reabrir entregas por tarefas não relacionadas. Correções exigem teste de reprodução.

## Migrações: política para aplicativo ainda novo

Existem **20 migrations SQL de desenvolvimento** de 0001 a 0020. Não são 20 versões distribuídas a clientes, nem importações de dados do desktop.

- Mudança de classificação **não** deve gerar migration. Só alterações reais do banco exigem mudança de schema.
- Não criar compatibilidade com bases de clientes antigos por padrão; importação do desktop será projeto separado, opt-in e com consentimento.
- Examinar SQLite e D1 remoto antes de consolidar: estado de schema, histórico de migrations e presença de dados de qualquer ambiente.
- **Somente se todos os bancos-alvo forem descartáveis**, criar baseline de instalação limpa e testar bootstrap idêntico no Node/SQLite e D1. Não editar/apagar as 20 atuais sem comprovação.
- Se houver dados a preservar, **manter migrações incrementais**, checksums e upgrade seguro; jamais recriar tabelas remotamente por suposição.
- Paridade é de comportamento, não de quantidade de migrations.

## Critério para merge/publicação

Uma CI verde não comprova homologação física ou deploy Cloudflare. Exigir testes de regressão, perfil/tenant, falha e retry, integridade, navegadores e dispositivos conforme capacidade. Confirmar o SHA exato. O desktop original não pode sofrer alteração.

**Política de custo:** core obrigatório R$ 0, self-hosted, open source; Cloudflare Free opcional com limites. Cobrança Asaas/serviços pagos somente mediante opção explícita.

## Comandos e arquivos

- **npm run report:parity** — painel humano de 56 capacidades.
- **node scripts/p6-capability-report.mjs --json** — mesmo painel com dependências dos contratos.
- **node scripts/p6-capability-report.mjs --markdown** — tabela em Markdown.
- **npm run test:parity** — testes/guardrails, sem promoção automática de status.
- Fonte 56: docs/parity/desktop-capability-inventory.json
- Evidência 68: docs/parity/desktop-web-matrix.json
- Comparações: docs/parity/scenario-evidence.json
- Certificação: docs/parity/P0-AUDIT-PLAN.md

O antigo docs/ROADMAP-SAAS-CLOUDFLARE.md permanece como **documentação histórica de arquitetura e implantação**. Este arquivo é o roadmap operacional vigente da paridade.
