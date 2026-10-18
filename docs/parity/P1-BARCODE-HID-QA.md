# P1 — Entrada de código de barras por leitor USB tipo teclado

O checkout web recebe códigos de barras por `#product-search`: um scanner USB HID (modo teclado) digita o código e envia `Enter`. O sistema procura **correspondência exata** no SKU **ou no código de barras independente**, entre os produtos ativos do catálogo canônico. Um único resultado adiciona a linha pela operação de checkout atual (incluindo validação de estoque, configuração de variantes e regras de acesso). Pesos em KG/G mantêm a interface de pesagem atual; não há leitura direta da balança nesta entrega.

**Proteções:** código desconhecido não gera cobrança, código com conflito entre SKU de um item e barcode de outro é rejeitado como ambíguo, buscas parciais/nome não são cobradas automaticamente, e duas submissões Enter simultâneas não abrem operações paralelas de venda. Após leitura aceita, a busca limpa para o próximo código.

**Evidência automatizada:** `scripts/web-browser-e2e.mjs` cadastra produto com SKU diferente de barcode, testa código inexistente, envio Enter, uma linha de venda, limpeza da busca e reversão da linha antes de continuar o checkout. A CI executa Chromium real com Workerd, API D1 local e SQLite, sem driver de hardware ou serviço pago.

**Pendências físicas:** testar leitores HID reais por fabricante, layout de teclado brasileiro, prefixo/sufixo do equipamento, foco após diálogos, reconexão e leitura contínua no balcão. A homologação física deve registrar dispositivo, sistema operacional e revisão externa no P0. Não declarar `products-025` coberto integralmente até essas provas e comparação com o desktop original.
