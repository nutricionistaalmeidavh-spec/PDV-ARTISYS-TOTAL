# P5 — confronto de evidência com desktop publicado

## Fonte independente, fixada por commit

Desktop: `nutricionistaalmeidavh-spec/PDV-ARTISYS@7efea9c61f75be1536a1e516e917218f2b8bf2bf`.

O domínio de relatórios no arquivo `js/domains/reports/reporting-service.js` tem blob Git `a5ffc3e9e467e5475bd250fa46f77d80ff0a017d`. A cópia em `packages/core/js/domains/reports/reporting-service.js` é **byte a byte idêntica** ao blob publicado. O teste de comparação confere esse hash em execução; uma mudança posterior falha o teste.

O cenário nominal `reports-066/nominal` usa `docs/parity/fixtures/p5-stock-shortage-desktop.json`. O teste na API executa **a própria função desktop** `createReportingService(...).buildInventorySummary()` com os dados controlados da fonte e cria o mesmo estoque no SQLite da API web. Compara falta para o mínimo, produto abaixo do mínimo e custo sugerido em centavos.

Valores fixados: item A: saldo 3, mínimo 2, custo 600 centavos; item B: saldo 1, mínimo 2, custo 400 centavos. Resultado nominal desktop: apenas item B precisa reposição de 1 unidade, custo total 400 centavos, 1 produto abaixo do mínimo. A API web deve produzir exatamente esses valores quando estoque disponível é igual ao saldo físico (sem reservas).

## Diferenças reais de regra operacional

- O desktop de referência, nesta consulta, usa saldo físico por local; o web usa **saldo por filial menos reservas ativas**. A quantidade para repor pode ser maior com reservas; não esconder isso em nome de paridade literal.
- O desktop calcula custo pelo custo atualmente cadastrado. O web usa o **último custo registrado** (`last_cost_cents`) e apresenta **custo não apurado**, e não zero, quando não há preço conhecido. Não converter estimativa em orçamento, CMV auditado ou reposição automática.
- Custos desconhecidos podem coexistir com produtos de custo confiável: o total agregado fica `null` se ao menos uma falta não possuir base. A exportação XLSX e a tabela mostram essa ressalva.

## Critérios e limites de certificação

O cenário nominal comparado **não comprova as outras três dimensões obrigatórias** (`authorization`, `tenant-isolation`, `failure-recovery`) em ambos os ambientes, nem os outros contratos P5. Não registrar `verified` no `scenario-evidence.json` sem revisão e atestado verdadeiramente independentes do desktop. O teste de API cobre isolamento do lado web, mas não constitui, por si, comparação independente dos dois ambientes.

**Continua pendente:** CMV e bases de custo com compras/devoluções, clientes e nomes nos relatórios, política de comissões e repasses, layouts completos CSV/XLSX/PDF, funcionalidades do desktop que não têm representação web equivalente, navegação/perfis e aceite presencial de equipamentos onde aplicável. A matriz geral permanece **23 cobertos/45 parciais** até critérios de `covered` serem comprovados para cada contrato.

A operação básica permanece Node + SQLite local/self-hosted, sem serviços obrigatórios pagos.
