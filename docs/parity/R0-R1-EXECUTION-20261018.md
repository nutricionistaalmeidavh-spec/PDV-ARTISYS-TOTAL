# R0 concluído como inventário rastreável; R1 execução incremental (18/10/2026)

> **Atualização posterior:** o R1 foi aceito em software em 21/21 IDs com testes automatizados auditáveis. Consulte [R1-SOFTWARE-ACCEPTANCE-20261018.md](./R1-SOFTWARE-ACCEPTANCE-20261018.md). Os números antigos de 10 parciais/11 gaps nesta página documentam etapas anteriores, não o status após o fechamento.

## Escopo e linha de base

Origem somente leitura: PDV-ARTISYS @ `7efea9c61f75be1536a1e516e917218f2b8bf2bf`. Destino exclusivo: `PDV-ARTISYS-TOTAL`. Nenhuma alteração de banco remoto, licenças, autenticação ou dados do desktop faz parte desta rodada.

**R0**: inventário único de 56 capacidades, contratos de teste subordinados, leitura de evidências no código, identificação de dependências bloqueadas e geração automática de laudo em JSON + Markdown. O script é `npm run audit:r0-r1`, com validação de IDs únicos e referências internas; a CI publica `r0-audit-56.json` e `r1-readiness-21.md`.

**R1**: são exatamente 21 capacidades entre as 56, **não** 21 novas telas ou reimplementações. Em `main`, antes deste incremento, 10 estão `partial` e 11 `gap` no inventário; nenhuma está formalmente `covered`. As 68 operações internas constam como 25 cobertas e 43 parciais. A origem tem 41 cenários P0 registrados. Não confundir cenário com aceite total.

### Onde já existe implementação e o que permanece pendente

| ID | Subdomínio do desktop | Evidência do estado atual | Bloqueio que impede afirmar cópia integral |
|---|---|---|---|
| cap-004 | Produtos, clientes e vendedores | Cadastro/API e políticas de perfil reutilizadas | Checkout cliente e vendedor/comissões são contratos parciais |
| cap-005 | Configurações, variações, combos | Catálogo aprofundado, escolhas configuradas e carrinho | Produtos-031 + checkout-017/019 parciais; percurso completo não homologado |
| cap-006 | Produto pai/filho e variantes | Serviços de variantes e lote presentes | produtos-031 ainda parcial |
| cap-007 | Kits com baixa de componentes | Ledger canônico e suíte P2 para kits | checkout-019 ainda parcial e prova desktop independente incompleta |
| cap-008 | Combos promocionais | Componentes de kits/combos presentes | Falta verificar todos os fluxos editáveis do desktop |
| cap-011 | Ledger de estoque/alertas | products-021 e products-027 cobertos | Capacidade completa, alertas e casos E2E sem certificação individual |
| cap-012 | Checkout/múltiplos meios manuais | checkout-008 coberto; regra de preço canônica | Comparação de toda a capacidade e exceções não concluída |
| cap-013 | Observações e impressão não fiscal | Observação de item e impressão via web/bridge | checkout-017/018 parciais; prova automatizada de driver/protocolo ainda pendente |
| cap-014 | Abrir, suprir, sangrar e fechar caixa | cash-040/041/042 cobertos | Revisão/certificação completa da capacidade, diferença de terminal e falhas não encerradas |
| cap-015 | Histórico, devolução e reversão | Serviço de devoluções e compensação transacional | history-037/038 parciais |
| cap-016 | Contas a pagar/receber | finance-047/048 cobertos | Paridade exaustiva de conta, quitação e autorizações sem certificado |
| cap-017 | Relatórios e CSV | reports-058/061 cobertos | Equivalência dos demais relatórios, exportações e escopos |
| cap-018 | Custos históricos e margem | Histórico de custo e relatórios P4 existem | reports-063 parcial; falta prova integral |
| cap-019 | Estoque/local/reserva/transferência | ledger, endereçamento e transferências existem | products-029 parcial; multi-local quantitativo não homologado |
| cap-020 | Compras, recebimento e custo médio | Pedidos e recebimentos parciais transacionais P2 | products-029 parcial; integração de caixa/contas completa |
| cap-021 | Pedidos, retirada e entrega | Serviços verticais/atacado e telas existentes | checkout-017 e products-029 parciais |
| cap-022 | Retomar pedidos/comandas sem redigitar | Abertura de vendas e vínculo com pedidos já existem | Fluxo completo entre segmentos + prova independente |
| cap-023 | Atacado e preços por quantidade | API e UI atacado existentes | checkout-011/012 parciais; provas de cliente/vendedor |
| cap-024 | Políticas atacado/crédito | Serviços de crédito com limite e política comercial | checkout-013 parcial, estorno e relatórios |
| cap-040 | Varejo/variantes/código de barras | Produto variante + leitor HID simulados | products-025/031 parciais; teste de contrato do leitor HID e estoque variável |
| cap-052 | Importação CSV/XLSX | Importação CSV com prévia, código XLSX web | products-032 parcial; paridade de importações e lotes grandes |

**Leitura correta:** presença dos módulos acima é inspeção estática e testes parciais do repositório; não é afirmação de que foram copiados integralmente. O relatório R0 automatizado contém os caminhos dos testes e contratos para cada item.

## Entrega funcional R1 desta rodada — retomada segura após reenvios

**Defeito:** a API anterior alterava o estado OPEN/SUSPENDED sem `mutation_id`. Um reenvio atrasado de `suspend` após `resume` podia suspender novamente a venda; reenvio de cancelamento de venda ainda aberta podia ser tratado indevidamente como reversão de uma venda já concluída.

**Correção:** suspensão, retomada e cancelamento de venda não concluída agora exigem ID de mutação gerado pelo cliente; gravam a transição no livro `commerce_mutations` em lote transacional com CAS de status. O reenvio com mesma chave devolve o estado autoritativo atual sem repetir a alteração. Um pedido novo em estado incompatível ainda recebe erro 409. O cancelamento originalmente aberto não é confundido com devolução/cancelamento de venda previamente concluída.

**Testes:** regressão SQLite com suspensão → retomada → replay tardio de suspensão; papel sem permissão, duas empresas, ausência de mutation ID, cancelamento duplicado e impossibilidade de retomar venda cancelada. A interface envia mutation ID em suspensão e retomada. **Não foi criada migração SQL**: a tabela existente de mutações é reaproveitada.

**Sem promoção artificial:** checkout-009 e capacidades R1 seguem parciais/pendentes até comprovação do desktop original, QA concorrente e revisão independente. O R1 **não está integralmente concluído** por este patch.

## Gates para encerrar R1 de verdade

1. Para cada ID listado, identificar todos os subfluxos desktop não cobertos; não repetir trabalho já executado.
2. Corrigir os bloqueios por domínio/segmento, comprovando UI → autorização → API → SQLite/D1 → estoque/caixa/financeiro, sem dados paralelos.
3. Executar casos nominal, autorização, isolamento de empresa e falha/recuperação no mesmo caso desktop fixado.
4. Em fluxos com hardware, usar dispositivos emulados e testes de falha/reconexão; testes físicos não fazem parte da conclusão de código.
5. Atualizar `desktop-capability-inventory.json` somente após gates de certificação; passar CI por si só não justifica mudança.

**Custo obrigatório:** R$ 0, open source, self-hosted (Node 22 + SQLite). Cloudflare Free é opção, serviços pagos nunca são dependência oculta.


### R1 adicional — proteção contra requisições antigas no carrinho

A mesma proteção foi aplicada a **alterar quantidade de item**, **remover item** e **alterar desconto**. Uma resposta atrasada ou repetição da mesma requisição não pode sobrescrever uma quantidade mais recente, restaurar um desconto antigo ou remover um item que já foi readicionado. O servidor exige uma chave por mutação e registra a mudança atômica na tabela `commerce_mutations`, somente se o CAS/update realmente afetou a linha; o frontend gera um ID para cada nova operação.

Os testes usam a API real e SQLite: alteração de 1→2→3 com repetição atrasada de 2; desconto de 100→300 centavos com replay de 100; remoção/reinclusão do produto com replay da remoção. Eles também verificam as entradas de deduplicação persistidas. Nenhum segundo estado de carrinho nem migration SQL foi criado.

**Limite:** replay de requisição com mesma chave está coberto, mas a certificação completa de todas as capacidades R1 continua exigindo os demais cenários do desktop, testes automatizados de dispositivo/conectividade onde pertinentes e revisão.


## Incremento R1 — importação XLSX confiável e identidade do lote (cap-052)

- **Falha comprovada:** o conversor local importava sempre `xl/worksheets/sheet1.xml`, que nem sempre representa a primeira aba lógica no Excel; uma planilha reordenada podia exibir/propor produtos incorretos.
- **Correção:** relacionamento do workbook define a primeira aba real; caminhos externos ou fora do ZIP de worksheets são recusados. Nada é carregado de URL externa e não há upload para serviço de terceiros.
- **Jornada verificada na suíte:** o Chromium abre um XLSX com `sheet2.xml` como primeira aba lógica, recusa `sheet1.xml` residual, executa prévia real com a API, confirma e persiste no catálogo autoritativo. Teste negativo recusa relação externa.
- **Importação idempotente:** SHA-256 do conteúdo/modo/empresa/filial fica no recibo da operação. Mesmo ID com outro arquivo gera 409, nunca sucesso falso; importações antigas permanecem reexecutáveis para preservar o resultado já aplicado. Teste SQLite assegura que o segundo produto não foi criado.
- **Escopo ainda parcial:** arquivo limitado a 100 produtos, XLSX de até 512 KiB e CSV de até 13.500 caracteres; a comparação exaustiva com todas as variantes do desktop ainda está aberta. Portanto `cap-052` permanece `gap` de paridade total, embora o fluxo descrito esteja implementado e testado.

**Não afirmar R1 completo:** as 21 capacidades dependem de revisão específica do comportamento original e de testes independentes; este incremento não certifica magicamente as outras 20. A CI do PR é regressão técnica, não homologação do desktop.


## Incremento R1 — política do cliente de atacado executável (cap-023/024)

A interface de atacado já apresentava um editor para política comercial, mas faltavam as rotas reais para buscar/salvar o pedido mínimo e os meios de pagamento permitidos. A UI ainda recebia envelopes de resposta incompatíveis com seus modelos, e a listagem dos pedidos omitira itens e identificação do cliente.

**Implementado no produto web único:**
- `GET/PUT wholesale/customers/:id/policy`: leitura/salvamento com RBAC, empresa/filial, operações idempotentes, pedido mínimo em centavos e métodos sem duplicação; limite e saldo de crédito permanecem nas tabelas canônicas de cliente/ledger.
- `wholesale/price` fornece subtotal estendido real; listagem das cotações traz cliente, itens/preços históricos e estados reais `QUOTE/CONFIRMED/FULFILLED`. A página adapta os envelopes da API sem criar estado duplicado; não exige endereço de estoque para simplesmente cotar.
- No checkout canônico, uma venda aberta a partir do atacado mantém o cliente da cotação e verifica a política no servidor **antes** de gravar estoque/caixa/crediário: pedido mínimo mesmo após desconto e todos os meios de pagamento de uma transação mista. Pedido cancelado não é cobrável; política não limita vendas normais de balcão.
- Teste API/SQLite autentica empresas A/B, recusa edição cruzada, rejeita mínimo, pagamento em dinheiro quando só PIX é permitido, desconto abaixo do mínimo, aceita PIX válido e reconcilia o pedido faturado. Teste Chromium usa o editor real, lista a cotação e confirma pelo navegador.

**Limites:** a política é conferida com os valores vigentes ao fechar a venda, não é um snapshot imutável da data da cotação. Ainda faltam a certificação integral do manifesto desktop, testes de todos os casos de credito/estorno e revisão dos demais dependentes R1. `cap-023/024` continuam `gap` na classificação estrita de paridade e **não podem ser marcadas como completas apenas por esses cenários**.

Sem migration, sem segundo caixa ou estoque, sem serviço pago obrigatório.

## Fechamento R1 incremental — seleção de cliente/vendedor com CAS e reenvio idempotente

Regressão reproduzível nos contratos `checkout-011` e `checkout-012`: a atribuição do cliente e do vendedor de uma venda aberta usava um UPDATE condicional sem recibo de mutação. Um reenvio atrasado da seleção anterior podia reverter o cliente e alterar o destinatário de comissões; a resposta HTTP 200 também podia mascarar mudança concorrente do estado da venda.

A correção exige ID de mutação por operação, mantém o vendedor na mesma empresa e ativo e conserva a vinculação imutável de cliente de uma cotação B2B. O `UPDATE sales` condicional e o recibo em `commerce_mutations` são executados no mesmo lote; apenas uma atualização aceita gera recibo. Um replay exato apenas lê o estado atual; reuso da chave com outro valor é conflito 409. Os testes SQLite usam duas trocas de cliente, duas de vendedor, repetição de mensagens em ordem inversa, papéis sem acesso e separação por empresa. O navegador gera IDs por cada troca sem mexer nos dados históricos.

**Prova de integração não é prova de todo R1**: o escopo de 21 capacidades requer os demais casos de desktop e contratos ainda parciais. Não houve migração ou armazenamento duplicado.

## R1 adicional — itens configurados e venda por peso no checkout canônico

**Capacidades impactadas**: cap-005/007/008/013/040, com contratos dependentes `checkout-017/019`.

O endpoint de remoção de peso antes chamava `removeItem()` sem o identificador de operação obrigatório e gerava 400; agora identifica a linha pesada, valida a unidade KG/G, grava DELETE e recibo na mesma transação e usa o ID histórico da linha. Reexecutar a exclusão não pode retirar uma nova pesagem do mesmo SKU. O saldo do estoque nunca é alterado enquanto a venda continua OPEN.

Alteração de quantidade e remoção de linhas configuradas compartilhando um mesmo produto-pai também recebem IDs de mutação, CAS do estado OPEN e de quantidade anterior, com atualização conjunta da quantidade do pai e recibo persistente. A transação impede que uma mensagem atrasada rebaixe quantidade, remova uma nova configuração ou deixe quantidade-pai diferente da soma das linhas. Há regressão SQLite com dois perfis de configuração do mesmo SKU, mudança 1→2→3, replay de 2, remoção, reinclusão e replay da exclusão; além de isolamento empresa/perfil.

**Importante:** esta melhoria é uma prova operacional específica, não uma declaração de todos os 21 itens cobertos. Sem migration nova, sem segunda tabela de produtos, sem teste físico como critério para saber se o código está pronto.
