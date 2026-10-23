# PDV TOTAL — Telemetria SaaS e central ArtiSys Pagamentos

## Escopo da implementação (Fases 0–2)

- A PWA usa a sessão `HttpOnly` canônica e o contexto autenticado de empresa/filial; **não** depende do token de desktop armazenado em `sessionStorage`.
- Rotas de telemetria: `GET/PUT /api/v1/tenants/:tenantId/telemetry/preferences` e `POST /api/v1/tenants/:tenantId/telemetry/events`.
- A empresa só envia eventos quando proprietário/administrador/gestor habilita explicitamente a coleta. Diagnósticos são uma preferência separada. A coleta começa desabilitada.
- Identificador da empresa vem da rota autorizada no servidor, jamais de um campo arbitrário no payload.
- Campos permitidos em eventos: ID técnico UUID, evento enumerado, filial autorizada, tela enumerada, módulo enumerado, resultado enumerado e duração em milissegundos. Campos extras são rejeitados; nenhum e-mail, documento, texto livre, rota dinâmica ou token é coletado.
- D1/SQLite armazena somente eventos opcionais pseudônimos para agregação, em tabelas separadas de caixa, venda e auditoria obrigatória. Eventos duplicados têm chave primária de deduplicação.
- O sink `PDV_TELEMETRY_ANALYTICS` do Workers Analytics Engine é opcional, e só grava quando **ambas** as condições valem: consentimento do tenant e `TELEMETRY_ANALYTICS_ENABLED=true`. No SaaS, o deploy configura **true**, mantendo o consentimento por empresa como condição obrigatória e a ausência do binding como fallback seguro.
- A central ArtiSys Pagamentos recebe **apenas agregados dos últimos 7 dias** via ação `telemetry` no bridge privado HMAC já existente. Não existe segundo login nem painel separado.

## Implantação

1. Aplicar as migrações canônicas na ordem, incluindo `0043_print_relay.sql`, `0044_telemetry_events.sql` e `0045_telemetry_analytics_budget.sql`. Não renumerar ou alterar migrações já aplicadas.
2. Validar a API e permissões com `npm run test:api`, a PWA com `npm run check:web`, e o conjunto completo com `npm test` e as verificações do CI.
3. Publicar o PDV e depois a atualização do Pagamentos. Na central já existente, abrir **Mais > Telemetria · PDV TOTAL**.
4. O Worker SaaS usa `TELEMETRY_ANALYTICS_ENABLED=true`, mas só transmite eventos consentidos. A emissão externa é limitada a **80.000 gravações por dia UTC** (reserva conservadora abaixo da franquia Workers Free de 100.000 datapoints/dia). O monitor diário aparece no ArtiSys Pagamentos. Os 80.000 não incluem outros datasets ou Workers da conta; monitorar a franquia global no painel Cloudflare. Para desativar o sink sem desativar coleta local, use `false`. Nunca colocar API tokens de consulta no navegador.
5. Um OWNER pode habilitar as métricas em **Configurações > Privacidade e diagnóstico**, separadamente por empresa. Eventos anteriores à autorização não são capturados retroativamente.

## Segurança e compatibilidade

- Não toca na bridge de impressoras, QR/pairing, pedidos, caixa, estoque, faturamento ou contratos Asaas.
- O módulo local Node/SQLite e o SaaS operam sem Workers Analytics Engine; a emissão externa é fail-open e não bloqueia operações comerciais.
- Operações administrativas cross-tenant não são públicas: passam pelo bridge HMAC, nonce, janela temporal e autorização do admin do Pagamentos.
- O Analytics Engine fornece métricas estatísticas, não fonte contábil; os agregados exatos para a central vêm do banco próprio.
- Retenção: o armazenamento local tem de receber política de expurgo operacional antes de ampliar volume de eventos; não configurar histórico ilimitado em produção. O Analytics Engine retém eventos por aproximadamente 3 meses. Sem executar exclusões em tabelas comerciais.
- Não interpretar CI como homologação física do Safari, impressão, hardware ou produção real.

## Limites e próximos incrementos

Este incremento cobre sessão, consentimento, ingestão, eventos de telas, amostragem de desempenho das chamadas e conclusão de venda/devolução. **Ainda não é telemetria completa de todos os fluxos**, nem traz tracing distribuído, alertas automáticos ou pipeline de replay garantido para o Analytics Engine. Esses recursos exigem fases adicionais com testes e critérios específicos.

O painel ArtiSys Pagamentos mostra apenas eventos habilitados e existentes; sem consentimento, o painel corretamente exibe zero.
