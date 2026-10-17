# Produtos + Clientes — cross-flow e regressão de release

## Objetivo

As Entregas 7 e 8 fecham a validação das adaptações de UX de **Produtos** e **Clientes** como um conjunto. A regra continua sendo a mesma das entregas anteriores: a UI nova não autoriza remover, simplificar ou substituir funcionalidades canônicas.

A partir deste nível, não basta cada tela funcionar isoladamente. O CI precisa provar que as duas continuam integradas aos fluxos reais do PDV e que uma evolução visual não quebra operações encadeadas.

## Entrega 7 — integração entre módulos

O fluxo `ux-products-clients-cross-flow` é executado pelo ArtiSys QA e cobre duas cadeias operacionais completas:

### Cliente → Venda → Histórico

1. cadastrar um cliente pela ficha canônica;
2. confirmar que a tela master-detail continua expondo o registro;
3. iniciar uma venda no Balcão;
4. localizar e selecionar o cliente pelo fluxo canônico de checkout;
5. concluir a venda;
6. retornar para Clientes;
7. abrir **Ver histórico** no painel lateral;
8. confirmar que a venda concluída aparece vinculada ao cliente por dados persistidos, não por estado inventado no frontend.

### Produto → Venda → Estoque → Relatórios

1. cadastrar um produto pelo formulário canônico;
2. lançar estoque pelo módulo operacional de Estoque;
3. confirmar o saldo anterior à venda;
4. vender o produto pelo Balcão;
5. confirmar a baixa real de estoque após a conclusão;
6. abrir Relatórios;
7. confirmar o produto no relatório por produto;
8. confirmar o cliente no relatório por cliente.

Esse fluxo usa os mesmos seletores, handlers, APIs e módulos que o operador utiliza. Não existe implementação paralela exclusiva para QA.

## Entrega 8 — gate de regressão completo

O perfil `release` deve executar **todos os flows registrados** em `qa/artisys-qa.config.json`. Além disso, todos os flows registrados precisam constar em `release.criticalFlows`.

Consequências:

- adicionar um flow novo sem incorporá-lo ao gate de release faz o teste falhar;
- retirar o cross-flow de Produtos + Clientes do release faz o teste falhar;
- transformar um fluxo registrado em não crítico no release faz o teste falhar;
- regressões em outras áreas do PDV continuam bloqueando a entrega destas telas, evitando validar UX em isolamento artificial.

O perfil `full` também executa o cross-flow e o classifica como crítico.

## Maturidade pareada

As duas telas avançam juntas para:

- `PRODUCTS_UX_LEVEL = 3`
- `CUSTOMERS_UX_LEVEL = 3`

E ambas precisam declarar os mesmos guardrails:

- `reversible`
- `progressiveEnhancement`
- `legacyHandlersPreserved`
- `parityGuarded`
- `crossFlowGuarded`
- `releaseRegressionGuarded`

O teste pareado continua comparando os dois objetos de garantias. Uma **evolução despareada** de Produtos ou Clientes deve falhar no CI.

## Critério de aceite

As Entregas 7 e 8 só podem ser consideradas concluídas quando:

1. o cross-flow executar de ponta a ponta;
2. `Cliente → Venda → Histórico` estiver comprovado;
3. `Produto → Venda → Estoque → Relatórios` estiver comprovado;
4. o saldo de estoque for persistido e validado antes/depois da venda;
5. o cliente e o produto aparecerem nos relatórios canônicos;
6. o perfil `release` cobrir todos os flows registrados como `criticalFlows`;
7. `PRODUCTS_UX_LEVEL` e `CUSTOMERS_UX_LEVEL` permanecerem iguais;
8. a suíte global do PDV permanecer verde.

Nenhum desses critérios autoriza retirar o renderer legado ou os contratos funcionais já protegidos pelas matrizes de paridade das Entregas 4 e 6.
