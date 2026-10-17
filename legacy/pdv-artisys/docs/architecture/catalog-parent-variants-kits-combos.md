# Catálogo — produto pai, variações, kits e combos promocionais

Este documento descreve o estado atual do catálogo comum do ArtiSys PDV. Esses recursos fazem parte do núcleo do catálogo e não dependem da ativação do módulo opcional `RETAIL`.

## Produto pai e subitens/variações

Um produto pode atuar como item pai para variações vendáveis independentes. Exemplos:

- Tang → Uva, Limão, Laranja;
- Coca-Cola → 350 ml, 600 ml, 2 L;
- Camiseta → P, M, G e combinações de cor/tamanho.

Cada variação pode ter nome, SKU, código de barras, preço final, custo, atributos e saldo próprios. A venda grava um snapshot imutável da variação escolhida, preservando histórico mesmo se o cadastro for alterado ou desativado depois.

### Invariantes de estoque

- o produto pai não controla estoque quando usa estoque por variação;
- cada variação mantém saldo próprio;
- um produto pai com saldo normal existente deve ter esse saldo zerado/distribuído antes da criação da primeira variação;
- um produto com variações ativas não pode ser vendido diretamente como item pai;
- conclusão da venda valida novamente o saldo agregado das variações;
- cancelamento, devolução e cancelamento da devolução restauram/movimentam a variação registrada no snapshot da venda.

O módulo opcional `RETAIL` pode ampliar fluxos específicos de varejo, mas não é requisito para produto pai/subitens no catálogo comum.

## Kits

Kit é um produto composto vendido como uma única linha comercial, com composição definida pelo usuário.

Exemplo: `Kit Limpeza` → 1 detergente + 2 esponjas + 1 pano.

Regras principais:

- preço, custo, nome, SKU/código e composição são definidos pelo usuário;
- por padrão o kit não cria estoque físico paralelo;
- a disponibilidade depende dos componentes reais;
- a venda salva snapshot da composição vigente naquele momento;
- cancelamento e devolução usam a composição histórica da venda, não uma composição editada posteriormente;
- composição recursiva/kit dentro de kit é bloqueada para evitar ciclos e ambiguidade de estoque.

## Combos promocionais

Combo promocional é uma regra de preço aplicada aos produtos existentes, configurada pelo usuário.

Exemplo: produto a R$ 3,99 por unidade; levando 3, total R$ 10,00.

A regra pode definir quantidade exigida, preço do grupo, produtos participantes, modo mesmo-produto ou mistura de selecionados, validade, limite por venda, estado ativo/inativo e política de acúmulo com desconto manual.

A aplicação é automática no carrinho. O desconto promocional fica separado do desconto manual para auditoria, cupom e histórico. Quantidades excedentes permanecem no preço normal, salvo outra regra aplicável.

## Venda, histórico e snapshots

Produto normal, variação, kit e combo continuam usando o mesmo motor canônico de vendas. Não existe um segundo caixa ou segundo ledger.

Snapshots preservam o que foi efetivamente vendido para que mudanças posteriores no cadastro não alterem:

- identificação da variação;
- composição do kit;
- explicação da promoção aplicada;
- reversões de estoque;
- reimpressões e histórico.

## Compatibilidade

Cadastros existentes sem variações, kits ou combos continuam funcionando sem migração manual. Produtos comuns mantêm comportamento anterior. Os recursos novos são opt-in por cadastro e não alteram automaticamente produtos existentes.
