# Interface única do PDV Total — evolução web

Esta pasta contém **a interface original do PDV ArtiSys**, migrada para `apps/web` e adaptada no lugar. Não existe outro renderer, projeto desktop duplicado, ou estado paralelo de vendas.

## O que funciona em P3
- Login via API Cloudflare/D1 com cookie HttpOnly; sessão e empresa/filial são confirmadas no servidor.
- Navegação existente do PDV, com as opções habilitadas condicionadas a backend e permissões.
- Catálogo, registro de entradas e consulta do estoque derivado do ledger; modal e toast originais.
- Abertura de caixa no fluxo de finalização, carrinho da interface original, desconto autorizado, conclusão transacional e histórico.
- `PdvApiClient` é o único transporte de rede. Nenhuma chamada de `window.artisysDesktop` é necessária nessas operações web.

## Conversão em progresso / recursos desabilitados

Fiscal (NFC-e), impressão local silenciosa, crédito da loja, meios de pagamento eletrônicos capturados, compras avançadas, receitas, delivery, comandas, hardware, importação em lote, gestão de equipe e demais rotas do desktop ainda não possuem paridade online. Não exibi-las como disponíveis no menu nem acionar os endpoints desktop. Não usar dados falsos para parecer que estão prontas.

O Worker implantado com `AUTH_ENABLED=false` **permanece bloqueado para login e mutações comerciais**, mesmo que o HTML da interface seja servido publicamente. Não liberar até aplicar migrations, provisionar tenant real, verificar ambiente remoto e fechar critérios de segurança.

## Build sem cópia de núcleo

`npm run build` publica `dist/web` com assets estáticos do **mesmo renderer**, e serve o compositor canônico de `packages/core/shared/order-composer.js` como um asset. Essa cópia de distribuição não é código-fonte independente e é regenerada a cada build.

Verificações: `npm run check:web`, `npm run test:core`, `npm run test:api` e CI com Workerd/D1 e Chromium. Consulte `DESIGN.md` e `UX-CONTRACT.md` na raiz.

Repositório fonte do PDV Artisys desktop original: **não modificar**.
