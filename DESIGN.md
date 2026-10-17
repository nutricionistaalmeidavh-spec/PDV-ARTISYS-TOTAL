# PDV Total — sistema visual canônico

**Produto:** ArtiSys PDV Total, SaaS operacional brasileiro para caixa, catálogo, estoque e gestão. Dispositivos: desktop de balcão, notebooks, tablet, smartphone para consulta e operação autorizada.

**North star:** preservar a velocidade de um terminal de caixa profissional com a clareza de uma aplicação SaaS bem acabada. Não transformar o PDV em landing page, não usar design de dashboard genérico, não carregar mais um framework de UI ou uma segunda shell.

## Autoridade e tokens

O sistema visual é mantido em **`apps/web/styles.css`**. Este documento descreve as intenções; não é outro arquivo gerador de tokens. `apps/web/web-cloud.css` contém apenas adaptações específicas de viewport/login web, e consome as variáveis existentes.

| Papel | Token canônico | Valor observado |
| --- | --- | --- |
| Primária e foco | `--artisys-blue` | `#0b6cff` |
| Acento | `--artisys-blue-2` | `#10a7ff` |
| Navegação e headings escuros | `--navy` | `#081a35` |
| Corpo | `--ink` | `#10172f` |
| Texto auxiliar | `--muted` | `#62718d` |
| Superfície | `--surface` | `#ffffff` |
| Sucesso | `--success` | `#12b76a` |
| Risco/erro | `--danger` | `#ef3340` |
| Raio principal | `--radius` | `18px` |

**Anti-referências:** conteúdo visual de marketing no lugar de produtos, cards gigantes com pouca informação, controles sem rótulo, recargas que esvaziam o carrinho, imagens fictícias, preço recalculado fora do núcleo comercial.

## Propriedade dos componentes

- **Estrutura e navegação:** `apps/web/index.html`, `apps/web/app.js`, `route-registry.js`.
- **Estado de negócio em tela:** `state` existente de `app.js`. Não criar stores ou renderers paralelos.
- **Toast e feedback:** `apps/web/toast-ui.js` e `PdvToast`; não duplicar notificação.
- **Modal e foco:** `PdvModal` (em `app.js`); preservar foco após fechar, inputs e carrinho durante erros.
- **Busca:** `PdvUiModel.normalizeSearch`, filtros e grids já existentes.
- **Transporte:** `apps/web/api-client.js`; apenas servidor modifica estoque, caixa, venda e pagamento.
- **Cores, densidade e componentes:** `styles.css` com overrides limitados de `web-cloud.css`.
- **Visualização responsive:** navegar com botões sem controle de janela nativo, usar breakpoint da tela sem reproduzir o shell Electron.

A experiência de caixa é intencionalmente densa. O item de maior frequência (buscar/adicionar produto) deve permanecer alcançável rapidamente. O subtotal sempre resulta das regras de `packages/core` executadas no backend.

## Estados obrigatórios

Pendente é distinto de sucesso. Ao perder rede, preservar o texto digitado, carrinho e chave de idempotência de finalização. Permissão insuficiente deve ser explicada no contexto sem mostrar dados de outra empresa. Não comunicar pagamento recebido externamente: a tela registra apenas o método informado, enquanto integração financeira eletrônica não existir. Nunca confirmar venda antes de persistência transacional D1.

O objetivo de acessibilidade é WCAG 2.2 AA (teclado, foco visível, contraste, labels e live regions), sem declarar conformidade verificada até existir QA visual e automatizado real.
