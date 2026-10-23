# Auditoria estrutural de jornadas — 22/10/2026

## Escopo e evidência

Objetivo: definir jornadas reais de restaurante, roteiros de QA e prioridades do produto. Revisão de código `71fef2a`. Não é homologação operacional nem declaração de falhas reproduzidas em produção.

Métodos: Intuitive Software Design (AUDIT estrutural + User-Task Walkthrough) e Product Design (tentativa de captura do fluxo). O navegador disponível em `pdv.artisys.dev` mostrou a landing e, após **Entrar**, o modal de login com senha vazia. A inspeção visual interna parou nessa barreira. Não foram criados pedidos, vendas, clientes, pagamentos ou permissões em produção.

Captura local da barreira: `qa-artifacts/auditoria-20261022/01-login.png` (fora do Git; contém e-mail pessoal). Nenhuma captura antiga foi usada como comprovação atual. O Product Design exige capturar os passos reais: por isso sua auditoria visual interna está bloqueada, e o trabalho abaixo é explicitamente estrutural, sustentado pelos arquivos citados.

Confiança: alta para o comportamento escrito nos pontos citados; limitada para consequência operacional; insuficiente para usabilidade humana, Safari, acessibilidade e persistência real. A existência de testes é inventário de proteção, não execução nova nem prova de que uma pessoa descobre o caminho.

## Pessoas e trabalho

| Pessoa | Objetivo frequente | Conhecimento razoável | Continuação esperada |
| --- | --- | --- | --- |
| Proprietário/gerente | Deixar loja, equipe e cardápio prontos; acompanhar turno | Produtos, preços e responsabilidades da loja | Loja pronta e resultados conferíveis |
| Caixa | Cobrar e fechar turno sem diferença inexplicável | Formas de pagamento, troco, sangria | Venda recuperável, saldo e fechamento coerentes |
| Garçom/atendente | Registrar e acompanhar consumo da mesa | Número da mesa, itens, observações | Cozinha recebe; caixa consegue cobrar |
| Cozinha | Preparar a fila correta sem perder alterações | Setor e sequência de preparo | Pedido pronto e atendimento avisado |
| Expedição | Entregar ou liberar retirada | Pedido, destinatário e responsável | Entrega registrada e cobrança rastreável |
| Estoque/compras | Repor e conferir consumo | Unidade, fornecedor, quantidade e custo | Disponibilidade consistente |
| Financeiro | Dar baixa e conferir resultado | Contas, vencimentos e conciliação | Relatórios sem dupla contagem |
| Consulta | Encontrar informação sem mudar dados | Pergunta de negócio | Resultado legível e nenhuma mutação |

Perfis existentes: `packages/core/js/core/auth/default-profiles.js`. Os papéis acima não criam novas permissões. OWNER é tratado também em `apps/web/web-navigation.js`; deve ser testado separadamente do administrador padrão.

## Jornada principal e pontos de passagem

Preparar catálogo e produção → abrir turno → atender mesa ou balcão → encaminhar preparo → confirmar pronto/entregue → cobrar saldo correto → conferir venda/estoque/caixa → fechar turno → consultar resultado.

Cada passagem precisa manter identidade da empresa, filial, mesa/comanda, pedido e operador. O usuário não deve precisar decorar IDs ou saber uma rota de API para continuar.

| Etapa | Pista implementada a verificar | Resultado especificado | Situação atual |
| --- | --- | --- | --- |
| 1. Acessar loja | Entrar → e-mail/senha | Sessão válida e filial inequívoca | Modal observado; autenticação não executada |
| 2. Preparar operação | Cadastros, produtos/estoque, configurações | Produto vendável com unidade, preço e destino | Fonte inspecionada; execução NE |
| 3. Abrir caixa | Caixa | Sessão no terminal correto | Execução NE |
| 4. Atender | Alimentação → Mesas → + Mesa; pedidos | Uma comanda e pedido recuperáveis | Fonte inspecionada; execução NE |
| 5. Produzir | Alimentação → KDS | Somente setor autorizado; status chega ao salão | Fonte/testes identificados; execução NE |
| 6. Cobrar | Preparar cobrança e pagamentos | Saldo correto, uma venda, antecipações abatidas | Fonte/testes identificados; execução NE |
| 7. Encerrar | Fechar mesa/turno e consultar histórico | Sem consumo perdido nem efeito repetido | Execução NE |

## Achados rastreáveis

### A01 — Recebimento parcial está vinculado à permissão de transferência

- Evidência: `apps/web/restaurant-web-ui.js:98`, `apps/api/src/vertical-router.mjs:169`; `WAITER` recebe `restaurant.orders.transfer` em `default-profiles.js`. O catálogo descreve essa permissão como transferência de pedidos/mesas, não recebimento.
- Observação: a mesma capacidade controla duas responsabilidades diferentes. Não foi demonstrado recebimento indevido em runtime; caixa aberto e demais validações continuam relevantes.
- Área: Flow/controle; fricção: interpretação e processo; estágio: Predict. Severidade potencial alta; pontuação NE.
- Decisão necessária: garçom pode registrar antecipação ou somente solicitar cobrança? Validar com o responsável antes de alterar política.
- Correção mínima proposta: separar autorização de receber da autorização de transferir, mantendo o fluxo já permitido pela regra confirmada. Exibir restrição antes de preencher; impedir repetição pendente; confirmação recuperável com valor, mesa e operador. Falha deve preservar preenchimento sem alegar recebimento.
- Validação: QA-05 com WAITER, CASHIER e OWNER; verificar também a rejeição pela API. Tarefa humana: “Uma pessoa desta mesa quer pagar sua parte antes de ir embora”.

### A02 — Crediário oferece cadastro para quem pode apenas consultar clientes

- Evidência: `apps/web/web-parity-ui.js:116–122` sempre renderiza e registra **+ Cliente**. `apps/web/web-navigation.js` permite `credit` com `customers.view`; `READ_ONLY` tem consulta sem `customers.manage`.
- Consequência inferida: o usuário pode preencher um cadastro para só descobrir a restrição no envio. Não é evidência de bypass de autorização.
- Área: UI/Flow; fricção: decisão e recuperação; estágio: Predict/Act. Severidade média; pontuação NE.
- Correção mínima proposta: condicionar a ação à permissão canônica, ou explicar a restrição antes de editar. Não criar um segundo cadastro. Em erro permitido, manter dados válidos; ao salvar, selecionar o cliente e confirmar nome/objeto persistido.
- Validação: QA-08 com consulta e caixa; tarefa humana: “Este cliente ainda não existe e você precisa continuar o atendimento”.

### A03 — Cadastro de carteira não bloqueia envio enquanto aguarda

- Evidência: `apps/web/advanced-finance-web.js:198–200` envia POST sem desabilitar botão ou guarda de pendência; outras ações do mesmo arquivo desabilitam seus botões.
- Consequência inferida: repetição da intenção ou ausência de confiança durante rede lenta. Duplicação persistida não foi demonstrada; não presumir que idempotência resolva cliques com chaves diferentes.
- Área: Feel; fricção: feedback/recuperação; estágio: Confirm. Severidade média; pontuação NE.
- Correção mínima proposta: pendência única por formulário, feedback acessível, confirmação identificável; falha restaura envio e preserva dados. Resultado incerto exige consultar estado antes de repetir mutação.
- Validação: QA-10 com resposta lenta, clique repetido e interrupção; contar carteiras persistidas. Tarefa humana: “Cadastre uma carteira e confirme que ela foi criada”.

### A04 — Consultas concorrentes de Bancos só verificam a rota

- Evidência: `apps/web/advanced-finance-web.js:76–90` inicia sete consultas e só compara `activeRoute` antes de substituir conteúdo; filtros e paginação chamam `renderBanks` novamente. Não há identificador da geração de consulta nesse trecho.
- Consequência inferida: resposta antiga de filtro/página pode substituir a mais recente quando ambas estão em Bancos. Ainda não reproduzido.
- Área: Feel; fricção: feedback e memória; estágio: Confirm/Continue. Severidade potencial alta se a pessoa agir sobre seleção equivocada; pontuação NE.
- Correção mínima proposta, caso reproduzido: aceitar apenas a consulta mais recente; manter filtros visíveis e associar resultado à seleção atual. Falha preserva filtros e permite tentar novamente sem substituir por dados antigos.
- Validação: QA-10 com duas buscas e respostas invertidas; conferir cabeçalho/filtro/linhas e ação de conciliação coerentes.

## Aspectos a preservar

- Navegação possui relação explícita entre hubs e destinos, com permissão por rota (`web-navigation.js`). Não prova descoberta humana.
- Há cadastro contextual de cliente e ação explícita **+ Mesa** no código.
- Importação bancária informa que arquivo permanece no aparelho e usa paginação; confirmar a regra de retenção e os resultados no QA.
- Testes existentes cobrem isolamento, idempotência, antecipação, divisão e reversões em `apps/api/test/vertical-parity.test.mjs`, `r4-saas-rules.test.mjs`, `commerce.test.mjs` e `scripts/web-browser-e2e.mjs`. Nenhuma suíte foi executada nesta auditoria documental.

## Avaliação e limites

UI Clarity: NE. Flow Intuition: NE. Behavior Confidence: NE. Overall: NE. A cobertura visual interna e os estados de erro não foram observados; não há base para percentuais ou notas globais.

Loop interno: Orient/Recognize/Predict/Act/Confirm/Continue = NE em runtime. O walkthrough acima especifica o que deve ser observado, sem conceder ao usuário conhecimento adquirido por leitura de código.

Falhas críticas operacionais: nenhuma confirmada por esta inspeção. A01 e A04 são riscos prioritários a validar, não incidentes comprovados. Não foi avaliado contraste, leitor de tela, teclado interno, zoom, Safari real ou continuidade entre dispositivos. As verificações de acessibilidade e recuperação estão no plano de QA.

## Próxima ação

Executar QA-00 a QA-07 em ambiente isolado com dois operadores e dois terminais; registrar estado antes/depois e tornar os achados reproduzidos itens de correção. Fazer sessões humanas com objetivos sem instruir o nome do botão. Só depois ampliar para gestão. Ver `PLANO-QA-JORNADAS.md` e `ROADMAP-OPERACIONAL.md`.
