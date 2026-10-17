# Política de evolução pareada — Produtos e Clientes

## Objetivo

As adaptações de UX de **Produtos** e **Clientes** pertencem ao mesmo ciclo. Uma tela não deve avançar para uma arquitetura mais profunda enquanto a outra permanece em um estágio anterior de proteção contra regressão.

## Nível de maturidade

Cada módulo exporta seu nível local:

- `PRODUCTS_UX_LEVEL`
- `CUSTOMERS_UX_LEVEL`

Os dois devem permanecer com o **mesmo valor**. Após as Entregas 7 e 8, ambos estão no nível **3**, que acrescenta validação cross-flow e regressão completa de release ao nível de paridade/reversibilidade anterior.

O nível representa maturidade da adaptação, não quantidade de funcionalidades de negócio. As telas têm domínios diferentes, mas precisam manter a mesma profundidade de implementação e proteção.

**O número sozinho não comprova maturidade.** O arquivo `docs/architecture/ux-products-clients-evidence.json` é o segundo contrato obrigatório e precisa manter Produtos e Clientes com a mesma matriz de evidências executáveis.

## Regra para alteração estrutural

Qualquer **alteração estrutural** relevante em uma das duas telas — nova arquitetura de listagem, novo padrão de detalhe, substituição de handlers, mudança do mecanismo de fallback, retirada de Legacy ou avanço de paridade — deve:

1. elevar o `*_UX_LEVEL` da tela alterada quando houver avanço de maturidade;
2. implementar adaptação equivalente na outra tela;
3. elevar o nível da outra tela para o mesmo valor;
4. atualizar as duas matrizes de paridade quando aplicável;
5. manter testes de regressão específicos nas duas telas;
6. manter os fluxos encadeados entre cadastro, venda, estoque, histórico e relatórios verdes;
7. atualizar a matriz de evidências das duas telas de forma simétrica;
8. produzir novamente evidência de fallback e responsividade no mesmo SHA de release.

Se apenas um nível for elevado, ou se a matriz de evidências ficar assimétrica, o **CI deve falhar**.

## Guardas obrigatórias nas duas telas

Produtos e Clientes devem declarar as mesmas garantias estruturais:

- `reversible: true`;
- `progressiveEnhancement: true`;
- `legacyHandlersPreserved: true`;
- `parityGuarded: true`;
- `crossFlowGuarded: true`;
- `releaseRegressionGuarded: true`.

O teste `paired-ux-evolution-guard.test.js` compara diretamente níveis, guards e `ux-products-clients-evidence.json`. O teste `ux-products-clients-release-regression.test.js` exige ainda o cross-flow e o gate completo de release.

## Evidências mínimas pareadas

A matriz deve manter `true` para as duas telas em:

- feature flag;
- fallback E2E ON/OFF;
- matriz de paridade;
- integração do controller;
- E2E profundo da superfície funcional;
- cross-flow real entre módulos;
- evidência responsiva;
- execução no gate de release.

A evidência responsiva é executada em `desktop`, `tablet` e `mobile/narrow`. O objetivo é impedir que ações canônicas desapareçam por largura enquanto a camada nova continua tecnicamente montada.

## O que significa evolução pareada

Evolução pareada não significa copiar recursos de Produtos para Clientes ou vice-versa. Significa que, quando uma tela recebe uma melhoria de UX, a outra deve manter o mesmo padrão de segurança arquitetural:

- feature flag reversível;
- renderer Legacy preservado;
- melhoria progressiva sobre DOM/handlers existentes;
- matriz de paridade;
- testes de integração/paridade;
- teste de idempotência de observers;
- fallback sem perda funcional;
- cross-flow real entre módulos;
- cobertura obrigatória no perfil de release;
- evidência responsiva em múltiplos viewports.

## Exceções

Correções estritamente locais de bug, acessibilidade ou estilo que não mudem o contrato estrutural não exigem aumento de nível. Mudanças que alterem fluxo, organização funcional, fonte de dados, fallback ou responsabilidade entre Legacy e nova UX exigem.


## Estado P2 canônico — 2026-10-02

Produtos e Clientes avançaram juntos para UX level 4. A arquitetura reversível por feature flag foi encerrada: ambos usam renderer funcional canônico, apresentação lifecycle-owned e não mantêm fallback Legacy. Alterações futuras continuam obrigadas a elevar `PRODUCTS_UX_LEVEL` e `CUSTOMERS_UX_LEVEL` em conjunto quando forem estruturais.
