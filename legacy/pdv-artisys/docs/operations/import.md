# Importação e migração

O ArtiSys PDV 1.0 aceita **CSV UTF-8** e **XLSX** para implantação inicial sem expor filesystem genérico ao renderer.

## Fluxo obrigatório

1. Em **Configurações > Importação**, selecione o tipo: produtos, categorias, clientes, fornecedores ou estoque inicial.
2. Escolha o arquivo pelo seletor restrito.
3. Defina a política de colisão `CREATE`, `UPDATE` ou `SKIP`.
4. Execute **Pré-visualizar**.
5. Revise contagem e erros por linha. Um lote inválido não é aplicado parcialmente.
6. Somente depois execute **Confirmar importação**.

SKU, código de barras e documentos são normalizados. O hash do conteúdo e o batch id impedem duplicação ao repetir o mesmo lote. Estoque inicial é aplicado pelo serviço de inventário como movimento de abertura/ajuste, nunca por alteração direta do saldo.

Antes de uma migração extensa, crie e valide um backup manual.
