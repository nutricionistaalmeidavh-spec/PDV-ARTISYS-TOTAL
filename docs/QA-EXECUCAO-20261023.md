# Execução QA — 23/10/2026

Ambiente: Node/SQLite local isolado, mesma interface compilada, autenticação e entitlements habilitados; empresa Restaurante QA isolado, proprietário Auditoria QA. Não é homologação do Cloudflare/D1 hospedado ou Safari real. Nenhum dado da Burguerzão foi alterado.

## Acesso e licença

Provisionamento canônico em `apps/api/src/provision.mjs --local`. Assinatura TRIAL por 14 dias até 06/11/2026; tela Seu estabelecimento mostrou Operações liberadas. Credenciais aleatórias e banco somente em `apps/api/.local/` ignorado pelo Git, sem envio de e-mail ou criação de licença hospedada. Servidor somente loopback em porta 4193.

## Casos realizados no navegador

| Caso | Passos e resultado observado | Limites |
| --- | --- | --- |
| QA-00 parcial | Login proprietário; Início abriu; configuração identificou Restaurante QA isolado / Matriz; licença vigente e operações liberadas | Outros perfis, revogação e filial B pendentes |
| QA-01 parcial | Cadastro mestre → novo Produto simples QA, SKU QA-SIMPLES, R$ 10; recebimento 10 unidades; Cardápio → adicionar cadastro existente; preço R$ 10 e disponibilidade 10 | Receita, setor KDS, peso, validações e reabertura do editor pendentes |
| QA-02 parcial | Caixa → abertura R$ 100; Balcão → produto → quantidade 2 → pagamento padrão Dinheiro R$ 20 → concluir; comprovante da venda W-E896EFDE disponível; Caixa → esperado R$ 120, movimento Venda/Dinheiro R$ 20 | Não foi a variante de receber R$ 50/troco R$ 30; clique repetido, insuficiência, segundo terminal e impressão pendentes |

Verificação independente no SQLite após a UI: uma venda COMPLETED de 2000 centavos; um movimento CASH de 2000; estoque 8000 milésimos; ledger de entrada +10000 e venda -2000. Produto a 1000 centavos. O caminho nominal não duplicou os efeitos observados, mas isso não prova comportamento de retry.

Capturas locais: `qa-artifacts/auditoria-20261023/01-licenca-qa.jpg` e `02-caixa-120.jpg`. Contêm apenas a empresa sintética e não são versionadas.

## Observações novas

- Produto simples no Cardápio mostrou Opções de pizza e ações de estoque/reserva/transferência. Observação de UI confirmada; consequência de confusão é hipótese para teste humano. Recomendar ações contextuais por configuração do produto e separação entre comercialização e cadastro mestre; não retirar função sem conferir os usos.
- Caixa mostra UUID do operador e identificador técnico WEB do terminal. Observação confirmada; testar compreensão por caixa/gerente. Nome do operador e nome reconhecível do terminal devem ser priorizados, mantendo ID técnico em detalhe de auditoria.
- Ao abrir Cardápio vazio, o texto diz cadastrar primeiro produto, embora o cadastro mestre já existisse. A ação real é Adicionar ao Cardápio. Ajustar mensagem vazia ao contexto para evitar duplicação por interpretação; a tentativa de adicionar o existente funcionou.

Nenhuma falha crítica confirmada neste caminho. Esses achados ainda não foram corrigidos. Próximo recorte: QA-03/04/06 (mesa → pedido → KDS → cobrança), seguido de variantes por perfil. Ambiente local segue disponível para continuação; Safari/PWA e licença hospedada permanecem pendentes.
