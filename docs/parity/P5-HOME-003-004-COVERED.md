# P5 — conclusão técnica dos quatro contratos de Início e navegação

**Desktop de referência imutável:** `nutricionistaalmeidavh-spec/PDV-ARTISYS@7efea9c61f75be1536a1e516e917218f2b8bf2bf`.

## home-003 — indicadores operacionais e alertas

O relatório de gestão do desktop original define cinco categorias de alerta em `managerAlerts`. Para demonstrar a equivalência de regras, a cópia integral **sem modificações** de `desktop/renderer/reporting-v2.js` está em `docs/parity/baseline/desktop-reporting-v2.js`, com blob Git `1d94a45df9bb6eff2082abeb9536ced2a559606a`. O teste executa a função original extraída desta cópia e confere o SHA Git antes de comparar os títulos e critérios com a API real.

A Home web amplia a posição dessas informações para o painel inicial, sem confundir localização de UI com cálculo de domínio. Agora mostra alertas fundamentados nos livros canônicos e na filial: estoque zerado após reservas, abaixo do mínimo efetivamente cadastrado, divergência de caixa em sessões encerradas naquele dia, margem negativa **apenas quando todos os custos relevantes são conhecidos**, e devoluções superiores às do dia anterior. Cálculos de caixa, vendas, metas, estoque e margem não são persistidos numa tabela secundária. Os links operacionais somente aparecem com autorização de rota.

Testes `home-003/{nominal,authorization,tenant-isolation,failure-recovery}` incluem execução desktop original, mutação de estoque no SQLite, caixa aberto/encerrado com divergência, autorização de somente leitura, empresa adversária e rejeição de escrita sem apagar alertas.

## home-004 — filtros, foco, scroll e escopo correto

A navegação desktop original está preservada em `docs/parity/baseline/desktop-app.js` (blob Git `87b463226b3440e8811d3fcbf3dd4ccff4275`). O gate de autorização e a regra de focar o conteúdo sem alterar scroll são conferidos literalmente na cópia original e no app web.

A camada `route-scroll-ui.js` restaura posição de leitura e foco da aba nos relatórios ao regressar de outra rota. As posições/focos são indexados por empresa, filial, usuário e rota; uma sessão diferente não recebe o estado visual anterior. Somente identificadores de contexto e posição de scroll ficam em memória temporária; valores financeiros, vendedor/cliente e tokens **não** são salvos ali. As preferências de relatório já persistentes usam somente `view` e intervalo de datas em `sessionStorage` por tenant/filial, e a API valida acesso novamente a cada consulta.

Testes `home-004/{nominal,authorization,tenant-isolation,failure-recovery}` executam a camada real de scroll com eventos de lifecycle simulados e mudança de identidade. O Chromium mobile testa a Home viva, navegação, período e foco da aba restaurados.

## Limites e política de certificação

Estes quatro contratos da **tela Início e navegação** podem estar `covered` quando todos os testes da CI completa, inclusive fonte desktop imutável e Chromium, passam no mesmo SHA. Isto **não** significa equivalência integral dos relatórios especializados ou dos outros seis módulos: `matrix.parityClaim` permanece `incomplete`. O hardware não é exigido para este domínio puramente web: **nenhum teste físico é condição para a entrega de código desta tela**. Não atribuí atestado manual a pessoa que não o deu.

Requisitos de operação: Node + SQLite self-hosted sem serviço pago obrigatório; Cloudflare remoto opcional.
