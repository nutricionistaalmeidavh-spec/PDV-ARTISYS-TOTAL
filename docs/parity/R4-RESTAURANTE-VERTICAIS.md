# R4 — Restaurante, comandas, KDS e demais verticais

Data: 2026-10-18. Baseline desktop: `7efea9c61f75be1536a1e516e917218f2b8bf2bf`.

## Escopo canônico e prontidão de código (13 capacidades)

**Regra de fechamento R4:** validação exclusivamente por software: API, UI web/PWA, SQLite self-hosted, D1 local, testes de perfil/filial, concorrência, recuperação, protocolos simulados e comparação executável com a referência desktop. **Impressoras, balanças, leitores, tablets e terminais físicos não fazem parte do gate, do merge nem da classificação `covered`.** Uma inspeção de instalação em campo pode ocorrer posteriormente, em checklist opcional e separado.

As capacidades abaixo permanecem com os **estados da matriz canônica**, e não estados inferidos da existência de implementação. Na matriz auditada de 18/10/2026: **0/13 certificadas `covered`; 13/13 `partial` com referência ao subconjunto implementado/testado**. `partial` não significa ausência de código: a comparação integral com todos os comportamentos da origem ainda precisa ser demonstrada por software, sem teste físico.

| ID | Fluxo | Código existente / aceite que falta comprovar em software |
|---|---|---|
| cap-009 | Fichas técnicas e insumos | Versão de receita e baixa via estoque canônico; comparação executável com a referência desktop |
| cap-031 | Mesas, comandas, pedidos e transferência | API e interface, transferência e sessões; equivalência integral de transições e concorrência |
| cap-032 | Divisão, taxa de serviço e transferência de itens | Divisão igual, taxa explícita e transferência; regras restantes do desktop e conciliação |
| cap-033 | Checkout único restaurante | Venda, caixa e estoque canônicos, recuperação e idempotência; cenários de reversão e concorrência |
| cap-034 | KDS por estação e impressão | Rotas, tickets congelados, fila e agente local; falhas/reconexão e contrato de driver emulados |
| cap-035 | KDS compartilhado | Filas por estação/canal; comparação executável de mudanças de rotas e estados |
| cap-036 | Pizzaria | Tamanhos, sabores, bordas, preços absolutos ou acréscimos e múltiplas configurações por SKU; comparação desktop |
| cap-037 | Delivery, retirada e balcão | Fluxo de entrega, despacho/entregador, retirada e checkout; cobertura completa de estados |
| cap-038 | Pedidos e senhas | Pedidos unificados, senhas opcionais e histórico novo; legado **somente se houver dados reais a importar**, sem migração fictícia |
| cap-039 | Padaria e peso | Peso em gramas/kg e pedidos de balcão; precisão, identificação por etiqueta e protocolos simulados |
| cap-041 | Primeiro acesso e módulos | Escolha de segmento e sugestões sem habilitação automática; teste de persistência/autorizações |
| cap-048 | Chamados garçom/conta | Abertura, atendimento e fechamento por perfil; regressão por filial e estados |
| cap-049 | Relatório operacional e CSV | Contagens e valores separados do faturamento; comparação entre dados base, filtros e CSV |

**Situação objetiva:** o código desta rodada passou na CI de sua PR, mas isso **não** certifica 13/13 contra o desktop. Para concluir integralmente, faltam apenas evidências e/ou comportamentos de **software** apontados por capacidade; nenhum teste físico será solicitado como condição.

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

## Critérios restantes para R4 integral — sem testes físicos

1. Demonstrar todos os subfluxos por capacidade em cenários executáveis, incluindo UI, API, RBAC e isolamento de filial/empresa.
2. Comprovar preços, divisão/transferências, caixa, estoque, devolução, relatórios e receitas mediante comparação de valores com o desktop fixado.
3. Simular impressoras e balanças: renderização, protocolo, filas, reconexão, indisponibilidade, reenvio e eventos inválidos. Não exigir que um equipamento real esteja ligado.
4. Verificar estados concorrentes, mutação idempotente, retomada após interrupção e migrações SQLite/D1 em bancos temporários.
5. Publicar evidência rastreável por ID de capacidade e SHA de CI, com revisão independente de **código**, para promover de `gap`/`partial` a `covered`.

**Não há aceite físico, instalação em cliente, piloto nem migração de histórico inexistente nesta definição de pronto.**

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

**Sem declaração 13/13:** a paridade integral depende somente de evidência executável e auditoria de software por capacidade. A PR mantém as implementações existentes de atacado/R1 ao integrar a `main`.

## PR #62 — fechamento do fluxo de pizza e impressão local

- Pedidos de alimentação com **múltiplos itens e configurações distintas da mesma pizza/SKU**, preço registrado no snapshot imutável por linha configurada, mas **uma única venda, uma linha de produto agregada para estoque e caixa único**. Os filhos de `sale_configured_lines` preservam cada preço e sabor para recibos e devoluções.
- Reabertura/recuperação da venda mostra o valor das linhas configuradas, não o preço aproximado da linha agregada.
- Fila KDS de impressão persistente `0024_r4_print_outbox.sql`, inserida na mesma transação de pedido/tickets. Reserva temporária de 120 s, confirmação com token, até oito tentativas, reinício após queda e cancelamento da impressão pendente quando o pedido não chegou à produção.
- Agente local opcional: `scripts/r4-print-agent.mjs` (somente Node.js, sem npm adicional; `lp` no Linux/macOS ou `Out-Printer` no Windows).
- A PWA oferece escolha de segmento no primeiro login de quem pode editar configurações, editor de itens múltiplos e o estado das impressões. A escolha não habilita módulos nem autoriza pagamentos.
- Testes automáticos comprovam SQL local, Worker D1, concorrência de reservas de impressão, precificação de pizza e navegação Chromium; **não dependem de prova física de papel, conectividade ou balança para determinar prontidão de código**.

### Operação da impressora self-hosted

1. Configure uma estação KDS com `printEnabled=true` e a identificação **exata** da fila instalada no sistema operacional; vincule produtos à estação.
2. Utilize um **operador de cozinha próprio**, com acesso `kitchen.view` e `kitchen.update_status`, em vez de credenciais administrativas.
3. No computador ligado à impressora, configure as variáveis de ambiente `PDV_PRINT_API_ORIGIN`, `PDV_PRINT_TENANT`, `PDV_PRINT_BRANCH`, `PDV_PRINT_EMAIL`, `PDV_PRINT_PASSWORD` e `PDV_PRINTER_ALLOWLIST` (filas separadas por vírgula). Mantenha a senha em um gerenciador de segredos local; nunca a envie para o Git ou para o histórico do terminal.
4. Execute `node scripts/r4-print-agent.mjs` para monitoramento ou `node scripts/r4-print-agent.mjs --once` para uma rodada. Só aceita HTTPS ou HTTP no próprio loopback. O processo envia o trabalho à fila nativa sem comandos de shell. Não há dependência externa/paga.

**Modelo de entrega:** pelo menos uma tentativa de impressão. Uma falha depois da fila local aceitar o ticket, mas antes da confirmação na API, pode produzir reimpressão; o UUID do job aparece em cada ticket para identificar repetições. `PRINTED` significa **aceito pelo spool local**, não que o papel saiu. A verificação do papel em campo é opcional e não faz parte da aprovação do código.

### Checklist de código — único gate para prontidão

- **Impressão:** teste de contrato com spool emulado Windows/CUPS, lease, retry, cancelamento, reconexão e prevenção de pedido duplicado.
- **Pesagem:** teste de leitura/etiqueta simulada, conversão g/kg, arredondamento, preço, erro de dispositivo e idempotência.
- **Interface:** Chromium responsivo para desktop/tablet/celular, acessibilidade e perfis distintos — sem aparelhos reais.
- **Histórico:** dados criados em testes e comparação desktop; importação de histórico legado apenas se uma base real for fornecida, como tarefa separada e opcional.
- **Conciliação:** valores no único checkout/cash/stock ledger, sem duplicar autoridade financeira e com regressões reais por escopo de tenant.

**Inspeção em campo, se desejada:** observar papel, corte, cabo, calibração e modelo da balança. É uma atividade de instalação opcional, não um defeito de código, não altera os 13 estados e não bloqueia a entrega.

## PR #65 — tickets KDS são snapshots, não consultas às rotas atuais

A migração incremental `0026_r4_kds_ticket_snapshots.sql` cria `r4_station_ticket_items` imutável. Ao receber um pedido, a mesma transação persiste a estação, os itens, as quantidades, as configurações de pizza e o ticket. A fila consulta **somente essa fotografia**; alterações posteriores nas rotas não deslocam retrospectivamente o pedido para outra cozinha.

O upgrade recupera itens de tickets anteriores apenas quando a rota ainda permite identificar a estação. Quando essa atribuição histórica não é comprovável, deixa o ticket sem itens retrospectivos ao invés de inventar um destino; o registro original de pedidos e caixa permanece íntegro. Para instalações sem uso anterior não há dados legados a converter.

O gate exige dois pedidos reais do mesmo produto antes/depois de trocar o destino da estação, isolamento de filas e execução SQL/D1. A verificação em impressora ou balança real é opcional e não bloqueia o gate de código.
