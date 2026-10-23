# Homologação final em equipamento físico — PDV TOTAL

Este roteiro complementa os gates gratuitos Playwright/Chromium, WebKit, Node e SQLite. **WebKit no runner Linux não é Safari físico**; captura de tela não prova venda, papel impresso ou pagamento confirmado. Não declarar 100% enquanto faltarem evidências do dispositivo/ambiente especificado.

## Preparar piloto isolado

- Usar somente empresa/filial sintética de homologação, dois terminais e perfis OWNER, WAITER, KITCHEN, CASHIER, STOCKKEEPER, FINANCE e READ_ONLY. Não movimentar Burguerzão nem outros clientes reais.
- Registrar data, commit/deploy exato, navegador e versão, modelo e firmware dos periféricos, conexão, responsável e políticas da loja (estoque negativo, cancelamento, antecipação, permissão de transferência, serviço).
- Usar produtos de R$ 10 e R$ 20 e recibos **não fiscais**. Nunca executar pagamento real sem autorização específica. Asaas é integração opcional: core funciona sem provedor pago.

## QA-12 — Safari no iPhone e PWA instalada

1. Abrir `https://pdv.artisys.dev/app/` pelo Safari de iPhone físico. Testar em retrato e paisagem, zoom, teclado virtual, VoiceOver e retorno após segundo plano. Registrar resolução, iOS, versão Safari, console remoto se disponível e screenshots anonimizados.
2. Fazer login de OWNER e cada perfil com contas sintéticas; conferir filial, esconder controles indevidos e receber 403/404 no servidor em acesso não autorizado.
3. Concluir pela UI **QA-03 → QA-04 → QA-05 → QA-06**. Executar pelo menos: pedido com observação; refresh; dupla tentativa; transferência para mesa ocupada; split 2 pagadores; antecipação e estorno parcial; pagamento restante; caixa e estoque conferidos por SQL.
4. Usar **Compartilhar → Adicionar à Tela de Início**, abrir o ícone PWA e repetir a jornada. Isso deve ser um teste na instalação real; WebKit de CI não substitui.
5. Com carrinho/formulário preenchido, cortar a rede antes e depois de confirmar operação. Interface deve exibir pendente/erro, não anunciar sucesso falso nem concluir duas vezes. Restaurar rede, reler estado do servidor, nunca enviar automaticamente nova venda.
6. Depois de publicar uma versão de teste, abrir a PWA instalada e atualizar; verificar shell novo, cookie/autenticação e isolamento entre usuários e filiais. Nenhum JSON de vendas/pacientes/tokens pode ficar no CacheStorage.
7. Repetir com Chrome desktop, navegador mobile e Safari físico. Medir frio/quente e p50/p95 por amostras reais, com rede controlada; não inferir valores de uma execução única.

## Impressora/PC, balança e demais periféricos

1. Confirmar fabricante, modelo, firmware, porta, driver, papel 58/80 mm, local do PC conector e estado da fila.
2. Autorizar pareamento no PC com consentimento local; negar tentativas de origem não autorizada e de outros tenants. Revogar e reconectar.
3. Concluir uma venda sintética, imprimir 1 vez e **verificar saída física**, legibilidade do cupom, logo quando suportado e corte/gaveta se existirem.
4. Desconectar a impressora, enviar um job e conferir `FAILED`/`UNCERTAIN`; reiniciar PC/conector, restaurar e reenviar manualmente sem duplicar papel. Aceite do spooler `SUBMITTED` **não equivale** a `physicallyPrinted=true`.
5. Testar leitor HID e balança real (peso inválido, timeout, desconexão, retorno). Safari iOS sem Web Serial usa caminho manual; não fingir hardware suportado.
6. Conferir que filas/chaves ficam locais e que Worker remoto não controla porta serial; não guardar tokens ou dados de clientes nos artefatos.

## Comercial opcional (não bloqueia self-hosted)

- E-mail de convite e recuperação: transporte de teste, mensagem entregue a uma caixa sintética controlada, URL correta, token de uso único e expiração.
- Asaas: executar apenas em sandbox próprio quando disponível, com webhook assinado, replay, expiração e mudança de licença reconciliada. Sem sandbox, marcar **NÃO HOMOLOGADO**, jamais simular pagamento real ou executar cobrança de produção.
- Core obrigatório R$ 0: as jornadas locais e SQLite não dependem de Asaas, Cloudflare pago nem serviço terceiro.

## Critério de aprovação

Para cada QA-00..12 registrar `PASS`, `FAIL`, `BLOCKED` ou `NOT_RUN` **por variante** positiva, negativa e recuperação, além de perfil, filial, dispositivo, hora, pré-condições e resultados esperados/observados. Anexar screenshot não manipulado, confirmação por SQL e logs sanitizados. Separar evidência de API, navegador em CI e dispositivo físico. Qualquer perda/duplicação de estoque, caixa ou venda reprova liberação comercial.

Checklist físico mínimo: QA-12 Safari físico + PWA real, impressão em papel e retorno de rede, e-mail externo/Asaas somente se essas integrações forem ofertadas ou habilitadas para o piloto.
