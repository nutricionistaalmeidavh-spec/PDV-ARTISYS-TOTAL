# QA por jornadas de usuário

Plano derivado da auditoria de 22/10/2026. Status inicial de todos os casos: **não executado nesta auditoria**. Não é uma nova matriz de capacidades; os IDs identificam tarefas reproduzíveis e evidências.

## Preparação única

Usar empresa QA isolada, filial A e B, dois terminais e contas separadas: OWNER, CASHIER, WAITER, KITCHEN, STOCKKEEPER, FINANCE e READ_ONLY. Não usar Burguerzão ou lançamentos reais como massa descartável. Sem envio real de e-mails ou cobrança externa. Testar convites/recuperação em transporte de e-mail de teste.

Massa proposta: produto simples R$ 10; produto preparado R$ 20 com ingrediente/receita e setor Cozinha; bebida R$ 5 com destino diferente; produto por KG R$ 40 (250 g = R$ 10); produto inativo; item sem estoque; dois clientes, um com limite de crediário configurado; mesas 1 e 2. Essas quantias são massa de teste, não regra comercial. Registrar se estoque negativo, taxa de serviço e entrega estão permitidos na configuração; não presumir valores.

Guardar snapshots de estoque, caixa, contas e situação das mesas antes de cada tarefa. Registrar a política esperada para quando ocorre o consumo por receita e para cancelamento após início do preparo antes de julgar o resultado.

## Roteiros executáveis

### QA-00 — Entrar e reconhecer o contexto (P0)

Pessoa: cada perfil; início: login sem sessão. Objetivo humano: “Comece seu trabalho na filial A”.

1. Entrar, verificar empresa/filial/perfil e ações disponíveis.
2. Sair e voltar; repetir com senha inválida, usuário suspenso e sessão revogada.
3. Tentar acesso direto a destino não autorizado.

Aceite: contexto inequívoco; erro útil sem exposição de conta; servidor rejeita acesso indevido; retorno ao login preserva somente dados não sensíveis apropriados. Capturar tela e resposta sanitizada. Não registrar senhas/tokens.

### QA-01 — Deixar produto pronto para vender (P0)

Pessoa: proprietário/estoque; início: loja vazia. Objetivo: “Prepare um prato e uma bebida para atendimento”.

1. Cadastrar categoria, produto, preço, unidade e disponibilidade; configurar receita e destino no cadastro apropriado.
2. Registrar entrada e reabrir cadastro; verificar opções no pedido.
3. Repetir com campo inválido, SKU repetido e usuário sem permissão de edição.

Aceite: identidade única, preço/unidade corretos, destino reutilizado no KDS; erro preserva dados; perfil de consulta não recebe ação enganosa. Evidência: cadastro reaberto, saldo e escolha no pedido.

### QA-02 — Abrir turno e fazer venda de balcão (P0)

Pessoa: caixa; início: caixa fechado. Objetivo: “Abra o turno e venda dois produtos de R$ 10 por R$ 20”.

1. Abrir caixa A com R$ 100; verificar que caixa B continua independente.
2. Lançar 2 unidades, receber R$ 50 em dinheiro, conferir troco R$ 30 e concluir.
3. Consultar histórico, caixa e estoque; tentar concluir novamente.
4. Repetir com caixa fechado, valor insuficiente, item inativo e estoque insuficiente conforme política configurada.

Aceite: uma venda de R$ 20, efeito líquido de R$ 20 no caixa e duas unidades consumidas; cupom/histórico recuperáveis; nenhuma conclusão aparente em erro. Falha mantém carrinho e permite recuperação sem duplicação.

### QA-03 — Atender mesa e encaminhar preparo (P0)

Pessoa: garçom; início: mesa livre. Objetivo: “Atenda a mesa 1 com um prato e uma bebida, com observação no prato”.

1. Localizar mesas, criar mesa se necessário, abrir comanda e lançar itens/observação.
2. Enviar pedido; navegar para outra tela e recuperar a comanda.
3. Tentar envio repetido e abrir a mesma mesa em outro terminal.

Aceite: uma sessão ativa e um pedido por intenção; itens, mesa, preços e observações preservados. Confirmar o estágio em que estoque muda segundo política definida. Registrar IDs técnicos só no relatório QA, não exigir que usuário os conheça.

### QA-04 — Produzir e devolver o andamento ao salão (P0)

Pessoa: cozinha e garçom; pré-condição: QA-03. Objetivo cozinha: “Prepare o pedido que pertence ao seu setor e avise que está pronto”.

1. Localizar fila/setor, assumir pedido, iniciar preparo e marcar pronto.
2. Conferir andamento no salão e registrar entrega quando permitido.
3. Duas cozinhas tentam assumir o mesmo ticket; setor sem acesso tenta vê-lo; simular rede lenta e falha no status.

Aceite: fila correta, observações legíveis, transições coerentes e sem dupla posse. Falha não anuncia pronto sem persistência; nova consulta mostra estado real. Se impressão estiver habilitada, distinguir fila/aceite do conector de papel efetivamente impresso.

### QA-05 — Alterar, transferir e receber antecipação (P0)

Pessoa: atendente e caixa; pré-condição: comanda com itens.

1. Acrescentar/remover item dentro das regras; transferir mesa 1 para mesa livre 2.
2. Outro terminal tenta transferência concorrente; tentar mesa ocupada.
3. Dividir itens/valores e registrar R$ 10 antecipados; repetir intenção após interrupção.
4. Testar WAITER com e sem autorização financeira definida pelo responsável (A01).

Aceite: quantidades e total conservados nas transferências; conflito visível; antecipação vinculada à comanda/pagador correto e registrada uma vez no caixa; saldo restante conferível. Falha preserva escolha válida e oferece atualização do estado atual. Não presumir que permissão de transferência autorize receber.

### QA-06 — Fechar conta e mesa (P0)

Pessoa: caixa; início: pedido entregue e caixa aberto. Objetivo: “Receba o restante desta conta e libere a mesa”.

1. Preparar cobrança; conferir itens, antecipações, divisão e saldo.
2. Receber em dinheiro/PIX/cartão registrados e também combinação de formas.
3. Concluir e consultar venda, comanda, caixa, estoque e contas; recarregar e repetir ação.
4. Tentar cobrar antes do estado permitido e com total insuficiente.

Aceite: uma venda canônica, nenhum débito duplo de estoque, antecipação não somada novamente, mesa liberada no momento correto. PIX/cartão registrados não devem ser confundidos com confirmação automática de adquirente. Conferir identidade e centavos na divisão.

### QA-07 — Corrigir venda e fechar turno (P0)

Pessoa: supervisor/caixa. Objetivo: “Corrija uma venda e explique o valor que deve haver no caixa”.

1. Fazer devolução parcial, depois tentar devolver a mesma quantidade novamente.
2. Cancelar outra venda autorizada; verificar estoque, reembolso, recebíveis e relatório.
3. Registrar suprimento e sangria; fechar com valor contado e verificar divergência.
4. Abrir novo turno e reconsultar histórico anterior.

Aceite: reversões únicas, motivo/operador recuperáveis, nenhum apagamento da venda original; valor esperado calculado da massa inicial e movimentos, não copiado do painel. Falha ou autorização negada não gera efeito parcial.

### QA-08 — Cliente contextual e crediário (P1)

Pessoa: caixa/financeiro/consulta. Objetivo: “Atenda um cliente ainda não cadastrado e depois confira sua dívida”.

1. Cadastrar no ponto de uso, salvar e continuar com cliente selecionado; cancelar modal sem perder atendimento.
2. Vender a prazo dentro do limite e tentar acima dele conforme regra vigente.
3. Receber parcela, consultar saldo e repetir a intenção.
4. Perfil READ_ONLY tenta consultar e cadastrar (A02).

Aceite: cadastro único, dívida e quitação coerentes, sem entrada em dinheiro na mera venda a prazo; recebimento em dinheiro vai ao terminal correto. Restrições aparecem antes de trabalho inútil e API permanece protegida.

### QA-09 — Retirada e entrega (P1)

Pessoa: atendente/expedição. Objetivo: “Registre, prepare e entregue uma encomenda, mantendo a cobrança rastreável”.

1. Pedido com cliente, modalidade e previsão; preparar no setor correto.
2. Liberar retirada ou despachar com responsável; registrar retorno e novo despacho quando aplicável.
3. Consultar cobrança, histórico e cancelamento em cada estado permitido.

Aceite: mesmo pedido ao longo do fluxo, sem nova venda a cada transição; devolução/retorno não vira entrega concluída. Dados do destinatário e endereço somente quando a modalidade exigir. Validar por perfil real de expedição.

### QA-10 — Financeiro, carteira e conciliação (P1)

Pessoa: financeiro. Objetivo: “Registre uma despesa, quite uma parte e concilie o movimento correspondente”.

1. Criar carteira (A03), lançamento e vencimento; dar baixa parcial e consultar saldo restante.
2. Pré-visualizar CSV/OFX sintético; confirmar importação e repetir o arquivo.
3. Conciliar com baixa existente; conferir que DRE não conta a despesa duas vezes.
4. Mudar filtros/página rapidamente, atrasando respostas em ordem inversa (A04).
5. Testar recorrência, pausa, transferência entre carteiras e estorno autorizado.

Aceite: original do arquivo ausente do armazenamento do servidor; fatos normalizados necessários presentes; duplicatas tratadas; seleção mais recente prevalece; pendência visível; erro preserva formulário/filtro. Contar registros antes/depois de clique repetido.

### QA-11 — Reposição e relatórios (P2)

Pessoa: estoque/compras e gerente. Objetivo: “Reponha o ingrediente e confira o resultado líquido do turno”.

1. Receber compra parcial, conferir lote/custo/unidade e saldo disponível.
2. Ajustar inventário com motivo; verificar autorização e filial.
3. Conferir vendas, devoluções, custo e caixa com o caderno de massa QA; exportar filtrado e paginado.

Aceite: quantidade/custo históricos consistentes, períodos/fuso e filtros visíveis, exportação completa no escopo escolhido. Custo desconhecido não pode parecer lucro comprovado. Comparar totais independentes, inclusive mais de uma página.

### QA-12 — Responsividade, desempenho e interrupção (transversal P0/P1)

Executar o caminho QA-03 → QA-06 em desktop Chrome, Safari iPhone real e PWA instalada. Usar telas de 390 px e menor dispositivo efetivamente suportado, orientação alternativa, zoom e teclado virtual. Em desktop testar teclado e foco; em iOS verificar VoiceOver e retorno do segundo plano.

1. Descobrir próxima ação sem instruções de botão; registrar desvios e pedidos de ajuda.
2. Voltar entre telas com carrinho/formulário, rolar até última ação e abrir teclado.
3. Repetir com conexão lenta, queda antes/depois de confirmar, resposta perdida e sessão expirada.
4. Conferir atualização de cache após edição, troca de usuário/filial e nova versão da PWA.

Aceite: ações alcançáveis, rótulos acessíveis, foco/estado reconhecíveis, nenhuma tela antiga substitui a atual; interrupção não anuncia sucesso falso nem reenvia venda automaticamente. Medir navegação até conteúdo utilizável (p50/p95, frio/quente, rede e dispositivo); definir orçamento após a linha de base, sem inventar tempos medidos.

## Evidência mínima e resultado

Por execução: revisão, ambiente/base isolada, data/fuso, perfil, terminal, dispositivo/browser, massa inicial, passos, expectativa independente, observado, estado persistido depois, screenshot sanitizado e log sem segredos. Estados: não executado, bloqueado, funciona, funciona com problema, falha. Separar resultado funcional de descoberta humana.

Modelo de registro:

```text
Caso/variante:
Revisão e ambiente:
Pessoa/perfil/dispositivo:
Pré-condições e massa:
Passos e resultado esperado:
Resultado observado e estado após reabrir:
UI / sequência / confiança e recuperação:
Evidência sanitizada:
Severidade, reprodução focalizada e próximo responsável:
```

Prioridade de defeito: bloqueador operacional/dados; alto impacto recorrente; dificuldade recuperável; acabamento. Nenhuma jornada é aprovada só por um toast, resposta 200, tela aberta ou screenshot. Para falha, primeiro reproduzir no menor caso; corrigir e repetir o caso afetado; executar a integração completa apenas quando as verificações focais passarem.

## Homologação com pessoas

Usar as tarefas de objetivo acima sem indicar caminho/controle. Registrar se a pessoa sabe onde está, reconhece a escolha, prevê consequência, age, confirma e continua. Observar erro, hesitação, necessidade de ajuda e confiança; não atribuir notas ou taxas sem sessões reais. Proprietário valida política de antecipação, estoque, serviço, cancelamento e permissões antes do aceite.
