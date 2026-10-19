# PDV TOTAL — sete capacidades R3/R4 concluídas no escopo de software

Data: 2026-10-19. Produto principal: **web/SaaS responsivo/PWA HTTPS**, sem exigir servidor LAN ou instalador no estabelecimento. Núcleo **R$ 0**, open source e self-hosted em Node.js + SQLite; infraestrutura Cloudflare Workers/D1 na faixa gratuita é opção hospedada, sujeita aos limites do provedor.

## Matriz de aceite funcional

| ID | Status | Cenário de integração/QA |
| --- | --- | --- |
| cap-031 | covered | Transferência de mesa com estado original, CAS no banco, duas ações concorrentes e impedimento de duplicidade |
| cap-032 | covered | Rateio por pessoa e por itens; antecipações imutáveis vinculadas ao pagador; estorno parcial com saldo líquido; fechamento em caixa de outro turno; uma única venda, sem dupla movimentação de dinheiro ou estoque |
| cap-038 | covered | Histórico de pedidos paginado por cursor estável, 113 pedidos e senha única por filial/dia com fuso configurável |
| cap-041 | covered | Primeiro acesso por segmento, seleção individual de módulos opcionais e permissões RBAC canônicas |
| cap-048 | covered | Chamado de garçom/conta na PWA, estados com transição única, concorrência e isolamento entre empresas |
| cap-049 | covered | Totais SQL sem corte artificial, relatório por filial/período, CSV com limite explícito e detalhes paginados |
| cap-050 | covered | Scanner HID emulado, balança serial numérica/Urano, gaveta ESC/POS, consentimento de porta e falhas de conexão |

**Fonte verificável:** `docs/parity/desktop-capability-inventory.json`, `apps/api/test/vertical-parity.test.mjs`, `apps/api/test/peripherals-web.test.mjs` e workflow `.github/workflows/verify-saas-foundation.yml`. As migrações `0028` e `0029` são incrementais. A prova não se baseia só em busca textual; o CI executa testes com asserções, SQLite, D1 local, Worker e Chromium.

## Fluxo financeiro da cap-032

1. Salvar a divisão da comanda antes de registrar adiantamentos por pagador (quando aplicável).
2. A cada recebimento, vincular forma, valor inteiro em centavos, comanda, caixa e, se houver divisão, índice do pagador. Cada operação tem identificador de idempotência.
3. Se precisar devolver dinheiro **antes** de vincular a venda, registrar estorno append-only com justificativa e permissão financeira; o saldo antecipado é líquido de estornos. O estorno entra como reversão no caixa correspondente, mesmo após mudança de turno.
4. Na venda única, cobrar apenas os saldos restantes, com preço/receita e baixa de estoque exclusivamente no checkout canônico. Se a venda já estiver vinculada, utilizar o procedimento de reversão da venda; não reescrever antecipações antigas.

O código mantém gatilhos SQLite/D1 contra recebimentos acima do total entregue ou da parcela, saldo negativo na devolução e fechamento de caixa inconsistente. Formas PIX/cartão registradas manualmente **não** implicam adquirência, TEF ou verificação bancária.

## Limites declarados

- **53/53 referências funcionais do desktop aplicáveis ao SaaS web** e 3/56 referências opcionais de instalação/servidor LAN (`cap-001`, `cap-047`, `cap-056`) permanecem fora do escopo de bloqueio.
- A matriz independente das 68 operações de tela continua tendo cenários parciais; não anunciar equivalência integral do desktop ou lançamento de produção só pelo inventário SaaS.
- Não afirmar homologação física de impressora, balança ou gaveta sem teste presencial por modelo/firmware.
- Merge **não equivale** a migração de banco D1 remoto, deploy ou habilitação de serviço pago. Antes de publicar: backup, validação de autenticação/tenant, migrações com rollback, QA PC/tablet/celular, comparação de SHA e monitoramento.
