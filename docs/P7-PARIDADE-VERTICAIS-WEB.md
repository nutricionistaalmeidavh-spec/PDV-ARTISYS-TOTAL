# P7 — Módulos verticais do PDV TOTAL (Web)

Implementação isolada na branch `feat/web-p7-customers-restaurant-wholesale-credit-commissions`. Não mover para o projeto legado `PDV-ARTISYS` ou copiar servidor Electron. NÃO liberar produção sem CI, QA e confirmação da migração D1.

## Arquitetura

- **Núcleo canônico**: `packages/core/js/domains/sales/pricing.js` e `inventory-rules.js` para totais, descontos e quantidades; `apps/api/src/commerce.mjs` é o único escritor de vendas, pagamentos comuns e estoque.
- **Banco canônico**: D1/SQLite com `0004_vertical_parity.sql`. Isolamento de tenant e branch via membership autenticada e foreign keys compostas.
- **Clientes**: cadastro, ativação e limite de crédito; usado pelo balcão, atacado e restaurante. Fornecedores têm cadastro separado e vínculo de empresa.
- **Vendedores**: mesma identidade `users` + `tenant_memberships`; sem criar tabela paralela de usuários/vendedores. Regra de comissão por vendedor/produto; comissão imutável contabilizada na **mesma transação** que conclui venda.
- **Restaurante**: mesas e sessão exclusiva por mesa, pedidos salão/retirada/entrega com KDS, exigência de produção READY antes da entrega, fechamento só sem pedidos pendentes. Documento de pedido não baixa estoque automaticamente; saldo real fica no balcão.
- **Atacado**: cotação com preço de faixa por quantidade imutável, confirmação, criação de uma venda canônica com preço cotado e cliente vinculado. Estoque é movimentado **somente** ao concluir essa venda no balcão.
- **Crediário**: método STORE_CREDIT exige cliente e limite; débito em ledger imutável na transação da venda. Recebimento parcial/todo em dinheiro, PIX ou transferência, com redução de dívida; recebimentos em dinheiro entram na reconciliação de caixa, sem criar segunda receita.

## Aplicação da migração

Executar as migrações **uma vez, na ordem** 0001 -> 0002 -> 0003 -> 0004 para novos ambientes. Para ambientes existentes somente aplicar `0004_vertical_parity.sql`. Faça backup do D1/SQLite antes de executar. O sistema **não deve** habilitar `AUTH_ENABLED` nem expor contas sem provisionamento e QA. Cloudflare é hospedagem opcional; o núcleo Node.js, SQLite e a interface são executáveis localmente sem serviço pago.

## Gates de paridade antes de declarar completo

| Grupo | Implementado nesta etapa | Ainda requer QA/paridade adicional |
|---|---|---|
| Clientes | CRUD básico, limite, vínculo com venda e crediário | Importação, histórico detalhado, todas as validações e exclusões do desktop |
| Fornecedores | CRUD básico, tenant isolado | Compras, contas a pagar e histórico completo |
| Vendedores | Lista de membros, seleção em vendas, regras gerais e por produto via API | Gestão de convites/perfis na web e repasse/pagamento das comissões |
| Restaurante | Mesas, comandas, KDS básico, delivery, retirada, estados e encerramento | Estações, roteamento por ficha técnica, impressão e dispositivos/QR/tablet |
| Atacado | Faixas, cotações, confirmação, preço histórico e checkout canônico | Múltiplos itens na tela, política comercial editável e fluxos B2B avançados |
| Crediário | Vendas com limite, saldo, recebimento, idempotência e caixa | Cancelamento/devolução integral e relatórios periódicos avançados |
| Comissões | Regra global ou por produto, ledger de aquisição, relatório de saldo | Estornos por devolução, pagamento de comissão com conciliação |

### Verificações de regressão

A suíte `apps/api/test/vertical-parity.test.mjs` testa:
- Isolamento de empresas, chaves idempotentes e cadastros.
- Mesa única, KDS uma vez, transições de preparo e fechamento.
- Desconto/preço de atacado preservado até a venda final e unicidade de venda.
- Limite de crediário sob transação, crediário não vira caixa falso.
- Recebimento de crediário no caixa e impedimento de pagamento a maior.
- Comissão uma vez por item na conclusão da venda.

A suíte `apps/api/test/commerce.test.mjs` executa o core anterior com a migração 0004, garantindo que vendas/caixa/financeiro antigos sigam funcionando.

## Estratégia de integração paralela

Manter o PR em draft enquanto a outra conversa edita `main`. Antes de merge, atualizar a branch com `main`, revisar conflitos em `app.js`, `commerce.mjs`, `worker.mjs` e `index.html`; executar CI, QA navegador/mobile, verificar RBAC, testando dados de duas empresas. Só depois solicitar merge sem force-push e deploy separado, com migração D1 previamente aplicada.
