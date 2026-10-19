# PDV Total — fechamento de seis capacidades e pendência financeira restante

Data: 2026-10-19. Produto principal: SaaS web/PWA HTTPS. Núcleo obrigatório gratuito, open source e self-hosted com Node.js/SQLite; Cloudflare Workers/D1 é alternativa hospedada na faixa gratuita, conforme limites do provedor.

## Revisão baseada em evidência

| ID | Estado auditado | Código e contrato |
| --- | --- | --- |
| cap-031 | covered | `vertical-service.mjs`, expectedTableId, gatilho atômico 0029, teste de transferências simultâneas |
| cap-032 | partial | Pagamentos antecipados imutáveis, contabilização sem duplicar caixa/venda; rateio individual por item comprovado separadamente; ainda falta uso combinado na mesma comanda |
| cap-038 | covered | Histórico e relatórios paginados por cursor, teste de 113 pedidos, senhas com fuso IANA e índice único por dia/filial |
| cap-041 | covered | Primeiro acesso por segmento, recomendações editáveis por módulo, persistência canônica e RBAC do perfil |
| cap-048 | covered | Chamados PWA de garçom/conta, estados OPEN/ACKNOWLEDGED/CLOSED, unicidade de chamado ativo e CAS sob concorrência |
| cap-049 | covered | Agregação SQL sem corte de 100 pedidos, detalhes paginados, CSV limitado explicitamente, dados de filial e período |
| cap-050 | covered | Adaptação WebSerial HTTPS, escala genérica e Urano, gaveta ESC/POS, impressão e scanner HID; testes de permissão, isolamento de portas e desconexão |

**Evidência CI anterior à atualização documental:** [Verify SaaS canonical foundation, SHA `0e8d16fb`](https://github.com/nutricionistaalmeidavh-spec/PDV-ARTISYS-TOTAL/actions/runs/39269330637), concluída com sucesso. Necessária CI adicional no SHA de documentação e matriz antes de merge.

### Limite financeiro que impede 53/53

A API já suporta adiantamentos durante uma comanda aberta, sem segundo registro de venda. Os pagamentos são imutáveis, exigem caixa aberto, são limitados aos itens entregues e compõem a venda única ao concluir, sem repetir o dinheiro em `cash_movements`. Uma segunda operação repetida com a mesma chave é idempotente.

O rateio por item/pagador também está implementado no plano da comanda, sem duplicar vendas. **Os dois modos são exclusivos na mesma comanda nesta versão.** Quando já houve antecipação, alterar ou criar um plano de rateio é bloqueado; quando existe plano, antecipações são rejeitadas. É necessário permitir alocação por pagador, conciliar pagamentos antecipados por parte e testar métodos mistos, estornos e trocas de turno antes de classificar `cap-032` como covered.

### Escopo e integridade

- A matriz histórica preserva os 56 IDs: R1 21/21, R2 11/14 com três itens locais fora do escopo SaaS, R3 8/8, R4 12/13. Aplicáveis ao SaaS: **52/53 cobertas**, uma parcial.
- Não declarar impressora, balança ou gaveta física homologada; só protocolos simulados.
- Não confundir pagamento registrado manualmente como PIX/cartão com adquirência/TEF. Nada é cobrado automaticamente.
- A migração `0029_r4_saas_concurrency.sql` é incremental, reversão/backup e provisionamento devem ser verificados antes de qualquer banco remoto.
- Merge não equivale a deploy. Verificar autenticação, tenant, migrations, backups, QA PC/mobile e SHA efetivamente publicado.
