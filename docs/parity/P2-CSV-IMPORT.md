# P2.2 — importação CSV com prévia e confirmação

## Fluxo

Em **Produtos e estoque → Importar CSV**, selecione um arquivo texto CSV em UTF-8 (BOM opcional), até 13,5 KB. A prévia identifica erros por linha, SKUs repetidos e códigos de barras existentes. Nada é gravado nessa etapa. O botão de importação só fica habilitado quando todas as linhas são válidas. Ao confirmar, todos os novos produtos são criados **em uma transação canônica única** ou nenhum é criado.

Colunas obrigatórias: `sku;name;salePriceCents`. Colunas opcionais: `unit;barcode;brand;trackStock;categoryId`. O parser aceita `;` ou `,` conforme o cabeçalho, BOM, CRLF e aspas CSV com delimitadores embutidos. O preço é sempre **inteiro em centavos**, não preço em texto brasileiro.

Exemplo de duas linhas:

```csv
sku;name;salePriceCents;unit;barcode;brand;trackStock
X-01;"Queijo; Azul";1590;UN;7890001234567;Marca Exemplo;true
X-02;Água 500ml;450;UN;7890001234568;Marca Exemplo;true
```

## Restrições deliberadas

- Máximo de 100 produtos por operação e limite de arquivo em 13,5 KB. Use lotes menores, cada qual revisado antes de confirmar.
- Importação **somente de novos SKUs**; nunca atualiza produtos existentes nem movimenta estoque por conta própria. Entradas de saldo exigem movimento explícito.
- `categoryId` existente deve pertencer à mesma empresa; códigos de barras são únicos na empresa.
- Todos os campos são validados novamente no servidor no instante do commit; conflitos criados depois da prévia invalidam toda a operação.
- O importador usa a tabela `products` da venda e `commerce_mutations` para idempotência; não cria outro catálogo ou tabela espelho.
- Sem dependências pagas, secrets ou migrações novas de D1. O banco continua isolado por tenant.

**Ainda pendente:** XLSX com leitura segura, mapeamento de colunas personalizadas, importação/atualização assistida por correspondência de SKUs, arquivos grandes, fotos R2, histórico de lotes/localizações, custo médio móvel e homologação de hardware no terminal. A cobertura de `products-032` é **parcial** até esses cenários e a comparação exaustiva com o desktop serem homologados.

## Testes

Rodar `npm test` e o pipeline GitHub Actions com SQLite, D1 local, Workerd e Chromium desktop/mobile. Os testes `p2-csv-import.test.mjs` validam aspas CSV, BOM, duplicidade, prévia sem escrita, importação idempotente, lote atômico, colisões entre prévia/commit e categorias de outra empresa.
