# P3 — Caixas independentes por terminal (implementação incremental)

## Contrato

A migração **0013_cash_terminals.sql**, aplicada após `0012_sale_item_notes.sql`, acrescenta identificador de terminal às tabelas **canônicas** `cash_sessions` e `sales`, com valor `DEFAULT` para histórico legado. Substitui o índice único de sessão aberta por filial por índice único **empresa + filial + terminal com status OPEN**. Todas as transferências, pagamentos, vendas e reembolsos permanecem nas mesmas tabelas transacionais de antes.

O navegador gera um `WEB-<uuid>` persistido localmente, um por perfil/origem. Diferentes computadores/perfis ganham identificadores distintos; abas no mesmo perfil usam o mesmo caixa. O identificador não é token de autenticação nem substitui permissões de operador.

- A abertura de caixa aceita terminalId, usa idempotência distinta por terminal e somente bloqueia segunda sessão aberta **no mesmo terminal**.
- `GET /cash?terminalId=...` consulta exclusivamente aquela sessão; `GET /cash/sessions` permite filtrar por terminal e preserva a consulta completa para administradores. Busca paginada de caixa também admite terminalId.
- Uma venda aberta registra seu terminal de origem em `sales.terminal_id` e seu recebimento é lançado **naquela sessão aberta**, rejeitando finalizar no caixa errado/fechado.
- O reembolso em dinheiro recebe o terminal operacional explícito no navegador e exige saldo do caixa escolhido; o recibo mantém vínculo com o caixa original e com o terminal onde ocorreu a compensação. Não lança estorno silenciosamente em outra gaveta.
- O resumo do Início verifica **todos** os terminais abertos da filial, evitando indicar falsamente caixa fechado quando o terminal padrão não está aberto.

## Rollout e compatibilidade

Nenhum registro antigo é apagado. Um caixa legado aberto no terminal `DEFAULT` **continua aberto no histórico** após a migração; ele deve ser fechado em procedimento assistido antes de usar um novo identificador WEB, para que não existam duas contagens de dinheiro vinculadas indevidamente. Não renomear sessões antigas.

**Não rodar migração D1 remota automaticamente.** Antes do uso por clientes: backup/restore, homologar dois caixas com valores separados, queda de conexão, terminal sem localStorage, vários operadores no mesmo perfil, troca de máquina, devolução em outro terminal e reconciliação após fechamento. O `terminalId` é gerado pelo navegador e não possui vínculo criptográfico nem cadastro físico auditado de dispositivos; identidade forte do terminal é fase adicional.

Testes integrados em SQLite e D1 validam **dois caixas abertos na mesma filial**, venda em cada caixa, fechamento de apenas um, persistência de saldo independente, reembolso pelo segundo terminal, isolamento tenant e entradas inválidas.

**Estado da paridade**: `cash-046` passa de gap a parcial; homologação real de múltiplos terminais, impressão, gavetas e demais critérios do desktop permanece. Não implica 68/68 contratos cobertos.

Sem alteração no desktop original, credenciais, liberação comercial ou deploy remoto.
