# Prontidão operacional do PDV Total

Atualizado em 22/10/2026. Este documento substitui a matriz de paridade como plano de trabalho. Não usa percentuais de funcionalidades herdadas como medida de prontidão.

## Auditoria e plano vigente

- [Auditoria estrutural, evidências e achados A01–A04](AUDITORIA-OPERACIONAL-20261022.md).
- [Roteiros QA-00 a QA-12 por pessoa, objetivo e resultado](PLANO-QA-JORNADAS.md).
- [Execução local de 23/10: licença ativa, cadastro, recebimento e venda nominal](QA-EXECUCAO-20261023.md). QA-00/01/02 parcialmente exercitados; nenhuma jornada inteira promovida a homologada.

A inspeção inicial de produção ficou bloqueada por autenticação. Em 23/10 foi preparado ambiente local autenticado com licença TRIAL e iniciado QA visual; produção e Safari real continuam sem homologação nesta auditoria. Os achados de código indicam onde investigar, sem promover hipóteses a falhas de produção. Não há nota global de usabilidade.

## Entrega por etapas de aceite

| Etapa | Trabalho e responsável por função | Dependência | Critério de saída |
| --- | --- | --- | --- |
| 0 — Preparar QA | QA prepara empresa isolada, contas por perfil, dois terminais, massa e captura; proprietário confirma políticas | Acesso autenticado a ambiente de teste e e-mail de teste | QA-00 executável sem tocar em dados reais; regras de antecipação/estoque/cancelamento documentadas |
| 1 — Fechar uma operação realista | QA + atendente + cozinha + caixa executam QA-01 a QA-07 | Etapa 0 | Pedido do cadastro ao fechamento com evidência persistida; sem bloqueador de venda, perda ou duplicação de movimentos |
| 2 — Corrigir riscos encontrados | Desenvolvimento reproduz A01–A04; produto confirma responsabilidades; QA testa correções | Reproduções ou decisão de política registrada | Permissões coerentes, pendência/repetição seguras, filtros sem resposta obsoleta; regressões focais aprovadas |
| 3 — Homologar no dispositivo de uso | QA + usuários executam QA-12 nas jornadas principais | Caminho principal estável | Safari real e PWA utilizáveis com teclado, interrupção, retorno e cache; medidas de desempenho registradas |
| 4 — Completar retaguarda | Financeiro/estoque/expedição executam QA-08 a QA-11 | Venda e reversões consistentes | Dívida, entrega, conciliação e relatórios reconciliados com massa independente |
| 5 — Liberar piloto controlado | Proprietário/QA revisam evidências, limitações e recuperação | Etapas anteriores sem bloqueadores | Aceite explícito das jornadas por papel; plano de suporte/backup/recuperação e limitações conhecidas |

A01 (antecipação ligada a transferência) exige decisão de política antes de mudar acesso. A02 (cadastro oferecido a consulta) e A03 (envio de carteira sem bloqueio pendente) têm indicação direta de código. A04 (consultas de Bancos fora de ordem) exige reprodução controlada. Todos permanecem pendentes de validação/correção; esta entrega não altera o aplicativo.

Não fixar datas antes de preparar ambiente e executar a primeira jornada. A lista de correções deve nascer das evidências, ordenada por bloqueio operacional e integridade; não por quantidade de telas ou percentuais herdados.

## Estados e evidência

Cada jornada recebe um estado: não verificado, funciona, funciona com problema ou falha. Para registrar funciona, anotar ambiente, revisão Git, passos, resultado esperado/observado e evidência. Testes automatizados e homologação manual são evidências distintas.

A CI do commit 9577416 foi aprovada, incluindo navegador desktop/mobile. Isso é evidência histórica dos cenários daquela execução; as jornadas abaixo ainda precisam de revisão operacional própria.

## Atualização de QA hospedado — 23/10/2026

**Bloqueadores do complemento por perfil corrigidos e validados:** KITCHEN entra sem exigir leitura de catálogo; CASHIER recupera e recebe a comanda no Balcão sem ganhar gestão de restaurante. Novo corte por UI em réplica limpa passou: garçom → cozinha → entrega → caixa → mesa livre → fechamento com divergência zero. Cobertura permanente no gate de navegador e teste de autorização de documentos. Nenhum novo bloqueador no recorte; homologação por perfil em produção, Safari físico/PWA e evento real Asaas continuam pendentes.

Recuperação sintética em D1 privado aprovada: 122 tabelas, 47 registros, comparação integral, chaves estrangeiras sem violações e integridade `ok`. A primeira montagem de snapshot reprovou por disparar gatilhos durante carga; procedimento corrigido e repetido em destino vazio. Asaas permanece em produção, sem sandbox disponível: planos reais consultados e contratos locais passaram, mas evento real de pagamento não foi homologado.

Evidência: [QA hospedado](QA-PRODUCAO-20261023.md). Empresa/conta QA criada em produção com trial; preparação, balcão/troco/retry, mesa → KDS por estação → PIX registrado → fechamento, cancelamento/restituição, estoque e caixa reconciliados pela API e D1. Caixa terminou fechado com divergência zero. Isolamento da empresa real confirmado em consultas negadas.

Chromium e WebKit em 390×844 passaram em login/navegação nas quatro telas verificadas. Isso não fecha Safari físico/PWA, nem todos os fluxos por cliques ou por perfil. 26 testes focados locais de SaaS, cobrança e recuperação passaram; pagamento real e recuperação do D1 em destino separado continuam pendentes. Próximo corte: jornada completa por UI/perfil, interrupção, iPhone/PWA e integração comercial da central. A tabela abaixo continua sendo o escopo amplo; o relatório define precisamente as variantes já executadas.

## Ordem de execução

| Prioridade | Jornada | Resultado a conferir | Estado da auditoria operacional |
| --- | --- | --- | --- |
| P0 | Preparar loja | Produto, unidade, preço, estoque, ficha técnica e destino de produção consistentes | Não verificado |
| P0 | Atender mesa/comanda | Criar mesa, abrir, lançar, alterar, transferir e cancelar sem perder itens | Não verificado |
| P0 | Produzir no KDS | Pedido chega ao setor configurado; mudanças de estado e cancelamentos coerentes | Não verificado |
| P0 | Receber e concluir | Dinheiro, cartão, PIX, pagamentos divididos, troco e tentativa repetida sem duplicação | Não verificado |
| P0 | Conferir efeitos | Venda, estoque, caixa e financeiro refletem a mesma operação | Não verificado |
| P0 | Fechar turno | Abertura, suprimento, sangria, fechamento e divergência auditáveis | Não verificado |
| P1 | Cliente e crediário | Cadastro contextual, seleção, limite, recebimento e saldo coerentes | Não verificado |
| P1 | Pós-venda | Histórico, reimpressão, devolução e cancelamento com reversões consistentes | Não verificado |
| P1 | Gestão financeira | Despesa, vencimento, baixa parcial, recorrência, importação e conciliação sem duplicidade | Não verificado |
| P1 | Safari e PWA | Tela pequena, teclado, troca de páginas, cache atualizado, conexão lenta e recuperação de erro | Não verificado |
| P1 | Acesso e isolamento | Perfis, filiais, sessão revogada e empresa suspensa respeitam autorização | Não verificado |
| P2 | Relatórios e administração | Totais, filtros, paginação, exportações e configuração da loja | Não verificado |

## Regras de auditoria

Usar dados isolados para operações de teste. Não criar vendas ou movimentações fictícias na empresa real. Conferir o efeito persistido e os reflexos contábeis, além da resposta visual. Classificar problemas por impacto: impede operação, compromete dados, dificulta uso ou acabamento.

Corrigir e reproduzir uma falha em um teste focalizado antes de executar novamente a jornada integrada. Não iniciar ciclos de CI para testar hipóteses sem reprodução.

## Limpeza desta transição

Removidos: matrizes de 56 capacidades/68 contratos, geradores de percentuais, registros de certificação desktop, testes de consistência desses metadados e gates correspondentes da CI. Mantidos: testes funcionais, vetores de preço, fixtures de regressão, migrações existentes e código usado pelo produto. Arquivos históricos removidos permanecem recuperáveis no Git.
