# P3/P4 — histórico auditável e comparativos web (recorte incremental)

## P3 — consultas sem segundo ledger

- `GET /api/v1/tenants/:tenant/sales/history?branchId=...&from=&to=&status=&operatorId=&sellerId=&customerId=&productId=&paymentMethod=&limit=&offset=` usa **sales, sale_items, sale_payments e customer_credit_ledger canônicos**. Filtra no banco e calcula a contagem total **antes** de paginar. Não duplica venda ou pagamento. `paymentMethod=STORE_CREDIT` consulta encargos do crediário no ledger próprio.
- A tela **Últimas vendas** tem um grupo de filtros avançados para vendedor, operador, cliente, produto e meio de pagamento. Filtros aplicados no servidor e preservados entre páginas.
- `GET /api/v1/tenants/:tenant/cash/sessions/search?branchId=...&from=&to=&status=&operatorId=&limit=&offset=` consulta as sessões históricas do **mesmo banco transacional** com janela e paginação, preservando a rota anterior `/cash/sessions`. A tela **Caixa** adiciona **Consultar histórico completo**, sem substituir a operação de abertura/fechamento.
- Permissões permanecem `sales.view` ou `cash.view`, com isolamento por empresa e filial.

## P4 — comparação sem receita duplicada

- `GET /api/v1/tenants/:tenant/reports/compare?branchId=...&from=&to=&compareFrom=&compareTo=` chama o relatório canônico em ambas as janelas e devolve receita líquida, bruta, devoluções, quantidade de vendas, diferença absoluta e percentual. Percentual sem base anterior é `null`, não uma divisão por zero nem crescimento fictício.
- A visão geral do relatório **web** passa a exibir receita líquida e devoluções, além de comparar com o período anterior equivalente. A versão desktop original permanece intacta.
- Um estorno é reconhecido na **data da compensação**, preservando a venda original na data em que ocorreu. O cálculo segue as regras já existentes na API de relatórios.

## Limites e próximos critérios de aceite

Esta entrega melhora apenas parte de P3/P4. **Não declarar paridade total** nem marcar contratos como cobertos sem outros testes. Persistem: sessões de caixa simultâneas independentes por terminal (exige alterar chave e fechamento), observações/configurações de itens, reimpressão e periféricos físicos, vendas suspensas equivalentes em todos os fluxos, conciliação real com diferentes bancos, centros de custo e recorrências completos, margem histórica de todos os itens sem custo legado, estoque mínimo/cobertura e exportações desktop equivalentes.

Não executar migração remota, não habilitar `AUTH_ENABLED` nem alterar licenças, secrets ou o desktop antigo. CI roda SQLite/D1, Workerd e Chromium.
