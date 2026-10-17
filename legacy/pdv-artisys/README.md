# ArtiSys PDV 2.0.1

PDV desktop da ArtiSys para operação **local-first**, self-hosted e em rede LAN. O funcionamento diário não depende de SaaS, nuvem ou internet: venda, estoque, caixa, impressão, módulos operacionais e persistência permanecem no ambiente do estabelecimento.

O projeto usa um único núcleo transacional para venda, estoque, caixa, pagamentos, devoluções, impressão e auditoria. Recursos por segmento são módulos opcionais sobre esse mesmo núcleo, sem transformar cada nicho em um produto separado.

## Licenciamento comercial

**Local-first/self-hosted descreve onde o sistema roda e onde os dados ficam; não significa licença gratuita para clientes.** A distribuição oficial do ArtiSys PDV exige compra/liberação pela ArtiSys. Uma instalação ainda não ativada não libera primeiro acesso nem login, mesmo que já exista usuário local.

A ativação usa o e-mail liberado e um código de 6 dígitos fornecido pela ArtiSys no endpoint comercial padrão `https://pdv-artisys.sistema-artisys.workers.dev`. Depois da ativação, venda, estoque, caixa, impressão e demais dados continuam locais; indisponibilidade temporária da nuvem não bloqueia uma licença cujo último estado conhecido seja ativo. O override `PDV_REQUIRE_COMMERCIAL_ACTIVATION=false` é reservado a desenvolvimento/uso interno e não faz parte da distribuição para clientes.

Contrato canônico: `docs/architecture/commercial-licensing.md`.

## Estado do produto

As entregas **E01–E54**, **E54.1** e a **Fase 9 — profundidade operacional** estão integradas na versão 2.0.1. A versão atual inclui operação de balcão, retaguarda, estoque por local, compras, pedidos, áreas opcionais, hardware local, LAN, backup, importação, observabilidade e gates automatizados de release.

### Operação comercial

- Balcão com busca por nome, SKU e código de barras;
- seleção de variações, cliente e vendedor;
- suspensão e retomada de vendas;
- descontos e alteração de preço com autorização;
- pagamentos mistos registrados manualmente;
- caixa com abertura, suprimento, sangria, reversões e fechamento com divergência;
- histórico de vendas e cancelamentos;
- devoluções parciais e totais com seleção de itens, quantidades, reembolso, controle do saldo devolvível e autorização conforme perfil;
- venda e devolução preservam a sessão de caixa original para que retries assíncronos não movimentem uma sessão posterior;
- desconto da venda é alocado por item e a devolução usa o valor líquido efetivamente realizado;
- observação interna vinculada à venda/cliente e impressão opcional no comprovante não fiscal;
- relatórios operacionais e exportação CSV.

### Catálogo e estoque

- produtos, categorias, clientes, vendedores e fornecedores;
- **Produto pai e subitens** no catálogo comum, com SKU, código de barras, preço, custo, atributos e estoque próprios por variação;
- **Kits e combos promocionais** configuráveis, com snapshots históricos para preservar baixa e reversão corretas;
- ficha técnica versionada e consumo de ingredientes pelo ledger de estoque;
- a venda congela o snapshot efetivo de consumo de estoque, evitando que uma edição posterior da ficha técnica altere baixa, cancelamento ou devolução de uma venda antiga;
- estoque por ledger imutável, inventário e alertas de mínimo;
- estoque por local, com físico, reservado e disponível;
- reservas e transferências com estado em trânsito;
- snapshot histórico de custo por item vendido para preservar margem histórica.

Detalhes de catálogo: `docs/architecture/catalog-parent-variants-kits-combos.md`.

### Compras e pedidos

- pedidos de compra vinculados a fornecedores;
- recebimento parcial;
- custo médio móvel;
- conta a pagar vinculada ao recebimento;
- orçamentos e pedidos com retirada ou entrega;
- reserva de estoque;
- atendimento parcial ou total;
- conversão para a mesma venda canônica usada pelo Balcão.

O saldo legado é migrado para `MAIN — Estoque principal`. `inventory_balances` permanece como projeção agregada de compatibilidade, enquanto as operações novas usam saldos por local.

### Áreas opcionais

O núcleo comercial do PDV não é desativável. Produtos, variantes, ficha técnica, venda por peso, estoque, caixa, financeiro e relatórios pertencem ao Core e não dependem de uma vertical comercial.

Em `Configurações > Áreas`, o estabelecimento ativa somente fluxos que realmente mudam a operação:

- **Alimentação** — inclui automaticamente Pedidos e Produção/KDS. Mesa/comanda, balcão com senha, entrega/retirada e personalizações de produto são capacidades do mesmo fluxo de Alimentação, não módulos independentes;
- **Atacado** — pedidos B2B com cliente obrigatório, preço por quantidade, política comercial, crédito reutilizado do cadastro de Clientes e previsão de entrega/retirada, sempre faturados no mesmo Balcão/Caixa.

O antigo vertical de **Serviços** não faz parte do produto ativo. Suas tabelas legadas permanecem preservadas apenas para compatibilidade de dados; profissionais e comissões usam Equipe e o motor canônico de comissões do Core.

As áreas reutilizam o mesmo núcleo de venda, estoque, caixa, impressão, auditoria e eventos. Uma área desativada deixa de aceitar novas mutações específicas. As permissões `accessRoles` e `manageRoles` do catálogo também são aplicadas na API, não apenas na navegação da interface.

### LAN, dispositivos e dados

- servidor local autoritativo;
- terminais pareados usando API LAN, sem acesso direto ao SQLite;
- a credencial de pareamento do terminal é mantida no armazenamento seguro do sistema operacional e não em `data-server.json`;
- o teste de servidor valida tanto disponibilidade quanto autenticação do terminal antes da troca;
- a troca de uma instalação local para servidor externo é bloqueada quando há dados operacionais locais sem migração;
- interface móvel da equipe self-hosted em `/mobile`;
- cardápio público por mesa em `/m/:token`, aberto por QR sem credencial de dispositivo;
- dispositivos de garçom e KDS com credenciais próprias;
- QR individual por mesa com token opaco e possibilidade de rotação/revogação;
- pedido do QR reaproveitando a mesma comanda, `restaurant.addOrder()` e despacho para cozinha;
- compositor local compartilhado entre desktop, garçom e QR, preservando quantidade, observações e configurações do produto;
- sessão de mesa preservando operador de abertura, garçom responsável, quantidade de pessoas e cliente até o checkout canônico;
- handshake de versão e deduplicação de mutações;
- backup com manifesto/SHA-256, validação e restore atômico;
- importação CSV/XLSX com preview, erros por linha e commit idempotente;
- health, logs estruturados, diagnóstico ZIP e checklist persistente de piloto;
- telemetria opcional e opt-in para fluxos e falhas, com fila SQLite local e backend Cloudflare configurável sem dependência operacional.

## Arquitetura

```text
Desktop / mobile LAN / atalhos / código de barras
                     ↓
          preload IPC / API local
                     ↓
            Application Services
                     ↓
                  Domain
                     ↓
       Repositories / Services
                     ↓
             SQLite / Hardware
```

Em rede existe um único servidor autoritativo. Terminais e dispositivos móveis não recebem caminho do SQLite e não acessam o banco por SMB; usam somente a API local na LAN. O renderer Electron não possui acesso Node, SQL, filesystem ou serial genérico.

O `SaleService` permanece como fluxo canônico de venda. Estoque, caixa, impressão, auditoria e efeitos de domínio são compartilhados entre o Balcão e os módulos verticais. Eventos duráveis carregam as referências e snapshots históricos necessários para que retries não reconstruam a venda usando estado atual mutável.

Hardware físico fica atrás de `desktop/hardware-runtime.cjs`. Módulos reutilizáveis são vendorizados e fixados por commit em `vendor/artisys-modules.lock.json`, preservando build reproduzível sem depender de registry privado.

## Requisitos e desenvolvimento

- Node.js 22+;
- Windows x64 é o alvo de empacotamento comercial 2.0.1.

```bash
npm install
npm run start:desktop
```

Servidor standalone de desenvolvimento:

```bash
npm run start:server
```

## Perfis de implantação

O padrão é `server-terminal`. Para um terminal cliente, configure `PDV_DEPLOYMENT_PROFILE=terminal`, `PDV_SERVER_URL`, `PDV_TERMINAL_ID` e a credencial do terminal pareado.

O servidor desktop publica a LAN por padrão na porta 4174. `PDV_ENABLE_LAN=false` desabilita esse listener; `PDV_LAN_HOST` e `PDV_LAN_PORT` ajustam bind e porta.

A superfície da equipe usa `http://IP-DO-SERVIDOR:4174/mobile`; o cardápio do cliente usa o QR individual da mesa e abre `http://IP-DO-SERVIDOR:4174/m/:token`. Esse transporte HTTP é destinado somente a LAN confiável e não é apresentado como HTTPS ou exposição segura à internet. Em HTTPS ou localhost, a superfície da equipe registra manifest/service worker e pode operar como PWA conforme o suporte do navegador; em HTTP LAN continua sendo uma aplicação web comum.

## Telemetria opcional

A telemetria de produto e diagnóstico fica **desativada por padrão** e pode ser habilitada em `Configurações > Privacidade e diagnóstico`. O core continua funcionando integralmente sem internet ou Cloudflare.

O servidor autoritativo mantém uma fila SQLite limitada e envia eventos em background para um endpoint HTTPS configurável. Terminais LAN não recebem a credencial de ingestão e encaminham apenas eventos UI allowlisted pela API autenticada.

O backend Cloudflare opcional usa **Workers + Analytics Engine + D1**. Para provisionar automaticamente:

```bash
npm run telemetry:cloudflare:setup
```

Depois do deploy, configure explicitamente `PDV_TELEMETRY_ENDPOINT` com a URL exibida pelo script. Dados de cliente, CPF/CNPJ, e-mail, telefone, endereço, credenciais, XML/DANFE, dados de cartão, observações e texto livre não fazem parte do contrato de eventos.

Detalhes operacionais: `docs/operations/telemetry.md`.

## Hardware

A impressão padrão usa `PDV_PRINTER_MODE=electron`. Impressoras térmicas Epson/Star e interfaces seriais são suportadas por drivers locais explícitos. Balança e gaveta serial são opcionais e usam as configurações `PDV_SCALE_*` e `PDV_DRAWER_*`.

A E54.1 mantém simulação automatizada de impressora, balança, gaveta, leitor, COM, timeout, fragmentação, falha e recuperação. A matriz de compatibilidade usa três níveis:

- `PROTOCOL_VERIFIED`: protocolo/caminho validado automaticamente;
- `FIELD_VERIFIED`: fabricante/modelo físico testado com evidência;
- `UNTESTED_MODEL`: modelo específico ainda não testado fisicamente.

## Regra comercial fiscal e pagamentos

A distribuição comercial opera com documentos e impressão claramente identificados como **NÃO FISCAL**. NFC-e, NF-e, SAT, MFE, SEFAZ, certificado digital e provedores fiscais não fazem parte dos fluxos comerciais desta release.

Pagamentos são registrados manualmente no PDV. Não há dependência obrigatória de TEF, PinPad, adquirente, API bancária ou confirmação automática de PIX.

## Verificação e release

```bash
npm run docs:check
npm run verify
npm run verify:release
npm run qa:validate
npm run qa:web-surfaces
npm run qa:e2e:p0
npm run qa:e2e:tablet
npm run qa:e2e:semantic
npm run qa:artifact-semantic
npm run qa:multi-device -- --profile full
npm run dist:win
npm run release:manifest -- --output dist/release-manifest.json --artifact dist/ArtiSys-PDV-*-x64-Setup.exe
```

`docs:check` valida consistência entre README, versão e metadados de release. `verify` cobre testes unitários/de integração, lint e consistência; `verify:release` acrescenta verificações determinísticas de release. `qa:validate` só valida a configuração do harness.

O gate de UI combina `npm run qa:web-surfaces`, `npm run qa:e2e:p0`, `npm run qa:e2e:tablet` e `npm run qa:e2e:semantic`. O fluxo semântico simula entrada de leitor de código de barras, rejeita o código invertido, força duplo clique nas ações de finalização, gera um PDF real e valida seu texto extraído. `npm run qa:artifact-semantic` renderiza o QR local e exige que uma ferramenta open source o decodifique exatamente para o payload original. `npm run qa:multi-device -- --profile full` cobre idempotência, concorrência, queda/reinício do servidor LAN, recuperação e persistência. Screenshots e traces continuam somente como evidência; não existe comparação visual por baseline/pixel.

Os fluxos legados anteriores continuam aposentados. Novos cenários E2E devem partir da interface atual e verificar um resultado operacional útil antes de entrarem no gate.

Mudanças relevantes na `main` podem disparar `release-windows`, que executa os gates, gera o NSIS x64, valida os artefatos e publica a GitHub Release consumida pelo updater. Alterações somente em documentação/testes não precisam gerar um novo instalador.

## Documentação

### Operação

- `docs/operations/install-server.md`
- `docs/operations/install-terminal.md`
- `docs/operations/pairing.md`
- `docs/operations/cash-sales-returns.md`
- `docs/operations/backup-restore.md`
- `docs/operations/hardware-printing.md`
- `docs/operations/import.md`
- `docs/operations/diagnostics.md`
- `docs/operations/telemetry.md`
- `docs/operations/update.md`

### Arquitetura

- `docs/architecture/e30-e39-restaurant.md`
- `docs/architecture/e40-e47-verticals.md`
- `docs/architecture/catalog-parent-variants-kits-combos.md`
- `docs/superpowers/specs/2026-09-20-enterprise-depth-p0-design.md`

Detalhes de cada fluxo devem permanecer nos documentos específicos; o README serve como visão geral do produto e do estado atual da `main`.

## Regra de manutenção documental

`CONTRIBUTING.md` define como regra obrigatória que qualquer alteração de comportamento, arquitetura, operação, requisito, limitação ou release atualize a documentação correspondente **na mesma entrega**. Código atualizado com documentação desatualizada não é considerado uma entrega concluída.

## Limitações externas

Depois da ativação comercial inicial, venda, estoque, caixa, módulos opcionais, KDS, LAN, impressão local e integração serial não dependem de nuvem para a operação diária. O serviço de licenciamento é obrigatório para a liberação inicial e consulta de status; a telemetria Cloudflare continua opcional e sua indisponibilidade não altera o funcionamento diário. Hardware, firmware, cabo e driver específicos continuam sendo variáveis externas e precisam ser validados no ambiente real quando aplicável.

Um modelo físico não testado permanece `UNTESTED_MODEL`; famílias de integração validadas automaticamente podem ser `PROTOCOL_VERIFIED`; somente equipamento realmente conectado e validado com evidência passa a `FIELD_VERIFIED`.

Metadados completos de capacidades, limitações e matriz de compatibilidade ficam em `release/capabilities.json`, `release/limitations.json` e `release/hardware-compatibility.json`.

Veja [Operação local, pedidos e equipamentos](docs/operations/local-setup-and-food.md) para configuração, QR, reinstalação e recuperação sem nuvem.
