# Sincronização rápida do PDV TOTAL — protocolo v2

## Objetivo e ganhos

- Um **sumário por empresa e filial** expõe contagem e revisão monotônica de 25
  conjuntos de dados. Triggers canônicos atualizam revisões no D1 em cada
  alteração; produtos não alterados requerem **zero páginas de rede**.
- Cada tabela alterada usa paginação **keyset por rowid**, sem OFFSET.
  Até 100 linhas por lote (75 por padrão), com SHA-256 do conteúdo.
  Se uma página exceder o limite, o PC reduz o lote automaticamente.
- O PC armazena páginas verificadas em SQLite e retoma pelo último cursor
  após falha de WAN ou reinicialização. Páginas com revisão desatualizada
  são descartadas, para não misturar estados incompatíveis.
- Um segundo sumário verifica TODAS as revisões, contagens e a epoch da
  autoridade após o download. Se o D1 mudou durante o transporte, o PC
  não instala uma cópia inconsistente; tenta de novo em outro ciclo.
- Exclusões D1 de **projeções mutáveis** (catálogo, clientes, estoque e mesas sem vínculos pendentes) são aplicadas de forma transacional, filiais/empresas estritamente isoladas, e sujeitas às mesmas chaves estrangeiras do SQLite. Se existirem eventos locais pendentes, qualquer exclusão perigosa aguarda a reconciliação; dados financeiros e históricos nunca são podados automaticamente.
- As tabelas inalteradas não recebem UPDATEs repetitivos no SQLite.
  O refresh obrigatório de identidade e MFA continua em cada ciclo
  por segurança: não depender apenas de updated_at para revogação de usuário.
- Outbox transacional SQLite → D1 continua anterior ao pull da nuvem.
  Com operações locais pendentes, mesas, comandas, caixa, estoque e vendas
  não são sobrescritos por projeções antigas.
- Migração 0048 aditiva, páginas e revisões separadas da contabilidade;
  compatibilidade de protocolo 1 para Workers antigos.

**Observação de desempenho:** revisão e checksum não substituem o índice de
catálogo nem o controle de concorrência. A revisão identifica quais tabelas
mudaram; a versão 2 transfere a tabela alterada em páginas, ainda não
representa CDC por linha individual ou uma transação D1 global entre requests.
Contagens do sumário e conferência de versões consomem consultas D1.

## Configuração do PC

1. Gere a autorização no painel do proprietário e configure um certificado
   HTTPS local confiável pelo iPhone e demais terminais.
2. No Windows com Node 22+, execute `npm run offline:setup`. O assistente
   pede empresa, filial, gateway, endereço Cloudflare, endereço local HTTPS,
   certificados e token. O segredo é gravado **apenas no PC**, protegido por
   permissões de arquivo quando suportadas pelo sistema operacional.
3. Execute `npm run build`, depois `npm run offline:start`.
4. O proprietário reserva a filial para o gateway após confirmar que o PC
   tem a réplica inicial, permissões, dados operacionais e rede local correta.
5. Nos terminais, configure uma vez o endereço HTTPS local autorizado no
   painel. Consulte a conexão pelo QR do garçom. A PWA pode navegar
   automaticamente para a origem local se uma **consulta GET** falhar.
   Não transfere cookies entre origens, não contorna novo login e não
   reenvia automaticamente pagamentos ou POSTs potencialmente confirmados.

## Pendências para homologação presencial

- Certificado HTTPS válido e confiável nos iPhones, Wi-Fi, reinicializações
  e inicialização automática do PC como serviço Windows supervisionado;
- Carga real com diversos garçons, caixas, KDS e impressora;
- Snapshot inicial grande com histórico financeiro antigo, FK, exclusões
  canônicas e operação interrompida por falha de disco;
- Diferenciação total de textos de status no painel, reconciliação de casos
  raros com alterações canônicas enquanto páginas são transferidas;
- Auditoria de tempos de D1 e telemetria para calibrar a periodicidade.

Nunca use a navegação entre origens para repetir operações monetárias:
a fila transacional e a autoridade única de escrita continuam obrigatórias.

## Critérios de merge e ativação (separados)

A PR pode ser submetida a merge somente após a suíte do **HEAD atual** concluir com sucesso, validação da migração 0048 no D1 local e revisão do dry-run do Worker. Não tratar um build Cloudflare externo fracassado como verde: investigar e registrar a causa. Um build também falhou na `main` base da PR, portanto o resultado externo isolado não prova regressão desta feature.

**O merge não ativa automaticamente a operação offline.** O protocolo novo e a cópia local continuam dependentes das flags opt-in já existentes; preserve o comportamento legado e as regras de pagamentos manuais, sem TEF. Antes de habilitar em produção, aplicar a migração 0048 por procedimento de deploy aprovado e verificar sua presença no D1; jamais executar manualmente migrações de produção por um job de QA ou sobrescrever credenciais.

### Matriz de aceite de código

- [x] Autenticação por gateway, empresa e filial, inclusive rejeição de acesso cruzado
- [x] Paginação keyset limitada, checksums e retomada durável de páginas
- [x] Invalidação quando versões, contagens ou epoch mudarem durante transferência
- [x] Zero páginas de catálogo inalterado, atualização sem depender de `updated_at`
- [x] Exclusão segura de registros mutáveis (transação e rollback por FK); ledgers imutáveis mantidos
- [x] Filas locais com ACK/replay idempotente antes da projeção da nuvem
- [x] Vários terminais com identidades distintas exercitados em testes de integração
- [ ] CI do último commit aprovado integralmente (acompanhar status do GitHub)
- [ ] Build Cloudflare externo explicado ou corrigido (não desabilitar gate silenciosamente)

### Homologação local antes da ativação em clientes

- [ ] PC Windows inicializado com HTTPS válido, certificado confiável em iOS/Android e rede Wi-Fi real
- [ ] Servidor local supervisionado/reiniciado automaticamente, incluindo boot sem sessão de usuário
- [ ] Testes com garçom/caixa/cozinha e impressoras reais, pareamento QR, perda e retorno da WAN
- [ ] Teste grande de dados históricos, exclusões vinculadas e recuperação de falha de disco
- [ ] Verificação de telemetria/latência e período de sincronização conforme carga observada

### Estratégia de reversão

Em caso de falha no rollout, **desative a flag de sincronização offline** e conserve a base SQLite, outbox e páginas de staging; não exclua filas pendentes nem force `CLOUD` quando a filial estiver com autoridade `LOCAL`. O endpoint `snapshot` de protocolo v1 continua preservado para os gateways antigos. Investigue conflitos e finalize a reconciliação de autoridade antes de transferir a escrita para outro nó.
