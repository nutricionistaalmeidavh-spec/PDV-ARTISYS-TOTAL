# QA Multi-Device LAN

Este gate valida a operacao do ArtiSys com um unico servidor autoritativo e varios clientes simultaneos sobre HTTP local. Os desktops sao pareados como terminais LAN reais e o servidor roda com `requireTerminalAuth:true`. Ele nao depende de SaaS, internet, D1, R2 ou qualquer servico pago.

## Disparo

O workflow `.github/workflows/qa-multi-device-lan.yml` usa apenas `workflow_dispatch`.

Ele nao roda em `push`, `pull_request` ou `schedule`.

Depois de integrado na branch padrao:

1. abra **Actions**;
2. escolha **QA Multi-Device LAN**;
3. escolha o perfil;
4. execute **Run workflow**.

## Perfis

- `smoke`: propagacao de preco, baixa de estoque, corrida pela ultima unidade, idempotencia e invariantes finais.
- `full`: inclui dois caixas, um Electron de caixa remoto ligado ao mesmo servidor, isolamento de sessao, dois garcons concorrentes na mesma comanda, KDS, checkout no caixa, pagamento, baixa de estoque, totem, fronteiras de permissao e invariantes de banco.
- `stress`: executa o perfil completo, prova a topologia exata de 10 caixas + 15 garcons + 13 pedidos simultaneos, roda rampas de 100/250/500 pedidos concorrentes com metricas de latencia/throughput e repete 50 corridas concorrentes pela ultima unidade.

## Invariantes obrigatorios

- **price-propagation**: alteracao administrativa de preco precisa ser usada por uma nova venda no caixa.
- **cashier-ui-price-propagation**: um Electron remoto real deve mostrar o preco antigo no Balcao, receber a alteracao administrativa apos recarregar dados e mostrar/usar o novo preco no card e no carrinho.
- **sale-stock-decrement**: venda concluida precisa baixar o estoque exatamente uma vez.
- **last-unit-race**: com saldo 1 e dois caixas tentando concluir ao mesmo tempo, apenas uma venda pode concluir.
- **idempotent-completion**: reenvio com o mesmo `mutationId` nao pode duplicar pagamento, venda ou baixa.
- **cash-session-isolation**: cada venda deve permanecer vinculada a sessao do terminal correto.
- **restaurant-kds-flow**: dois garcons enviam pedidos concorrentes para a mesma comanda; ambos precisam chegar ao KDS, voltar como READY, passar pelo checkout do caixa, concluir pagamento, baixar estoque exatamente uma vez e liberar a mesa.
- **authorization-boundaries**: garcom nao pode operar rota de KDS e KDS nao pode criar pedido pela rota de garcom.
- **scale-10-cashiers-15-waiters-13-orders**: 10 caixas com sessoes independentes, 15 garcons autenticados e 13 pedidos enviados na mesma rajada devem concluir sem perda, duplicacao ou vazamento entre caixas; os 13 pedidos precisam ser persistidos e roteados ao KDS.
- **aggressive-order-ramp**: 100, 250 e 500 pedidos concorrentes devem drenar integralmente; o relatorio registra `p50`, `p95`, `max`, throughput, pedidos unicos, persistencia e tickets de KDS.
- **database-invariants**: `PRAGMA integrity_check` e `foreign_key_check` devem passar; nao pode haver estoque negativo, pagamento orfao, venda concluida sem pagamento/sessao de caixa ou efeito de dominio duplicado.

## Evidencias

Cada execucao grava em `qa-artifacts/multi-device`:

- `report.json`: resultado estruturado por cenario;
- `summary.md`: resumo usado tambem no GitHub Step Summary;
- `events.jsonl`: trilha de inicio, sucesso e falha de cada cenario;
- `final.sqlite`: banco final para auditoria pos-teste;
- `scale-10x15x13.json`: evidencia da topologia de 10 caixas, 15 garcons e 13 pedidos simultaneos;
- `load-metrics.json`: metricas das rampas de 100, 250 e 500 pedidos;
- `stress-evidence.json`: resumo estruturado dos cenarios pesados;
- `screenshots/cashier-price-before.png` e `cashier-price-after.png`: evidencia visual da propagacao de preco no caixa remoto quando o perfil inclui UI;
- `scale-10x15x13.json`: metricas e invariantes da topologia solicitada;
- `load-metrics.json`: resultados por nivel da rampa 100/250/500;
- `stress-evidence.json`: consolidado dos cenarios de stress.

O artifact e enviado mesmo quando algum cenario falha.

## Execucao local

```bash
npm run qa:multi-device -- --profile smoke --output qa-artifacts/multi-device
xvfb-run -a npm run qa:multi-device -- --profile full --output qa-artifacts/multi-device
xvfb-run -a npm run qa:multi-device -- --profile stress --output qa-artifacts/multi-device
```

O teste usa `127.0.0.1` para representar o transporte da LAN dentro do runner, mas os clientes desktop passam pelo mesmo pareamento e autenticacao de terminal usados na rede real. Isso valida contratos HTTP, concorrencia, persistencia, isolamento de terminal e efeitos de dominio. Firewall do Windows, roteador, perda fisica de Wi-Fi e hardware real continuam sendo validacoes de bancada.


## Referencia de desempenho observada

Na execucao de homologacao do perfil `stress` no GitHub Actions:

- topologia 10 caixas + 15 garcons + 13 pedidos: 25 operacoes na rajada, 25 sucesso, 0 falhas; 10 vendas concluidas nas 10 sessoes corretas; 13 pedidos persistidos e 13 tickets no KDS;
- 100 pedidos concorrentes: 100/100, p95 ~6,7 s;
- 250 pedidos concorrentes: 250/250, p95 ~16,5 s;
- 500 pedidos concorrentes: 500/500, p95 ~33,3 s e max ~35,1 s;
- throughput observado nas rampas: aproximadamente 14 pedidos/s.

Esses numeros sao uma referencia do runner hospedado, nao um SLA de hardware local. O gate funcional exige ausencia de perda/duplicacao; as metricas ficam no artifact para acompanhar regressao de desempenho.


## Interpretacao das metricas de stress

A rampa de 100/250/500 pedidos e um teste de capacidade extrema, nao um SLA de interface. O gate exige zero perda e consistencia de banco/KDS dentro do timeout do benchmark e registra a latencia observada para comparacao entre versoes. A topologia 10 caixas + 15 garcons + 13 pedidos simultaneos representa melhor a carga operacional solicitada e continua sendo uma assercao bloqueante separada.
