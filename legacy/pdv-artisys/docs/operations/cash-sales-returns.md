# Caixa, vendas e devoluções

## Caixa

Abra o caixa antes das vendas, informando o fundo inicial. Suprimentos e sangrias são movimentos imutáveis. No fechamento, informe o valor contado; o sistema calcula esperado e divergência e preserva o histórico da sessão.

## Venda

Use **F2** para abrir o Balcão. Pesquise por nome/SKU/código de barras ou use leitor keyboard-wedge. Adicione/ajuste itens, selecione cliente, aplique desconto autorizado e escolha uma ou mais formas de pagamento. **F12** conclui a venda quando estoque, caixa e pagamentos são válidos. A conclusão é idempotente: reenvio da mesma mutação não cria uma segunda venda.

Na interface revisada em 21/09/2026, a reorganização visual não substitui o fluxo operacional existente. A própria busca, categorias, catálogo, vendedor/garçom, cliente, cabeçalho do carrinho e lista de itens são movidos para regiões mais claras usando os elementos DOM originais; IDs, listeners e regras não são recriados. Busca/catálogo permanecem à esquerda; vendedor e cliente ficam compactos no topo do painel direito; carrinho, total, pagamento, observação e F12 continuam na sequência operacional da venda.

As ações F1/F2/F3/F4/F6/F12, alteração de preço autorizada, limpar carrinho, desconto e vendas suspensas continuam com os mesmos efeitos operacionais. O botão F12 permanece diretamente no painel da venda para que a observação dinâmica continue sendo inserida imediatamente antes dele.

Em monitores com pouca altura, inclusive 1366×768, o painel direito possui rolagem interna própria. Nenhum controle é removido quando o conteúdo ultrapassa a altura disponível: vendedor, cliente, itens, total, formas de pagamento, observação e finalizar permanecem alcançáveis por rolagem dentro do painel. As linhas do carrinho usam uma coluna flexível para produto/preço e uma coluna própria para quantidade/total, evitando sobreposição quando o nome do produto é longo ou quando o botão **Alterar preço** está disponível.

A busca do Balcão, a busca da página **Produtos** e a busca da página **Clientes** preservam o próprio campo enquanto a digitação está em andamento. Isso evita recriar o input entre teclas e mantém a ordem enviada por leitores keyboard-wedge. Testes funcionais automatizados verificam as regras do domínio; os E2Es antigos de UI foram removidos e serão reconstruídos com base nos fluxos atuais.

Vendas podem ser suspensas e retomadas. Cancelamento de venda concluída exige permissão/motivo e gera os efeitos de reversão pelo EventBus/outbox, sem apagar o documento original.

## Devolução

Abra **Devolução (F11)**, pesquise uma venda concluída, carregue os detalhes, selecione itens/quantidades, informe o motivo e a forma de reembolso e confirme. A interface calcula o total selecionado e considera devoluções anteriores para mostrar somente a quantidade ainda disponível.

Sessões de **gerente ou administrador** podem concluir a devolução diretamente. Um operador de caixa pode concluir somente após informar credenciais válidas de gerente/admin; o servidor emite uma autorização de uso único vinculada ao contexto da devolução e preserva separadamente as identidades do operador e do autorizador na auditoria. Outros perfis sem permissão podem consultar a tela, mas não concluir a operação.

O servidor continua sendo a autoridade final de permissão, quantidade disponível, total e forma de reembolso. A autorização delegada não substitui essas validações nem permite devolver acima do saldo restante.

Devoluções parciais preservam a venda original e registram estoque/caixa como movimentos próprios e idempotentes. Depois de concluir, o histórico da própria venda é recarregado para exibir a devolução e impedir nova devolução acima da quantidade restante.

Os roteiros E2E antigos de UI, incluindo `desktop-regressions-e2e`, foram removidos. A próxima cobertura visual deverá ser criada do zero sobre o produto atual.
