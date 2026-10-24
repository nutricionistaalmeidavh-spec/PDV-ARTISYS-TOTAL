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
