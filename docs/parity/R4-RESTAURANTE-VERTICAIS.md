# R4 — Restaurante, comandas, KDS e demais verticais

Data: 2026-10-18. Baseline desktop: `7efea9c61f75be1536a1e516e917218f2b8bf2bf`.

## Escopo canônico (13 capacidades)

| ID | Capacidade | Origem já existente | Evidência web adicional nesta entrega |
|---|---|---|---|
| cap-009 | Fichas técnicas/consumo de ingredientes | Domínio legado de receitas e estoque | Não implementado nesta entrega |
| cap-031 | Mesas, comandas, pedidos e transferência | Core `restaurant-service` + API de mesas | Transferência de mesa sem clonar comanda |
| cap-032 | Divisão de contas, taxa de serviço, transferência de itens | Core `restaurant-settlement-service` | Não implementado na API D1 nesta entrega |
| cap-033 | Checkout restaurante no caixa e estoque canônicos | Core `restaurant-settlement-service` | Comanda/pedido entregue abre venda canônica única, captura preços históricos, exige caixa para concluir e condiciona fechamento à venda paga |
| cap-034 | KDS: estações, rotas de produto/impressora | Core `kitchen-service` | Rotas completas D1 pendentes |
| cap-035 | KDS compartilhado por canais | Core `kitchen-service` | Fluxo web atual tem ticket por pedido; estações pendentes |
| cap-036 | Pizzaria: tamanhos, sabores, bordas e preços | Core `pizzeria` e UI existente | Não implementado na API D1 nesta entrega |
| cap-037 | Delivery, retirada e balcão | Core `delivery`, UI existente | Cancelamento pré-produção, checkout canônico de entrega/retirada concluída; fluxo detalhado de entregadores ainda pendente |
| cap-038 | Pedidos unificados, senhas e histórico legado | Core `food-order`, UI existente | Cancelamento idempotente; senhas/histórico D1 pendentes |
| cap-039 | Padaria e itens por peso | Core de pesagem e padaria | Paridade do protocolo de pesagem emulado pendente |
| cap-041 | Onboarding por segmento/módulos | Registro de módulos e primeira entrada | Recomendações e gestão web D1 pendentes |
| cap-048 | Chamados de garçom e conta | Core `restaurant-service` | Chamados persistidos e transições autorizadas |
| cap-049 | Relatórios restaurante e CSV | Core `restaurant-reporting-service` | Resumo por filial e período e CSV operacional |

**Estado de paridade:** a existência de código ou teste de API não certifica capacidade integral. Não alterar os estados das 56 capacidades sem matriz completa e revisão independente. O termo *13* se refere às capacidades, não a treze setores do varejo.

## Contratos introduzidos nesta rodada

- `POST /api/v1/tenants/:tenant/restaurant/sessions/:session/transfer` — `{branchId,targetTableId}`; destino deve estar ativo e livre.
- `POST /api/v1/tenants/:tenant/restaurant/sessions/:session/requests` — `{branchId,type:'WAITER'|'BILL',note?}`.
- `GET /api/v1/tenants/:tenant/restaurant/requests?branchId=:branch`.
- `PATCH /api/v1/tenants/:tenant/restaurant/requests/:id` — `{branchId,status:'ACKNOWLEDGED'|'CLOSED'}`.
- `POST /api/v1/tenants/:tenant/restaurant/orders/:id/cancel` — apenas antes de iniciar a produção.
- `GET /api/v1/tenants/:tenant/restaurant/reports/summary?branchId=:branch&from=YYYY-MM-DD&to=YYYY-MM-DD`.
- `GET /api/v1/tenants/:tenant/restaurant/reports/csv?branchId=:branch&from=YYYY-MM-DD&to=YYYY-MM-DD`.

Escritas usam `X-Mutation-ID` obrigatório, com escopo por estabelecimento. Os relatórios consideram datas **UTC** inclusivas e no máximo 366 dias, 3.000 pedidos. `orderedCents` exclui cancelados; **não corresponde a faturamento/recebimento**; vendas, caixa e estoque pertencem ao checkout único.

## Persistência e acesso

Migrações incrementais `0021_r4_restaurant_operations.sql` (chamados) e `0022_r4_restaurant_checkout.sql` (vínculos para venda canônica, snapshots bloqueados e trava de novos pedidos ao cobrar). Mesas/comandas e pedidos reutilizam tabelas existentes. A API usa `restaurant.service.manage`, `restaurant.orders.transfer`, `reports.view` e `restaurant.access`; o tenant é resolvido pela sessão, nunca pelo corpo da requisição. SQLite self-hosted é o padrão gratuito; D1 é opcional, não dependência.

## Critérios pendentes para R4 integral

1. A jornada básica web/PWA passou a ter tela própria vinculada à API de mesas, pedidos, KDS, chamados e checkout, mas ainda exige QA browser PC/tablet/celular e verificação de acessibilidade, operações simultâneas e sessão interrompida.
2. A venda canônica já é reutilizada para cobrança integral de uma comanda ou pedido entregue; faltam divisão parcial de conta, taxa de serviço configurável, transferência de itens e aceites de conciliação do desktop.
3. Igualar mesa, operação de garçom, KDS por estação, roteamento por produto e impressão à baseline desktop, incluindo dispositivos autorizados e recuperação após falhas.
4. Portar as políticas de pizza, delivery/retirada/senha, histórico, padaria/balança, ficha técnica e onboarding de módulos sem duplicação da autoridade de vendas.
5. Provar acessos de todos os perfis, isolamento multiempresa, concorrência, falhas e periféricos emulados quando aplicável; executar testes Chromium responsivos e revisão independente de código.

**Não rotular R4 como integral** antes de concluir estes critérios e atualizar evidências canônicas com a execução da CI no SHA exato.

## UI web/PWA nesta rodada

A rota existente `FOOD` da PWA usa agora `apps/web/restaurant-web-ui.js` com guias Mesas, Pedidos, KDS, Chamados e Relatórios. Mantém os recursos exclusivos do desktop isolados; a migração do roteamento não muda o domínio desktop. Pedidos podem virar venda somente quando entregues e um fechamento de mesa com pedidos entregues exige o estado `COMPLETED` no único registro de vendas.

A mesma venda contém itens de pedidos operacionais congelados, `restaurant_sale_links` impede criação de duas vendas por comanda/pedido e `GET .../checkout` permite recuperar uma cobrança iniciada antes de uma falha. A cobrança ainda depende de caixa aberto no terminal (sem abrir caixa implicitamente). Estorno, split por participante, composição de pizza e balança exigem testes de integração/protocolo, concorrência e paridade antes de completar o código.

Novas rotas de recuperação:
- `GET /api/v1/tenants/:tenant/restaurant/sessions/:session/checkout?branchId=:branch`
- `GET /api/v1/tenants/:tenant/restaurant/orders/:order/checkout?branchId=:branch`

A `main` não recebe automaticamente um estado **coberto integralmente** por esta entrega. Revisão e testes continuam vinculados ao SHA da PR.

## PR #59 — matriz atualizada dos avanços

Os contratos novos ampliam o R4, mas não equivalem automaticamente à certificação integral desktop.

| Capacidade | Implementação nova | Validação ainda necessária |
| --- | --- | --- |
| cap-009 | Versões imutáveis de receita, consumo pelo estoque canônico, snapshot na venda | Comparação com receitas desktop |
| cap-031 | Transferência de mesa e de itens sem duplicar pedido | Concorrência multicaixa |
| cap-032 | Divisão igual, taxa de serviço explícita e recebimentos na venda única | Demais políticas de split desktop |
| cap-033 | Um único checkout com idempotência, estoque e caixa | Retornos e conciliação completa |
| cap-034 | Estações KDS, rotas por produto, nome da impressora | Contrato de impressão emulado, spool e reconexão simulada |
| cap-035 | Compartilhamento de KDS por pedidos/canais | Alteração de rotas após expedição |
| cap-036 | Pizza por tamanho, sabores, borda e preço servidor | Múltiplas configurações do mesmo SKU no caixa |
| cap-037 | Delivery, retirada, balcão, despacho/entregador | Estados e responsabilidades desktop |
| cap-038 | Pedidos e senhas diárias opcionais | Importação/histórico legado |
| cap-039 | Preço por grama/kg e pedido padaria pelo balcão | Contrato de balança e etiqueta simulados |
| cap-041 | Segmento escolhido, módulos recomendados separadamente | Fluxo de primeiro acesso |
| cap-048 | Chamado garçom/conta com estados e RBAC | QA completo UI e desktop |
| cap-049 | Resumo operacional por filial e CSV | Reconciliação com relatórios desktop |

**Ambiente obrigatório:** R$ 0, open source, SQLite local e self-hosted. D1/nuvem são opcionais; nenhum serviço pago é dependência.

**Sem declaração 13/13:** a paridade integral permanece pendente de evidência independente por capacidade e validação de dispositivos. A PR mantém as implementações existentes de atacado/R1 ao integrar a `main`.

## PR #62 — fechamento do fluxo de pizza e impressão local

- Pedidos de alimentação com **múltiplos itens e configurações distintas da mesma pizza/SKU**, preço registrado no snapshot imutável por linha configurada, mas **uma única venda, uma linha de produto agregada para estoque e caixa único**. Os filhos de `sale_configured_lines` preservam cada preço e sabor para recibos e devoluções.
- Reabertura/recuperação da venda mostra o valor das linhas configuradas, não o preço aproximado da linha agregada.
- Fila KDS de impressão persistente `0024_r4_print_outbox.sql`, inserida na mesma transação de pedido/tickets. Reserva temporária de 120 s, confirmação com token, até oito tentativas, reinício após queda e cancelamento da impressão pendente quando o pedido não chegou à produção.
- Agente local opcional: `scripts/r4-print-agent.mjs` (somente Node.js, sem npm adicional; `lp` no Linux/macOS ou `Out-Printer` no Windows).
- A PWA oferece escolha de segmento no primeiro login de quem pode editar configurações, editor de itens múltiplos e o estado das impressões. A escolha não habilita módulos nem autoriza pagamentos.
- Testes automáticos comprovam SQL local, Worker D1, concorrência de reservas de impressão, precificação de pizza e navegação Chromium; **não substituem prova física de papel, conectividade ou balança**.

### Operação da impressora self-hosted

1. Configure uma estação KDS com `printEnabled=true` e a identificação **exata** da fila instalada no sistema operacional; vincule produtos à estação.
2. Utilize um **operador de cozinha próprio**, com acesso `kitchen.view` e `kitchen.update_status`, em vez de credenciais administrativas.
3. No computador ligado à impressora, configure as variáveis de ambiente `PDV_PRINT_API_ORIGIN`, `PDV_PRINT_TENANT`, `PDV_PRINT_BRANCH`, `PDV_PRINT_EMAIL`, `PDV_PRINT_PASSWORD` e `PDV_PRINTER_ALLOWLIST` (filas separadas por vírgula). Mantenha a senha em um gerenciador de segredos local; nunca a envie para o Git ou para o histórico do terminal.
4. Execute `node scripts/r4-print-agent.mjs` para monitoramento ou `node scripts/r4-print-agent.mjs --once` para uma rodada. Só aceita HTTPS ou HTTP no próprio loopback. O processo envia o trabalho à fila nativa sem comandos de shell. Não há dependência externa/paga.

**Modelo de entrega:** pelo menos uma tentativa de impressão. Uma falha depois da fila local aceitar o ticket, mas antes da confirmação na API, pode produzir reimpressão; o UUID do job aparece em cada ticket para identificar repetições. `PRINTED` significa **aceito pelo spool local**, não que o papel saiu. A confirmação física exige homologação pelo operador.

### Checklist ainda bloqueado por evidência externa

- Impressoras reais Windows e CUPS, corte e papel, desligamento antes/depois do spool, retomada, tentativa dupla e filas compartilhadas.
- Balanças homologadas, leitura EAN/etiquetas, modelo/protocolo real e comparação de quantidades.
- Importação do histórico de pedidos do desktop somente se houver uma base anterior real; um sistema novo vazio não precisa de migração fictícia.
- Teste assistido em PC/tablet/celular e revisão funcional com a referência desktop dos modos restantes de rateio.

**R4 continua sem certificação de 13/13 integral** até fechar esses aceites; manter a matriz canônica honesta e não bloquear o uso dos fluxos já testados.

## PR #65 — tickets KDS são snapshots, não consultas às rotas atuais

A migração incremental `0025_r4_kds_ticket_snapshots.sql` cria `r4_station_ticket_items` imutável. Ao receber um pedido, a mesma transação persiste a estação, os itens, as quantidades, as configurações de pizza e o ticket. A fila consulta **somente essa fotografia**; alterações posteriores nas rotas não deslocam retrospectivamente o pedido para outra cozinha.

O upgrade recupera itens de tickets anteriores apenas quando a rota ainda permite identificar a estação. Quando essa atribuição histórica não é comprovável, deixa o ticket sem itens retrospectivos ao invés de inventar um destino; o registro original de pedidos e caixa permanece íntegro. Para instalações sem uso anterior não há dados legados a converter.

O gate exige dois pedidos reais do mesmo produto antes/depois de trocar o destino da estação, isolamento de filas e execução SQL/D1. Isso não prova impressora física ou balança, que continuam dependendo de aceites próprios.
