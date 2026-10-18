# P0 — inventário canônico de paridade desktop/web

## Origem e limites do inventário

- **Desktop preservado em modo somente leitura:** `nutricionistaalmeidavh-spec/PDV-ARTISYS@7efea9c61f75be1536a1e516e917218f2b8bf2bf`.
- **Destino autoritativo:** `nutricionistaalmeidavh-spec/PDV-ARTISYS-TOTAL`, somente `apps/web`, `apps/api` e `packages/core`.
- **Fonte independente publicada pelo desktop:** `release/capabilities.json`, **56 capacidades**, cópia exata `desktop-capabilities-baseline.json` conferida contra o SHA do blob Git do commit original.
- **Contrato detalhado das sete telas:** `desktop-web-matrix.json`, **68 IDs canônicos**; cada linha possui responsável de domínio `owner`, `dependsOn`, critério `acceptance`, estado e prova de implementação/teste quando aplicável.
- **Rastreio além das sete telas:** `desktop-capability-inventory.json`, **56 IDs `cap-001` a `cap-056`**, na mesma ordem do manifesto original; cada capacidade tem dono, dependências, referência de origem e critério operacional de aceite.

Os 56 IDs **não são 56 entregas implementadas**, nem duplicam as 68 operações. São uma cobertura documental das *capacidades publicadas* do desktop original, incluindo restaurante, KDS, dispositivos LAN, compras, backup, importação e perfis de implantação. Cada capacidade poderá ser expandida em cenários menores antes de receber `covered`. Este inventário **não garante exaustividade dos fluxos e combinações não publicados no manifesto**.

## Linha de base auditada

| Escopo | Coberto | Parcial | Gap | Total |
| --- | ---: | ---: | ---: | ---: |
| Operações das sete telas | 23 | 45 | 0 | 68 |
| Capacidades publicadas do desktop | 0 | 14 | 42 | 56 |

"Parcial" no inventário estendido significa que existe ao menos um contrato da matriz com evidência testada relacionado à capacidade. **Não** significa que a capacidade inteira passe no navegador. "Gap" significa falta de comprovação de equivalência funcional integral, não prova de ausência de código.

## Garantias automatizadas

`npm run test:parity` executa:

1. `node --test scripts/parity-rules.test.mjs`: testes negativos de lacunas e fontes adulteradas, provas com asserções executáveis e teste positivo do futuro cenário de **68/68 com homologação independente**.
2. `node scripts/check-desktop-parity.mjs`: valida versão do esquema, SHA de proveniência do manifesto desktop fixado, IDs únicos, contagem completa, responsáveis, dependências válidas e acíclicas, status, provas de código, associação da asserção ao cenário de teste Node/Chromium e declarações coerentes.
3. O workflow `Verify SaaS canonical foundation` executa build, `test:parity`, testes do núcleo e da API, migrações D1 em Wrangler local, Workerd, navegador desktop/mobile e verificação de um único renderer.

Uma asserção encontrada em um arquivo não basta isoladamente: a CI também precisa executar a suíte em que o cenário está registrado, com conclusão verde no commit testado. Status `covered` requer arquivo de implementação, teste executável, cenário e referência à asserção. Resultados sem execução verificável, comparação funcional e revisão de código não devem promover contratos parcialmente cobertos; inspeção física não é exigida.

## Gate de certificação futura

## P0+ — cenários executáveis e prova independente (implementado em PR #35)

- `scripts/parity-scenarios.mjs` cria um catálogo determinístico para **todos os 124 contratos** (68 telas + 56 capacidades), com quatro dimensões obrigatórias: nominal com dados idênticos, autorização, isolamento entre empresas e falha/recuperação. Cenários de equipamentos e rede usam as mesmas quatro dimensões por emulação, mocks e testes de integração; ensaio presencial é opcional e fica fora deste catálogo.
- `docs/parity/scenario-evidence.json` é o registro de evidências, **vazio no início propositalmente**. Implementação existente e testes limitados não substituem resultado comparativo independente do mesmo fluxo.
- Para certificar individualmente um cenário automatizado, adicionar no registro: `scenarioId`, `desktopBaselineCommit`, `desktopFixtureId`, `fixtureFile` na pasta `docs/parity/fixtures/`, `testFile`, `testRunner`, `testContains` e `testAssertionContains`. A suíte referenciada deve ser realmente executada pela CI. O teste de cenário deve conter os IDs associados à comparação e checar resultado observável, não simplesmente presença de strings.
- Ensaios presenciais e modelos de equipamento podem ser registrados separadamente por quem implantar, mas não geram cenários obrigatórios nem impedem a certificação do código.
- `scripts/parity-desktop-pricing.test.mjs` compara vetores fixos de cálculo/desconto/arredondamento contra o código canônico, cujo blob é conferido byte a byte com o arquivo `js/domains/sales/pricing.js` da origem pinada. **Prova apenas a equivalência do mecanismo de preços coberto pelos casos**, não todo o checkout.
- `npm run audit:parity` valida a matriz, a origem e os cenários, gerando `qa-artifacts/parity/audit-summary.json` e `scenario-catalog.json`. Os resultados são publicados como artefato CI `pdv-total-parity-evidence`, inclusive quando a etapa de teste posterior falha.
- `npm run test:parity` acrescenta cenários e testes do mecanismo de preços às regressões anteriores. Uma mudança para `complete` exige **100% das evidências dos cenários pertinentes**, além das 68/68 e 56/56 linhas, revisão independente e CI aprovada.

**Importante:** cenários planejados não representam testes efetivamente passados. Não promover uma linha de `partial` ou `gap` apenas porque há um cenário listado. Testes do desktop para demais módulos ainda dependem de extração independente de dados de referência, cenários E2E e revisão independente de código.

## Gate de certificação futura

O campo `parityClaim` das sete telas aceita `complete` **somente** com os 68 contratos `covered` e `certification` específica contendo:

- `scope: seven-screen-operations`, o SHA original do desktop e o SHA exato da versão web;
- URL da execução do GitHub Actions aprovada, revisor independente identificado, data e `testSuitePassed: true`;
- referências a testes Node/Chromium que comprovem os comportamentos e não apenas importações ou snapshots de UI.

Já `fullSystemClaim` depende de **todas as 56 capacidades** independentes cobertas, além dos 68 contratos. Só pode mudar para `complete` com certificação separada `scope: full-desktop`, e deve incorporar a expansão dos subfluxos, testes multi-terminal automatizados, backups/restore em ambiente isolado e contratos emulados para dispositivos específicos, **sem exigir testes em equipamentos reais**. A CI não infere paridade total a partir de build bem-sucedido.

## Próximo incremento após P0

1. P1: cancelamento/devolução, reversões imutáveis de estoque/caixa/financeiro/crediário/comissões, incluindo sessões encerradas.
2. P2: produto pai, variações, kits/combos, compras, reserva e custo histórico.
3. P3: dispositivos, LAN, operações restaurante/atacado, imports e restauração.
4. P4: E2E por capacidade e por segmento com dados de referência idênticos aos do desktop; revisão externa; publicação com rollback ensaiado.

**Política de custo:** núcleo R$ 0, código aberto, Node.js + SQLite self-hosted. Cloudflare Free e serviços comerciais são opções explícitas, não dependências ocultas. **Não alterar nem fazer deploy no repositório desktop antigo.** Em produção, manter `AUTH_ENABLED=false` enquanto gates de segurança e implantação remota estiverem pendentes.
