# P6 — paridade estendida de 56 capacidades (implementação por provas)

## Baseline imutável e escopo

Origem: `PDV-ARTISYS@7efea9c61f75be1536a1e516e917218f2b8bf2bf`.
Destino: este repositório, `apps/web` + `apps/api` + `packages/core` + bridge local isolado.
A matriz de 68 contratos das sete telas e as 56 capacidades do manifesto fixado
devem **ambas** atingir 100% comprovado; quantidade de arquivos não implica paridade.

No início desta branch, a medição automatizada da `main` era:
- 68 contratos: 23 `covered`, 24 `partial`, 21 `gap`.
- 56 capacidades: **0 `covered`, 14 `partial`, 42 `gap`**.
- `fullSystemClaim: incomplete`: não alterar sem CI e revisão independentes.

## Quatro frentes paralelas, sem duplicar o domínio

| Frente | Capacidades prioritárias | Requisito para avanço |
| --- | --- | --- |
| Infraestrutura self-hosted / LAN | cap-001, 002, 003, 010, 042, 044–047, 051, 053–056 | HTTPS em LAN, autenticação/revogação real, cópia consistente e restauração ensaiada, múltiplos dispositivos, sem dependência paga |
| Catálogo e operações comerciais | cap-004–008, 011–024, 040, 052 | Reutilizar serviços canônicos e ledger, isolamento por empresa, idempotência, concorrência, integridade caixa/estoque/financeiro |
| Periféricos | cap-025–030, 043, 050 | Bridge restrito ao próprio terminal, fila persistente, testes de recuperação, impressão e pesagem **em hardware físico** |
| Alimentação e verticais | cap-009, 031–039, 041, 048–049 | Mesas, comandas, KDS, delivery e balcão completos em UI web, testes reais por papel e filial |

A divisão é uma organização de trabalho; **todos os 56 IDs** permanecem exigidos pelo gate
em `docs/parity/desktop-capability-inventory.json`. Outras dependências entre frentes
continuam vinculadas aos IDs dos 68 contratos.

## Arquitetura obrigatória

```text
ÚNICA UI Web/PWA (desktop, tablet, celular)
             |
      API autoritativa
    (sessão, RBAC, empresa, filial)
             |
   packages/core — domínio canônico
       /                  \
SQLite local          bridge local
self-hosted           periféricos
```

- O backend SQLite self-hosted é o **caminho gratuito obrigatório**; D1/Cloudflare,
  cobrança e serviços proprietários são alternativas opcionais, jamais requisitos ocultos.
- Dados e permissões são resolvidos no servidor; não usar o `tenant_id` enviado
  pelo navegador como autorização.
- API não pode ser contornada por escrita do front-end, bridge ou SQLite do navegador.
- LAN precisa HTTPS e cookies seguros, com autenticação real e testes multi-terminal;
  o servidor dev atual é restrito a loopback. **Não expor o servidor dev com cookies
  inseguros em 0.0.0.0**. A existência de configuração LAN não equivale a homologação.
- Backups e restauração fazem parte do núcleo self-hosted, sem dependência de nuvem.

## Incremento já implementado: backup e restauração local seguros

CLI em `scripts/selfhost-backup.mjs`, Node 22+ com `node:sqlite`. Com a
API local em uso, backup usa a API nativa do SQLite, que captura um snapshot
coerente mesmo em WAL. O resultado é um arquivo SQLite e um manifesto lateral,
ambos com permissão restrita no sistema de arquivos (onde suportado).

```bash
node --experimental-sqlite scripts/selfhost-backup.mjs create \
  apps/api/.local/pdv-total.sqlite /caminho-protegido/pdv-backup.sqlite
node --experimental-sqlite scripts/selfhost-backup.mjs verify \
  /caminho-protegido/pdv-backup.sqlite
node --experimental-sqlite scripts/selfhost-backup.mjs restore \
  /caminho-protegido/pdv-backup.sqlite /caminho-novo/pdv-restaurado.sqlite
```

O CLI verifica SHA-256, `PRAGMA integrity_check`, `foreign_key_check` e tabelas
de identidade antes de aceitar a cópia. A restauração é **preparatória e não
destrutiva**: nunca sobrepõe o banco ativo. Para ativar o arquivo restaurado,
**desligar primeiro a API**, apontar `LOCAL_DB_PATH` para o novo banco e
validar login, operações e versão de migrations antes de liberar produção.

O SQLite de backup contém dados sensíveis **sem criptografia**: guardar
preferencialmente em volume local criptografado, com acesso restrito. Nunca
publicar o backup no repositório, Actions ou pasta pública do Worker.
O teste automatizado valida snapshot consistente, bloqueio de sobrescrita e
rejeição de arquivo adulterado. Não comprova ainda ensaio operacional em ambiente real.

## Critérios para mudar `partial`/`gap` para `covered`

1. Contratos básicos de que a capacidade depende devem estar `covered`.
2. `independentEvidence` com `file`, `contains`, `testFile`,
   `testContains`, `testAssertionContains`, `testRunner` e um
   cenário executável cujo nome contém o ID canônico `cap-NNN`.
   A CI executa essa suíte, não apenas procura string.
3. Em casos LAN e periféricos definidos em `FIELD_REQUIRED_CAPS`, incluir
   `fieldVerification` com `status: FIELD_VERIFIED`, plataforma, modelo
   testado, revisor independente, data e `evidenceFile` em
   `docs/parity/field-qa/`, com resultado de testes físicos de dispositivos.
   Simulador/Chromium não substitui impressão ou balança real.
4. Testar fluxo inteiro na UI, sessões/perfis, separação de empresas,
   concorrência/idempotência e persistência real quando aplicável.
5. Publicar evidência e execução verde no SHA **exato** do candidato;
   revisar independentemente. Atestados de CI não provam homologação física.
6. Só então atualizar a matriz/inventário. A certificação sistêmica
   `full-desktop` exige simultaneamente **68/68 + 56/56** e recibo de
   revisão/CI rastreável, sem alterar a origem desktop.

**Não realizar merge automático.** Revisar diffs, testes Node, API, Workerd,
Chromium e homologação manual aplicável antes de integrar à `main`.
