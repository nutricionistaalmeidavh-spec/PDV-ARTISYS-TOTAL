# E40–E47 — Catálogo avançado e módulos verticais

## Princípio arquitetural

E40–E47 ampliam o mesmo núcleo local-first do ArtiSys PDV. Nenhum módulo cria outro motor de venda, caixa, estoque ou banco de dados.

```text
Desktop / dispositivos LAN
          ↓ API local
Servidor local autoritativo
          ↓
Catálogo / módulos verticais
          ↓
SaleService canônico + EventBus/Outbox
          ↓
SQLite local / estoque / caixa / impressão não fiscal
```

- SQLite é autoritativo somente no servidor local.
- Clientes desktop/LAN não acessam SQLite diretamente.
- Internet não é necessária para a operação diária.
- Pagamentos dos novos fluxos são registros manuais; não há TEF, gateway ou API bancária embutida.
- Documentos operacionais/comerciais dos fluxos E40–E47 são **NÃO FISCAL**.
- A V1 não contém runtime de emissão fiscal; os módulos E40–E47 dependem somente do núcleo operacional e da impressão não fiscal.

## Schema

O schema operacional atual desses módulos é **v7**, aplicado por migrações aditivas e não destrutivas. Dados anteriores de vendas, restaurante e estoque são preservados.

## E40 — Catálogo configurável

O catálogo suporta grupos de opções, adicionais, variantes e grupos de combo. O preço final é calculado em centavos inteiros e a seleção usada na venda é salva como snapshot imutável no item.

## E41 — Ficha técnica

Produtos compostos podem ter receita/ficha técnica. Na conclusão da venda, o efeito de estoque expande o item em insumos e grava movimentos pelo mecanismo idempotente existente. Reprocessar o mesmo evento não duplica baixa de estoque.

## E42 — Módulos opcionais

A ativação é persistida em `app_settings`, auditada e validada pelo backend. Dependências são explícitas. Desativar um módulo não apaga histórico.

Módulos verticais implementados neste bloco:

- `RESTAURANT`
- `PIZZERIA`
- `DELIVERY`
- `FAST_FOOD`
- `MARKET_BAKERY`

A UI só oferece os workspaces ativados; campos de pizzaria, por exemplo, não aparecem para estabelecimentos que não usam esse módulo.

## E43 — Pizzaria

Suporta tamanho, limite de sabores, múltiplos sabores/meio a meio, borda, adicionais e políticas `HIGHEST_FLAVOR` e `PROPORTIONAL_AVERAGE`. A configuração acompanha o pedido até o KDS, pré-conta e venda canônica.

## E44 — Restaurante avançado

Amplia mesas/comandas existentes com divisão parcial por itens, taxa de serviço, transferência seletiva, junção de comandas e cancelamento autorizado com motivo. Cada parcela liquidada continua sendo venda criada pelo `SaleService`.

## E45 — Delivery

Suporta entrega ou retirada, snapshot de cliente/endereço, região, taxa, entregador, ETA manual, observação e forma de pagamento manual. Quando convertido em venda, reutiliza o `SaleService`; a taxa de entrega é registrada como item sistêmico sem estoque.

## E46 — Fast-food / Lanchonete

Mantém senha diária sequencial e fila `NEW → PREPARING → READY → DELIVERED`. O painel de prontos expõe somente número/status. Customizações e combos continuam usando E40.

## E47 — Mercado / Conveniência / Padaria

Venda por peso usa gramas como unidade base para cálculo monetário. Entrada manual é sempre possível; leitura de balança é opcional. Etiquetas de peso só são interpretadas quando existe perfil de formato explicitamente configurado — não há tentativa heurística de adivinhar layouts.

Encomendas de padaria mantêm cliente, horário solicitado, itens e ciclo `OPEN | READY | PICKED_UP | CANCELLED`.

## Contrato de etiqueta por peso

Cada perfil define explicitamente:

- prefixo;
- comprimento total;
- posição/comprimento do código do produto;
- posição/comprimento do campo de peso;
- casas decimais.

Um código que não corresponda ao perfil configurado deve ser rejeitado.

## Impressão não fiscal

Pré-conta, ticket de produção/cozinha e documentos operacionais permanecem não fiscais. Configurações de item relevantes à produção — como tamanho, frações de sabores, borda e adicionais — são preservadas no KDS e na impressão.

E40–E47 não chamam emissão NFC-e/NF-e/SAT/MFE/SEFAZ e não exigem provedor fiscal para funcionar.

## Delivery e retirada — operação orientada pelo KDS

Delivery e retirada compartilham uma única superfície operacional em **Alimentação → Entrega e retirada**. O pedido é o objeto reconhecível pelo operador; a implementação mantém responsabilidades separadas sem expor essa divisão como trabalho manual:

- os itens são persistidos no pedido antes de a venda canônica ser aberta;
- ao enviar para produção, itens `PRODUCTION` geram tickets por setor e itens `DIRECT` não criam ticket;
- `NEW → PREPARING → READY` é autoridade do KDS para pedidos com produção;
- o pedido permanece `PREPARING` enquanto qualquer setor ainda não estiver `READY`;
- retirada só libera `PICKED_UP` depois de `READY`;
- delivery só libera entregador / `OUT_FOR_DELIVERY → DELIVERED` depois de `READY`;
- a venda vinculada é aberta no **Balcão** pela mesma identidade de venda, sem reconstrução de itens;
- retirada `READY` mantém a ação local **Avisar no WhatsApp**, via `wa.me`, sem API paga.

Dispositivos `KITCHEN` podem ser vinculados a um ou mais setores de produção. Um dispositivo sem setores selecionados continua sendo um KDS geral por compatibilidade; com setores selecionados, `/mobile/context` projeta somente os tickets desses setores.

A superfície canônica e suas extensões usam `PdvUiLifecycle` / eventos semânticos. Delivery/retirada não dependem de `MutationObserver` para montagem ou sincronização.


## Arquitetura canônica de Balcão e Alimentação

A separação de telas representa responsabilidades, não domínios de venda concorrentes:

```text
Alimentação
├─ Mesas e comandas ─┐
├─ Entrega e retirada ├─> Pedido / produção canônicos ─> Balcão ─> SaleService
└─ Balcão e senhas ────────────────┘              └─> KDS por setor
```

- **Mesas e comandas** cuida do salão e das comandas.
- **Entrega e retirada** é um painel persistente de fulfillment.
- **KDS** é a fonte de verdade de `NEW → PREPARING → READY` para itens de produção.
- **Balcão** é o único checkout. Ele pesquisa Comandas, pedidos de Atacado, Delivery e Retirada e abre a venda canônica existente quando houver `saleId`.
- Delivery/Retirada não possuem motor de preço, desconto, estoque, pagamento ou pós-venda próprio.
- Enums técnicos continuam estáveis no domínio; rótulos expostos ao operador são localizados em português, por exemplo **Novo pedido**, **Preparando** e **Pedido pronto**.
- Campos de operação devem usar entidades reconhecíveis (produto, mesa, pessoa, setor). IDs técnicos podem existir em credenciais e APIs, mas não como dado a ser digitado para executar uma tarefa cotidiana.

## Fluxo operacional canônico de Alimentação

```text
Atendimento (Mesa / Balcão e senhas / Delivery / Retirada)
                              ↓
                       Pedido canônico
                              ↓
                  roteamento por item/setor
                    ↙        ↓        ↘
                Cozinha     Bar     outros KDS
                    ↘        ↓        ↙
                 PREPARING / READY agregados
                              ↓
                       Balcão canônico
                              ↓
                     SaleService / Caixa
```

O localizador do Balcão pesquisa **Comandas, Atacado, Delivery e Retirada**. Para Delivery/Retirada, o resultado referencia a venda já vinculada (`saleId`) e nunca recompõe itens, preço ou cliente.

Na apresentação ao usuário, estados operacionais usam português: **Novo pedido**, **Aguardando produção**, **Preparando**, **Pedido pronto**, **Saiu para entrega**, **Entregue** e **Retirado**. Os enums permanecem internos para compatibilidade de API e persistência.
