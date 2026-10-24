# Cadastro, validade e acompanhamento da cobrança

## Alterações

- E-mail e conta exibem o mesmo instante em `America/Sao_Paulo`, incluindo horário e indicação Brasília. A duração permanece exatamente 14 × 24 horas; nenhum registro existente é alterado.
- Boas-vindas passam a ter assunto transacional, HTML + texto com conteúdo equivalente e escape do nome do estabelecimento. No ambiente hospedado, `EMAIL_PUBLIC_BASE_URL=https://pdv.artisys.dev` evita o link técnico workers.dev. No self-hosted, a variável é opcional e a origem local continua sendo usada.
- `billing/orders` consulta a central por HMAC, sem enviar credenciais ao navegador. Status desconhecido, timeout, indisponibilidade ou central ainda sem o endpoint são exibidos como indisponíveis, nunca como confirmação ou pagamento pendente presumido.
- A interface mostra pendente, confirmado, cancelado, expirado ou estornado e oferece atualização manual. Esta consulta não concede licença; a confirmação financeira assinada existente continua sendo o único caminho de ativação paga.

## Ordem de publicação e rollback

Publicar primeiro a alteração correspondente do Pagamentos ArtiSys (`/v1/integrations/pdv/billing-status`), depois o PDV. Reutiliza o segredo de cobrança já configurado em `PRODUCT_CONNECTORS_JSON['pdv-total-saas'].secret` e `ARTISYS_BILLING_SECRET`; não exige novos secrets, banco, migração ou serviço pago. Se a central antiga continuar ativa, o PDV mostra status indisponível. Reverter os commits restaura o comportamento anterior sem rollback de dados.

## Evidência de testes

- Regressões de data e status falham no código anterior e passam com as correções.
- `npm test`: 515 testes aprovados, sem falhas.
- `npm run build`: assets gerados; provisionamento remoto corretamente ignorado fora do build de produção.
- Consulta integrada entre os módulos reais PDV/central, com bancos/dados isolados: pedido pendente retorna `pending`, assinatura continua `TRIAL`, sem rede externa ou pagamento.
- Na central: testes de assinatura, expiração, isolamento por produto/empresa/proprietário, consultas HTTP self-hosted e Worker/D1; nenhum pedido ou fulfillment criado pela consulta.

## Entrega de e-mail: o que está e o que não está comprovado

O e-mail original de `welcome@artisys.dev` foi localizado no Lixo Eletrônico do destinatário. A consulta DNS encontrou:

| Registro | Evidência |
| --- | --- |
| SPF raiz | `v=spf1 include:_spf.mail.hostinger.com ~all` |
| SPF `cf-bounce.artisys.dev` | `v=spf1 include:_spf.mx.cloudflare.net ~all` |
| DKIM `cf-bounce._domainkey.artisys.dev` | chave RSA publicada |
| DMARC `_dmarc.artisys.dev` | `v=DMARC1; p=none` |

O SPF separado de `cf-bounce` é o padrão documentado para Email Sending; não foi substituído o SPF da Hostinger. A existência desses registros não comprova os resultados SPF/DKIM/DMARC da mensagem recebida. O conector de leitura disponível não expôs seus cabeçalhos originais. Não foi alterada política DMARC nem adicionada lista de remetentes confiáveis para mascarar o teste.

As alterações de conteúdo seguem as orientações oficiais, mas a classificação na caixa de entrada depende também do destinatário e da reputação. Exige novo envio controlado após publicação, sem promessa de eliminar spam. Após autenticação administrativa pelo formulário seguro do navegador, o pedido real de Teste ArtiSys (`dbb0a537`, R$ 89,00, produto `pdv-total-saas`, Asaas) foi conferido na central: **Aguardando pagamento** e **Entrega: Não iniciado**. A licença observada no PDV permanecia em TRIAL. Os cinco checks do GitHub Actions das duas PRs passaram; os checks Workers Builds da Cloudflare falharam sem log público detalhando a causa. Nenhuma alteração foi mergeada ou implantada nesta verificação.

Referências: [autenticação de envio](https://developers.cloudflare.com/email-service/concepts/email-authentication/), [entregabilidade](https://developers.cloudflare.com/email-service/concepts/deliverability/) e [API de envio Workers](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/).
