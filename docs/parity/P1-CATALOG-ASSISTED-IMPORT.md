# P1 — Importação assistida do catálogo (CSV)

## Escopo realmente implementado

A rota canônica `/api/v1/products/import/preview` mostra ações `create`/`update` para cada SKU. O modo legado continua sendo `create`, não modifica produtos existentes e é compatível com os clientes anteriores. O novo modo `upsert` é **opt-in**, disponível na mesma modal de produtos em `apps/web/app.js`. Ambas as rotas exigem `products.manage` e o servidor deriva a empresa da sessão autenticada.

Ao atualizar: `tenant_id` + `sku` identificam o produto; `id`, estoque e ledger, custo histórico, modo de controle de estoque, variações, snapshots de venda e criação permanecem intocados. Nome e preço são obrigatórios no arquivo; unidade, marca, código de barras e categoria, quando omitidos, são preservados. Mudança de unidade ou `trackStock` de SKU existente é bloqueada; a edição desses campos exige migração auditada distinta.

A prévia exibe o resultado por linha, duplicidades, colisões de barcode/categoria e o token de conferência SHA-256 dos campos do CSV + estado do catálogo. O commit do modo `upsert` exige o mesmo token, reexecuta toda a validação e rejeita alterações detectadas após a prévia. A escrita usa `db.batch` atômico, o registro de mutações garante idempotência com `x-mutation-id`, e restrições SQL continuam protegendo unicidade e tenant.

### Limitações / próximos requisitos

- Arquivos CSV UTF-8 de até 13.500 caracteres e 100 linhas de produtos por lote; planilhas XLSX ainda não estão importadas nativamente. Não chamar `products-032` de `covered` antes de atingir esses contratos e comparar ao desktop.
- O token evita substituição **detectável antes do commit**; uma atualização externa intercalada entre a segunda leitura e o batch requer homologação concorrente adicional com atualização condicional/transações serializadas.
- Preço/cadastro histórico não são reescritos no histórico de vendas. A atualização não muda valores de estoque e não gera movimentação.
- CI executa `apps/api/test/p2-csv-import.test.mjs`, migrations D1 local, smoke Workerd e navegador; `docs/parity/desktop-web-matrix.json` mantém o contrato parcial enquanto houver lacunas.

**Custo**: executa em SQLite local e D1 gratuito sem gateway, processamento externo ou cobrança.
