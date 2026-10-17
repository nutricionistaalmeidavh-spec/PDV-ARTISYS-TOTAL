# ArtiSys PDV — Release checklist

A release só é considerada publicável quando todos os gates abaixo são comprovados no mesmo HEAD. A versão distribuída não é hardcoded neste documento: o workflow resolve `RELEASE_VERSION` com `scripts/resolve-release-version.js` imediatamente antes do build.

## Gates técnicos

- [ ] `npm ci --no-audit --no-fund` instala exatamente o grafo do lockfile raiz.
- [ ] `npm run verify:release` verde no HEAD final.
- [ ] Perfil QA `release` verde, incluindo regressões de checkout, módulos e navegação.
- [ ] Confirmar que o instalador V1 não contém ACBr, sidecar, fiscal-runtime ou fiscal-packs.
- [ ] Confirmar impressão/reimpressão de documentos NÃO FISCAIS para venda, pedidos/comandas, cozinha/KDS e caixa.
- [ ] Windows x64 NSIS gerado no CI a partir do mesmo HEAD.
- [ ] Executável empacotado passa no smoke test sem encerramento prematuro.
- [ ] `latest.yml` e blockmap do updater são gerados e validados.
- [ ] Manifesto e SHA-256 são gerados a partir do mesmo instalador.
- [ ] Artefato final usa `ArtiSys-PDV-${RELEASE_VERSION}-x64-Setup.exe`.
- [ ] GitHub Release usa a tag `v${RELEASE_VERSION}` e aponta para o mesmo commit verificado.
- [ ] Gates pós-merge em `main` permanecem verdes.

## Invariantes operacionais

- SQLite permanece autoritativo no servidor local; terminais usam a API LAN.
- `SaleService` permanece o motor canônico de conclusão de vendas.
- Módulos opcionais desativados não aparecem como fluxo operacional e não aceitam mutações específicas no backend.
- O núcleo obrigatório continua local-first/self-hosted para a operação diária, mas a distribuição oficial exige ativação comercial antes do primeiro acesso ou login de uma instalação ainda não ativada.

## Validação física

A CI valida contratos, protocolo, recuperação, framing, parser e simulações, mas não substitui eletrônica, firmware, cabo, driver e teste do equipamento físico.

- `PROTOCOL_VERIFIED`: protocolo coberto pela suíte automatizada;
- `FIELD_VERIFIED`: fabricante/modelo testado fisicamente com evidência;
- `UNTESTED_MODEL`: modelo específico ainda não validado em campo.
