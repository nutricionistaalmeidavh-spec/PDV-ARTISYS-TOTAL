# P5 — continuação: consistência de relatórios e navegação

## Escopo implementado

- **Comparativos:** nova aba de relatórios com período atual, período anterior equivalente, vendas concluídas, receita líquida, devoluções e variações. Todos os números vêm da API canônica `GET /reports/compare`; não recalcular ledger nem duplicar saldos no browser.
- **Base de receita zerada:** percentual retorna “Sem base comparativa anterior”, nunca infinito ou crescimento inventado. Os valores de receita/vendas/devoluções são preservados como números no XLSX local.
- **Operação acessível:** navegação entre abas via setas esquerda/direita, Home e End, com foco restaurado após busca assíncrona e `aria-selected` coerente.
- **Datas comerciais:** a data padrão respeita o fuso horário da loja já configurado, evitando trocar o dia na virada UTC.
- **Respostas concorrentes:** numeração de geração impede que um pedido lento de relatório antigo sobrescreva um relatório mais novo ou dados de outra empresa/filial, mesmo quando o usuário troca de aba e retorna à tela.
- **CSV completo:** a API canônica recusa explicitamente um período acima de 3.000 vendas com HTTP 413. Anteriormente o `LIMIT 3000` truncava silenciosamente a exportação.
- **Regressão real:** CI executa SQLite com 3.000 e 3.001 vendas, isolamento de filiais/empresas, e Chromium para comparativos, foco do teclado e persistência de período entre rotas.

## Garantias arquiteturais

- Core e regras de negócio permanecem em `packages/core`; relatórios de API são leitura, sem gravações paralelas.
- Node + SQLite self-hosted funciona sem Cloudflare, pagamentos ou serviços pagos; nenhuma operação remota de banco ou deploy é exigida nesta alteração.
- Nenhum endpoint de autoria de estoque, vendas ou financeiro foi introduzido.
- Exportação XLSX local existente é reutilizada; não adicionar SDK pago, analytics externo ou renderer separado.

## Limites que impedem certificar 100% do P5

A nova aba melhora o contrato `reports-065` e a navegação melhora parte do `home-004`, mas os estados continuam **partial**, sem comparar exaustivamente toda a interface/relatórios com o desktop fixado. Também faltam CMV/custos equivalentes, políticas de mínimo configuráveis, layouts de exportação idênticos, metas/comissões completas, RBAC testado para todos os perfis, homologação física e revisão independente.

Não atualizar a matriz para `covered` nem divulgar 11/11 ou 4/4 com base apenas nesta entrega. Registrar aprovação do Actions no SHA exato e seguir a matriz para o fechamento.
