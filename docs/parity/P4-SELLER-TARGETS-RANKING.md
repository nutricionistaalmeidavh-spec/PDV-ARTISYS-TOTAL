# P4 — metas comerciais mensais e ranking de comissões

## Contrato operacional

A migração aditiva **0015_seller_sales_targets.sql**, após **0014_checkout_configurations.sql**, persiste apenas metas comerciais por vendedor, filial, empresa e mês. O alvo não é lançamento financeiro e **não cria um segundo livro**. Em D1 e no self-hosted, o banco canônico continua contendo as únicas vendas, devoluções, comissões e pagamentos.

- **PUT** `/reports/commission-targets` aceita `sellerId`, `month` AAAA-MM e `targetCents` inteiro positivo, exige `sellers.manage` e usa `commerce_mutations` para idempotência e auditoria. Vendedor deve pertencer à empresa.
- **GET** `/reports/commission-ranking?month=AAAA-MM` exige `reports.view`, lê vendas concluídas no mês e subtrai as devoluções efetivadas no próprio mês, incluindo restituições de vendas de meses anteriores.
- O ranking lê `seller_commission_ledger` imutável, distinguindo `EARNED`, `REVERSED` e `PAID`. O saldo do mês não equivale ao saldo histórico acumulado nem a lucro. Uma meta ausente aparece como não definida, jamais como meta zero ou progresso fictício.
- A UI web **Relatórios comerciais → Metas e ranking** permite escolher mês, consultar indicadores e definir metas conforme autorização. Valor é apresentado em BRL.

## Restrições e aceite

O recorte é **mensal** em UTC para o registro dos eventos no banco; necessidade de fuso contábil local da loja e políticas de metas customizadas permanece. O histórico de comissões pagas e o saldo acumulado devedor precisam de auditoria integral com o desktop; sem conexão bancária nova, pagamento automático de comissão ou exportação fiscal. Dados de outra empresa/filial não participam das somas.

O contrato `reports-064` permanece **PARCIAL**. Testes verificam receita líquida após devolução, regra de 5%, estorno proporcional, idempotência, autorização, vendedores de outra empresa e meses inválidos. CI requer SQLite, D1 local, Workerd, Chromium desktop/mobile. A migração é testada localmente e **não aplicada ao D1 remoto**. Não alterar `AUTH_ENABLED` ou segredos, licenças ou runtime Electron.
