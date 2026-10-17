# Única interface do PDV Total — conversão web em andamento

Esta pasta reúne a UI original (HTML/CSS/JS) transferida de `desktop/renderer` do PDV Artisys para ser **adaptada no lugar**, sem criar renderer paralelo. As páginas, componentes, rotas e estado existentes são a base para operação web.

**Não está pronta para deploy:** a UI original depende de `window.artisysDesktop`, operações locais IPC, chamadas da API desktop, estilos de janela e tela de atualização; esses pontos devem ser substituídos **neste mesmo código** por transporte HTTP/cookies, onboarding multiempresa, capacidade/entitlements do servidor e tratamento dos estados pendente/sucesso/falha sem resetar dados digitados ou o carrinho.

A API SaaS ainda não expõe vendas, caixa ou estoque. Não servir este HTML publicamente nem simular a operação de vendas até que o backend canônico tenha as transações D1 e os testes de paridade. O Worker de produção da Cloudflare atualmente publica **somente a API P1/P2**, não esta interface.

O script do compositore de pedidos compartilhado reside em `packages/core/shared/order-composer.js`. O empacotamento web deve servir/bundlar esse **mesmo módulo**, sem copiá-lo.
