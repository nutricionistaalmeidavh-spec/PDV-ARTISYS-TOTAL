# R0 concluído como inventário rastreável; R1 execução incremental (18/10/2026)

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
| cap-013 | Observações e impressão não fiscal | Observação de item e impressão via web/bridge | checkout-017/018 parciais; equipamento físico não homologado |
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
| cap-040 | Varejo/variantes/código de barras | Produto variante + leitor HID simulados | products-025/031 parciais; leitor físico/estoque variável |
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
4. Evidência física apenas quando o comportamento envolve equipamento real; evidências estáticas não promovem `gap` a `covered`.
5. Atualizar `desktop-capability-inventory.json` somente após gates de certificação; passar CI por si só não justifica mudança.

**Custo obrigatório:** R$ 0, open source, self-hosted (Node 22 + SQLite). Cloudflare Free é opção, serviços pagos nunca são dependência oculta.


### R1 adicional — proteção contra requisições antigas no carrinho

A mesma proteção foi aplicada a **alterar quantidade de item**, **remover item** e **alterar desconto**. Uma resposta atrasada ou repetição da mesma requisição não pode sobrescrever uma quantidade mais recente, restaurar um desconto antigo ou remover um item que já foi readicionado. O servidor exige uma chave por mutação e registra a mudança atômica na tabela `commerce_mutations`, somente se o CAS/update realmente afetou a linha; o frontend gera um ID para cada nova operação.

Os testes usam a API real e SQLite: alteração de 1→2→3 com repetição atrasada de 2; desconto de 100→300 centavos com replay de 100; remoção/reinclusão do produto com replay da remoção. Eles também verificam as entradas de deduplicação persistidas. Nenhum segundo estado de carrinho nem migration SQL foi criado.

**Limite:** replay de requisição com mesma chave está coberto, mas a certificação completa de todas as capacidades R1 continua exigindo os demais cenários do desktop, testes de dispositivo/conectividade onde pertinentes e revisão.
