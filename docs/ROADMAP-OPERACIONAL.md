# Prontidão operacional do PDV Total

Atualizado em 22/10/2026. Este documento substitui a matriz de paridade como plano de trabalho. Não usa percentuais de funcionalidades herdadas como medida de prontidão.

## Estados e evidência

Cada jornada recebe um estado: não verificado, funciona, funciona com problema ou falha. Para registrar funciona, anotar ambiente, revisão Git, passos, resultado esperado/observado e evidência. Testes automatizados e homologação manual são evidências distintas.

A CI do commit 9577416 foi aprovada, incluindo navegador desktop/mobile. Isso é evidência histórica dos cenários daquela execução; as jornadas abaixo ainda precisam de revisão operacional própria.

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
