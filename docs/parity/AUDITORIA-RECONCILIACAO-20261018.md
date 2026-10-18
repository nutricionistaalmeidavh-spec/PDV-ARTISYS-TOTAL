# Auditoria de reconciliação — 18/10/2026

## Escopo e bases imutáveis

- Repositório auditado: `nutricionistaalmeidavh-spec/PDV-ARTISYS-TOTAL`.
- Base da branch desta correção: `main@b2f2a668455d6b65f24744c3d297ee579573051f`.
- Desktop de referência: `PDV-ARTISYS@7efea9c61f75be1536a1e516e917218f2b8bf2bf` (somente leitura).
- Inventário canônico: `docs/parity/desktop-capability-inventory.json` (56 IDs, NÃO duplicar com os 68 contratos de telas).
- Contratos subordinados: `docs/parity/desktop-web-matrix.json`; cenários: `docs/parity/scenario-evidence.json`.

## Fotografia comprovável do inventário versionado

| Onda | Cobertas | Parciais | Sem prova integral |
| --- | ---: | ---: | ---: |
| R1 (21) | 21 | 0 | 0 |
| R2 (14) | 11 | 3 | 0 |
| R3 (8) | 0 | 6 | 2 |
| R4 (13) | 1 | 12 | 0 |
| **56 totais** | **33** | **21** | **2** |

68 contratos de tela: 43 `covered`, 25 `partial`. `fullSystemClaim` e `parityClaim` continuam `incomplete`.
Classificação de código não significa produção homologada; testes de hardware físico são opcionais e posteriores.

## Triagem de PRs e branches

- **PR #73**, integração R2 com R1/R4/P5: já mergeada. Código de pareamento, perfis, revogação, testes integrados e o checklist `R2_PILOT_CHECKS` da branch #68 já estão na `main`; não copiá-los novamente.
- **PR #68**, `feat/r2-closure-code-coverage-20261018`: aberta/divergente e não mergeável contra o commit auditado. Uma execução prévia falhou no navegador LAN; outras execuções foram canceladas e o check externo Workers Builds do head também falhou. **Não** mergear como está; portar seletivamente código exclusivo, preservar provas da `main` e exigir CI do commit novo.
- **PRs #69, #71, #75**: já mergeadas. A R1 não é uma entrega por fazer.
- **PRs #70, #74, #76**: fechadas sem merge. Tratar as branches como material de auditoria histórica; nenhuma autorização para restaurar estados antigos da matriz.
- **Branches históricas de hardware**, incluindo `feat/web-peripherals-print-scale`, `feat/web-hardware-spooler-weight-parity` e `work/rebase-web-hardware-parity-20261017`: existem commits divergentes, mas isso não é prova de funcionalidade ausente. Comparar serviços, cenários e `tools/local-hardware-bridge/` antes de trazer qualquer patch; não substituir rotas canônicas atuais.
- **Branches antigas P1/P2/P3/P5**: grande distância da `main`. Commits exclusivos podem resultar de histórico divergente/squash. Não fazer merge em lote, cherry-pick por título nem sobrescrever código atual.

## Delta R2 selecionado para esta branch

1. `/api/v1/health` informa `lanMode` para distinguir servidor local da hospedagem opcional.
2. A PWA evita leitura comercial antes do pareamento da primeira sessão LAN, abre a tela de Configurações e retoma a navegação após vincular o aparelho; ao revogar o próprio terminal limpa a credencial de sessão local e reinicia a interface.
3. Recupera o teste Chromium de HTTPS LAN real com janela mobile, pareamento, revogação, perda de conectividade e recuperação (não simula venda offline).
4. Restaura a validação da instalação Windows por workflow próprio, usando scripts existentes na `main`. Mantém o CLI de servidor/terminal independente de nuvem, com validação de caminhos privados.
5. README, roadmap, documentação LAN e periféricos alinhados à fotografia canônica e ao núcleo gratuito self-hosted.

**Não promover `cap-001`, `cap-047` ou `cap-056` a `covered` sem o gate executado no SHA desta branch e comparação de comportamentos do desktop.** As provas R1/R2/R4 já cobertas não podem regredir.

## Lacunas reais de paridade

- **R2:** `cap-001` (reinício/instalação local), `cap-047` (jornada mobile LAN), `cap-056` (perfis servidor/terminal e implantação).
- **R3:** `cap-025`–`cap-029` e `cap-050` ainda parciais; `cap-030` (comprovante personalizável) e `cap-043` (compatibilidade de periféricos versionada) sem prova integral. Bridge existente é ponto de partida; ensaios físicos não bloqueiam aceite de software.
- **R4:** `cap-009`, `cap-031`, `cap-032`, `cap-034`–`cap-039`, `cap-041`, `cap-048`, `cap-049` parciais. Faltam casos completos de divisão, concorrência de pedidos/terminais, KDS, insumos, delivery e relatórios, inclusive comparações com desktop.
- **R1:** 21/21 cobertas no inventário, manter regressões; nunca reabrir a onda por instrução textual antiga.

## Gate antes de merge

- `npm run test:parity` e teste de consistência documental.
- `npm run build`, `npm run check:web`, `npm run test:api`, `npm run test:core`, `npm run test:selfhost`.
- Windows: `node --experimental-sqlite --test apps/api/test/r2-deployment-profiles.test.mjs`.
- Chromium real: `node --experimental-sqlite scripts/r2-lan-browser-e2e.mjs`, além do E2E original.
- Worker/D1 local (opcional na arquitetura, CI de compatibilidade).
- CI verde no **SHA exato** da PR, comparação da matriz/inventário e revisão de regressão.

**Política:** software core R$ 0 / self-hosted / open source; Cloudflare, pagamentos e qualquer serviço pago estritamente opcionais.
