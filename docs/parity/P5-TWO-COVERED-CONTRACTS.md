# P5 — dois contratos adicionais cobertos com comparação executável

## Escopo exato (sem transformar o P5 inteiro em 100%)

- **home-002:** o modelo de atalhos e a política de acesso são os mesmos *blobs Git* publicados no desktop imutável `7efea9c61f75be1536a1e516e917218f2b8bf2bf` (`d5fd4d207a1a7e12f5a7ab37b9d34e2c5a461051` e `d6c1db4cc69c663bda029f191c596a46f49445a0`). Os quatro cenários executados validam listas de ações por perfil, negação de atalhos proibidos, não vazamento entre contextos de permissão e preservação do estado após acesso negado. A autorização real de dados permanece obrigatoriamente no servidor.
- **reports-060:** executa as funções originais `buildInventorySummary`, `buildCashSummary` e `buildFinanceSummary`, verificando o blob original `a5ffc3e9e467e5475bd250fa46f77d80ff0a017d`, com entradas fixas. Compara saldo físico, caixa fechado, divergência, valor em aberto e parcial pago com uma instância real do SQLite + API autorizada. Três testes adicionais exercitam conta somente leitura, escopo de empresa/filial e rejeição de pagamento excessivo sem mutação no relatório.
- Cenários P0: `home-002/nominal`, `home-002/authorization`, `home-002/tenant-isolation`, `home-002/failure-recovery`, e as mesmas quatro dimensões de `reports-060` têm fixtures, testes executáveis e asserts específicos no inventário.
- O código das regras publicadas do desktop permanece **somente leitura**. Nenhuma rotina remota é necessária: os testes executam o código original preservado e verificam seu SHA Git em runtime.

## Limites transparentes

`home-002` comprova **visibilidade de atalhos por capacidades** e política de acesso da tela; não substitui RBAC do servidor.
`reports-060` comprova **o relatório operacional básico** de estoque, caixa e contas manuais para o vetor nominal. Relatórios históricos complexos, CMV, comissões, fiscalidade, balança, impressora, LAN, comparação de layouts e perfis fora desse escopo não são considerados homologados.

**Certificação global continua incompleta** enquanto houver outros contratos P5 ou demais telas ainda parciais. Os status destes dois contratos só são aceitos após teste de origem com hash imutável e **GitHub Actions verde no SHA exato** da branch. Nenhum responsável externo por QA humano foi inventado.

## Execução e arquivos

- `apps/api/test/p5-home-role-parity.test.mjs`
- `apps/api/test/commerce.test.mjs` (cenários `reports-060`)
- `docs/parity/fixtures/p5-home-roles-desktop-pinned.json`
- `docs/parity/fixtures/p5-report-core-desktop-pinned.json`
- `docs/parity/scenario-evidence.json`
- `docs/parity/desktop-web-matrix.json`

O núcleo continua gratuito, local e self-hosted com Node + SQLite; Cloudflare remoto não faz parte desta certificação.
