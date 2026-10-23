# QA hospedado — 23/10/2026

## Atualização após correções e novo corte

Os dois bloqueadores encontrados foram corrigidos: login web usa o plano de referências por capacidade; recuperação/recebimento de comandas aceita permissão de vendas com consulta de caixa, sem conceder gestão de restaurante. Teste de API prova recebimento por CASHIER, negação de gestão e negação de abertura de documento por OPERATOR.

Novo corte executado na réplica limpa em 4198, estrutura publicada e código corrigido: OWNER/WAITER/KITCHEN/CASHIER entram; WAITER abre mesa e envia pedido; KITCHEN inicia e marca pronto; WAITER entrega; CASHIER recupera em Balcão → Comandas e pedidos e recebe R$10 em PIX registrado; WAITER encerra mesa paga e ela aparece livre; CASHIER fecha R$100 físicos com divergência zero. Estoque consumido uma única vez. As variantes desse percurso passaram e a jornada foi incorporada ao gate permanente `scripts/audit-fixes-browser.mjs`, que também verifica estoque e caixa diretamente no SQLite.

Testes afetados de documentos: 9/9. Gate de navegador ampliado passou. `npm test` completo passou após compatibilizar comparações de hash de fontes com checkouts CRLF do Windows; somente quebras de linha são normalizadas, sem atualizar hashes esperados ou remover verificações de negócio. Nenhum novo bloqueador foi identificado neste corte. Os achados históricos abaixo ficam preservados com suas reproduções; o status atual dos dois bloqueadores é corrigido e validado localmente.

Continuam fora deste aceite: Safari/iPhone físico e PWA instalada; convite entregue a caixa postal real; evento pago real do Asaas, pois não existe sandbox disponível. Recuperação de estrutura completa com dados sintéticos no D1 separado passou conforme seção própria. A homologação multiusuário hospedada depende da publicação deste código e de identidades de teste ativáveis; este corte por perfil foi executado em réplica local.

## Ambiente e escopo

Aplicação: https://pdv.artisys.dev/app/. Publicação Cloudflare de 23/10/2026 às 15:55:19 UTC, versão `189b5d8e-0b39-4357-86c1-37d15af092dd`. D1 confirmou migrações até `0042_finance_query_indexes.sql`. Endpoint de saúde respondeu 200 / identity-ready.

Conta e empresa sintéticas **QA hospedado mvl6yqml**, provisionadas pelo script canônico, trial até 06/11/2026. Credenciais aleatórias somente em `apps/api/.local/qa-credentials.json`, ignorado pelo Git. Nenhuma senha da Burguerzão foi necessária. Nenhum lançamento foi feito nela. Dados QA foram preservados para rastreabilidade; caixa e mesa terminaram fechados.

## Evidência operacional hospedada

Executado por HTTP na API pública, com autenticação, cookies e mutation IDs reais. Não representa execução de todos os passos por cliques no Safari.

| Fluxo | Resultado observado |
| --- | --- |
| Preparação | Produto QA R$10, cardápio habilitado, entrada de 10 unidades, abertura com R$100 |
| Balcão | 2 unidades = R$20, recebimento em dinheiro R$50, troco R$30 |
| Repetição | Mesma confirmação retornou resultado idêntico; estoque ficou em 8 |
| Mesa | Mesa QA aberta, um pedido de R$10; repetição do envio manteve o mesmo pedido |
| Setor KDS | Produto configurado para QA Cozinha; ticket de estação passou PREPARING → READY; entrega registrada |
| Recebimento da mesa | Uma venda PIX registrada de R$10, estoque 7; comanda fechada e mesa livre |
| Cancelamento/restituição | Venda de balcão cancelada com restituição R$20; repetição sem nova reposição; estoque final 9 |
| Caixa | Fechado com esperado R$100, contado R$100 e divergência zero |
| Isolamento | Sessão QA recebeu 404 ao tentar filiais, produtos e vendas da outra empresa existente |
| Sessão | Logout executado |

Conferência independente por SELECT no D1: uma venda COMPLETED de 1000 centavos, uma CANCELLED de 2000 centavos e caixa CLOSED com divergência 0. O PIX é registro de forma de pagamento; não houve transferência bancária real.

O primeiro comando de preparo tentou atualizar a fila geral de um pedido roteado. O servidor rejeitou com 409 e orientação para atualizar tickets de estação. O teste continuou no ticket de estação existente, sem recriar a operação. Isso foi ajuste do roteiro, sem alteração do produto.

## Navegadores móveis

Chromium e WebKit 26.6, viewport 390×844, contra o ambiente publicado. Login e navegação por controles visíveis em Início, Balcão, Alimentação e Caixa. O teste aguardou o conteúdo de cada destino. Nas telas medidas: documento de 390 px, sem overflow horizontal e sem erro JavaScript. Capturas locais em `qa-artifacts/production/` na cópia `audit-web-lf`.

Amostra única até conteúdo: Chromium Balcão 1374 ms / Alimentação 1930 ms / Caixa 1463 ms; WebKit 2049 ms / 2049 ms / 1502 ms. Não são p50/p95 nem ensaio com rede controlada. WebKit no Windows não comprova Safari físico, teclado iOS, VoiceOver ou PWA instalada.

## SaaS e recuperação

26 verificações focadas passaram em bases locais temporárias: bootstrap de empresa, trial/aprovação, autorização de licença, isolamento, revogação, autenticação HMAC de cobrança, período/replay, backup WAL consistente, restauração em destino separado e rejeição por checksum adulterado.

O trial hospedado permitiu as operações acima. Provisionamento por script não homologa a jornada comercial pela central. Não houve checkout pago real, webhook real de provedor ou restauração do D1 de produção.

## Parecer e próximo corte

### Complemento: jornadas por perfil, cobrança e recuperação

Consulta autenticada hospedada de `billing/plans` respondeu 200 com mensal de R$89 e anual de R$899; `billing/orders` respondeu 200 para a empresa QA. A configuração pública da central aponta `https://api.asaas.com/v3`, com pagamentos habilitados: é produção, não sandbox. Nenhum pedido pago foi criado. 15 contratos focados da central passaram (ofertas/vínculo PDV e diagnóstico Asaas). O fluxo de evento real do provedor permanece sem execução até identificar um ambiente sandbox.

Após autorização explícita, foi criado um convite WAITER pela interface na empresa hospedada. O serviço de e-mail ativo não devolve código de ativação; o endereço sintético não possui caixa postal acessível. O roteiro não concluiu ativação. O provisionamento direto das identidades foi rejeitado pela revisão automática por contornar ativação; essa gravação não aconteceu. Não há aprovação da jornada de convites por e-mail.

O usuário autorizou estrutura completa com dados sintéticos. Foi exportada somente a estrutura do D1 publicado, sem copiar dados da Burguerzão. Criado D1 privado `pdv-qa-recovery-20261023`, sem Worker associado, e restaurado snapshot completo de uma réplica sintética: 122 tabelas e 47 registros. Importação D1 executou 399 comandos. A comparação de conteúdo e integridade tem resultado no complemento de recuperação abaixo. Nenhuma restauração foi feita sobre produção.

### Jornada por perfil: reprovada na réplica

Ambiente loopback 4197, código da main e estrutura exportada do D1 publicado, quatro identidades sintéticas (OWNER/WAITER/KITCHEN/CASHIER), Chromium em 390×844. Preparação de produto/estoque/setor/mesa por API de fixture; ações operacionais abaixo por controles visíveis da interface.

| Perfil | Resultado |
| --- | --- |
| OWNER | Login e KDS: iniciar preparo e marcar pronto funcionaram |
| WAITER | Login, abrir mesa existente, enviar pedido ao setor e registrar entrega funcionaram |
| KITCHEN | **Falha bloqueadora:** sessão autentica, mas login visual permanece com “Permissão insuficiente”; GET de produtos retorna 403 |
| CASHIER | Login e abertura de caixa de R$100 funcionaram; **falha bloqueadora:** comanda entregue não aparece em Balcão → Comandas e pedidos |

Causas localizadas: `apps/web/app.js`, `loadCommonData`, exige `api.products()` e categorias antes de liberar a tela de login web, mesmo para KITCHEN sem `products.view`. `apps/api/src/checkout-documents.mjs` condiciona listagem de comandas a `restaurant.access` e `restaurant.orders.view`; CASHIER tem operação de vendas, mas não essas capacidades. O servidor retorna lista vazia, sem oferecer caminho de recebimento ao caixa. O uso de OWNER no KDS só permitiu verificar a etapa operacional; não aprovou o perfil KITCHEN.

Correção prioritária: carregar referências no login conforme capacidades e definir autorização restrita de recebimento de comandas para CASHIER. Não ampliar genericamente as permissões de catálogo/cozinha. Repetir a jornada após corrigir; o corte atual é diagnóstico e não alterou código de produção.

### Ensaio de recuperação: procedimento

Snapshot de 130004 bytes composto da estrutura exportada do D1 e 47 registros exclusivamente sintéticos da réplica. Dados reais da Burguerzão não foram exportados. Arquivo e manifesto SHA-256 somente no diretório `.local/` ignorado pelo Git.

1. Exportar estrutura com `wrangler d1 export pdv-artisys-total --remote --no-data`.
2. Obter snapshot consistente da massa sintética; preservar valores e relações de todas as tabelas, inclusive saldos e movimentos.
3. Carregar tabelas e índices, depois registros com chaves estrangeiras diferidas, e somente então criar gatilhos.
4. Restaurar em D1 novo, privado, sem binding a Worker público. Nunca importar esse ensaio no banco ativo.
5. Comparar conteúdo canônico de cada tabela, não apenas contagens; verificar chaves estrangeiras e integridade.

A primeira montagem do arquivo criou gatilhos antes de carregar os registros. O gatilho de projeção de estoque somou movimentos ao saldo já restaurado, e a comparação detectou 20000 em vez de 10000 milésimos. Ensaio corretamente reprovado. Foi corrigido o harness de exportação para criar os gatilhos após os dados; repetição em `pdv-qa-recovery-20261023-v2`, sem sobrescrever produção. Esse achado pertence à montagem do snapshot sintético neste ensaio, não demonstra defeito no export nativo D1 nem no backup SQLite do produto.

Resultado final às 17:03:35 UTC: **passou**. Comparação integral de conteúdo das 122 tabelas e 47 registros com a origem (`fullContentMatch=true`); `PRAGMA foreign_key_check` sem violações e `PRAGMA quick_check` retornou `ok`. Manifesto com hashes por tabela em `.local/qa-recovery-results.json`. Os dois D1 privados de ensaio permanecem sem Worker associado; o primeiro é evidência reprovada, o segundo é a restauração validada. Isso homologa o procedimento com dados sintéticos, não um snapshot dos dados reais.

O caminho nominal hospedado com OWNER passou no recorte anterior, mas a jornada com perfis padrão encontrou dois bloqueadores. **Não liberar operação multiusuário de restaurante antes dessas correções.** Cobrança com evento real de provedor continua não homologada: usuário confirmou não possuir sandbox e nenhuma cobrança real foi criada.

Pendências para liberação comercial:

1. Completar pelo navegador a jornada mesa → KDS → cobrança, incluindo perfis WAITER/KITCHEN/CASHIER, divisão, devolução parcial e interrupção de rede.
2. Homologar Safari no iPhone físico e PWA instalada, teclado, retorno do segundo plano e atualização de cache.
3. Validar cadastro/assinatura pela central e confirmação do provedor em ambiente de teste suportado, sem cobrança não autorizada.
4. Recuperação de estrutura completa e dados sintéticos no D1 separado **executada e aprovada**, com procedimento acima. Snapshot/restauração dos dados reais não foi solicitado neste corte.
5. Medir navegação com repetição, frio/quente e rede controlada: a amostra atual ainda apresenta cerca de 1,4–2,1 s entre páginas.
