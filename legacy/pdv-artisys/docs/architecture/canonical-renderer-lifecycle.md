# Renderer canônico e lifecycle semântico

## Estado atual

O renderer desktop do ArtiSys usa ownership explícito por rota e eventos semânticos apenas onde há dependência transversal real.

- cada rota registrada em `PdvRouteRegistry` possui um único owner;
- o owner da rota compõe diretamente seus componentes de superfície;
- `PdvUiLifecycle` publica `route:before`, `route:mounted`, `route:updated` e `route:unmounted` para consumidores transversais;
- superfícies internas que não são rotas podem publicar `surface:mounted` com identificador estável;
- o renderer de produção possui orçamento de `MutationObserver` igual a **zero**;
- nenhum componente descobre ownership observando mudanças arbitrárias de DOM.

## Home

A Home é renderizada diretamente pelo owner `app`. A apresentação usa `PdvHomeRoleModel` para derivar os atalhos permitidos e chama `PdvAppNavigation.navigate()` diretamente. Não existe uma Home base escondida servindo de ponte para controles da Home apresentada.

`classic-home-ui.js` mantém apenas comportamento de shell da Home, como estado visual da marca e navegação do botão de início.

## Extensões operacionais

As antigas camadas de parity foram aposentadas. As capacidades preservadas estão em componentes semânticos:

- `operational-route-extensions.js` contém complementos de Estoque, Logística, Devoluções e Financeiro;
- `operational-detail-extensions.js` contém recebimento parcial, atendimento parcial, detalhes de devolução e operações complementares de Configurações.

Esses componentes **não registram observers nem listeners globais de rota**. Seus owners chamam explicitamente os mounts apropriados:

- `operational-pages.js` compõe Estoque, Financeiro e Configurações;
- `returns-ui.js` compõe os complementos de Devoluções;
- `enterprise-depth-ui.js` compõe os complementos de Compras, Logística e Pedidos.

O cardápio público do restaurante segue a mesma regra: `restaurant-ui.js` chama explicitamente `PdvRestaurantPublicOrderingUi.mount()` após renderizar a superfície.

## Bridges aposentadas

Foram removidos:

- `backend-parity-ui.js`;
- `ui-parity-p0-p2.js`;
- `reporting-v2-legacy-export.js`;
- o monkey-patch de `toastRoot.appendChild`.

A exportação detalhada do overview de Relatórios pertence ao próprio `reporting-v2.js`. Novas notificações devem usar `PdvToast.show()`.

## Gate

Os testes estruturais varrem todos os JavaScript em `desktop/renderer` e exigem zero ocorrências de `new MutationObserver`. O gate também confirma que as bridges aposentadas não voltaram ao entrypoint e que os componentes migrados são invocados pelos owners canônicos.
