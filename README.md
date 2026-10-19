# PDV Artisys Total — evolução SaaS do PDV ArtiSys

## Landing pública e entrada do produto

- `/`: apresentação do PDV Total com destaques para cardápio, mesas e cozinha, recursos de gestão e formulário de solicitação de conta.
- `/app/`: **renderer operacional existente**, login por e-mail e senha com sessão HttpOnly, tenant e filial canônicos. O app não foi duplicado.
- `/#cadastro`: abre o formulário público. `POST /api/v1/auth/register` cria, atomicamente, usuário, empresa e filial **pendentes**, sem acesso a vendas antes de uma aprovação explícita de empresa e vínculo.
- **Produção continua fechada por padrão**: `AUTH_ENABLED=false` e `REGISTRATION_ENABLED=false` no Wrangler. Publicar a landing não libera login ou cadastros. A ativação de login e cadastro é deliberada depois de validar proteção de abuso, moderação, termos, notificações e os gates comerciais.
- Sem provedores pagos e sem APIs externas obrigatórias; teste local: `npm run check:landing`. A identidade da marca e as prévias da landing não substituem telas operacionais reais.



**Produto principal: SaaS web/PWA por HTTPS**, acessível pelo navegador em PC, tablet e celular. **Não exige instalar executável, hospedar servidor no estabelecimento ou conectar terminais a uma LAN.** A API autoritativa fica no backend hospedado (Cloudflare Workers + D1 como opção da faixa gratuita), com autenticação, empresas/filiais e isolamento de dados. O modo Node/SQLite e HTTPS LAN é uma **alternativa self-hosted opcional**, não uma etapa para lançar o SaaS.

Este é o **único repositório ativo do produto PDV Total**. O repositório [PDV-ARTISYS](https://github.com/nutricionistaalmeidavh-spec/PDV-ARTISYS) permanece **intocado** e não é upstream de builds, deploys, licenças ou atualizações deste projeto.

## Estrutura do produto

- `packages/core/js/`: serviços **canônicos** de produtos, vendas, eventos, ledger de estoque, caixa, pagamentos, devoluções, restaurantes, relatórios e autorização, vindos do PDV original. Regras existentes são adaptadas, **não reimplementadas em paralelo**.
- `packages/core/server/`: contratos/rotas do servidor original usados **apenas como base de transição**, não publicados pela Cloudflare; rotas comerciais P3 usam a borda única `apps/api/src/commerce-router.mjs`, com idempotência e transações D1.
- `packages/core/shared/` e `packages/core/vendor/`: componentes de domínio e bibliotecas de apoio reutilizados; nenhuma segunda cópia dos arquivos originais.
- `apps/web/`: a **única interface de operação** transferida do renderer existente para transformação no navegador. Servida como assets do Worker na fase P3, com login web, produtos, estoque, caixa, vendas e histórico básico. Recursos restantes do Electron/IPC não são expostos no modo web.
- `apps/api/`: API autoritativa em Cloudflare Workers/D1 **ou** no Node + SQLite self-hosted; no modo local, entrega a **mesma PWA** do build sem Cloudflare. Já tem identidade, empresas, sessões e filiais, além do recorte P3 de produtos, estoque, caixa e vendas com D1 (`0002_commerce.sql`).
- `docs/`: migração, UX, limites de segurança e implantação.

**Não existe uma segunda árvore `legacy/` no código ativo**. O commit original importado e os 900 arquivos continuam auditáveis no histórico Git; instaladores, Electron, auto-update Windows/macOS, CI do desktop, licença desktop e artefatos específicos não são carregados aqui.

## Estado de implementação — panorama auditável (18/10/2026)

- **R1 — comercial e gestão:** 21/21 capacidades classificadas como `covered` no inventário, incluindo vendas, produtos, estoque, clientes, caixa, financeiro e relatórios; isso representa aceite de código, não homologação de produção.
- **R2 — alternativa self-hosted / LAN (não bloqueia o SaaS):** 11/14 `covered`, 3/14 `partial` na **matriz histórica de paridade desktop**. Os três itens `cap-001` (instalação Windows local), `cap-047` (mobile servido pela LAN local) e `cap-056` (perfil de instalação servidor/terminal) ficam explicitamente **fora da fila de entrega do SaaS hospedado**. A UI mobile web continua relevante e é verificada no navegador contra a API remota; não depende desses três itens. O código Node.js + SQLite + HTTPS LAN já existente fica preservado como opção de implantação.
- **R3 — periféricos:** 8/8 `covered`, 0/8 `partial`; `checkout-016` passou a `covered` na matriz das sete telas. No **SaaS hospedado** o backend D1 guarda identificação por empresa/filial e congela o snapshot na conclusão da venda (`0027_r3_receipt_branding.sql`). O mesmo renderizador canônico gera cupom, pré-conta de mesa, ticket de cozinha e fechamento de caixa, sem gerar segunda venda; histórico e reimpressão usam dados congelados. WebSerial HTTPS inclui CP850 para português, PNG raster ESC/POS e balança serial com reconexão sob gesto do operador. A fila KDS exige lease + confirmação do spooler pelo conector local **opcional**; fila de impressão não é prova de saída física do papel. Compatibilidade por protocolo comprovada em simulação: `docs/parity/hardware-compatibility.json`; nenhum equipamento físico específico foi declarado homologado. `cap-050` possui testes de software por protocolo; equipamento físico específico permanece sem homologação. Não há impressão fiscal.
- **R4 — alimentação e verticais:** 13/13 `covered`, 0/13 `partial` no escopo de software SaaS web. Mesas/comandas com CAS contra transferência concorrente, KDS e senhas, pizza e receitas, entrega/retirada, chamados de garçom/conta, onboarding de módulos, relatórios e CSV paginados. Rateio individual por item/pagador suporta recebimentos antecipados, estorno imutável antes do checkout e conciliação entre turnos sem duplicar venda, caixa ou estoque; a divisão deve ser salva antes de antecipar valores atribuídos a cada pagador.
- **PWA:** interface responsiva, manifest e cache de **assets públicos**. Em uma instalação self-hosted, **a loja pode operar sem Internet** enquanto o servidor HTTPS local estiver disponível na rede; Cloudflare não é requisito. **Não há venda offline se a API estiver inacessível**, nem fila independente de vendas no navegador.

**Situação comercial:** CI aprovada não comprova implantação, fiscal, segurança de ambiente ou uso por clientes. Antes de comercializar ou habilitar autenticação em uma implantação específica, validar provisionamento, migrations, TLS, credenciais, backups e jornadas críticas. Não assumir o valor atual de `AUTH_ENABLED` em produção sem conferir a configuração implantada.

**Limites explícitos:** cartão/PIX podem ser formas de pagamento registradas, não adquirência/TEF automática; NFC-e/NF-e não é emitida pelo adaptador; paridade completa de periféricos, restaurante e reconciliação bancária automática não está certificada. Equipamentos reais são verificação opcional posterior, não gate de aceite do código.

**Evidências exigidas para merge:** `npm run test` (núcleo + API), `npm run build` e `npm run check:web`, migrations no D1 local, dry-run Wrangler, testes Workerd e jornada Chromium incluindo caixa/financeiro/relatórios/PWA. Código do PDV Artisys original: não modificado.

## Segurança e canonicidade

1. **Uma fonte de verdade:** estoque por ledger, evento transacional, venda e caixa originais, sem gravação paralela no frontend nem efeitos repetidos.
2. **Por empresa:** identidade e autorização resolvidas pelo servidor a partir da sessão, sem confiar no tenant enviado por cliente.
3. **Sem renderização concorrente:** evoluir somente `apps/web` e preservar entradas, filtros, carrinho, scroll e estado durante efeitos assíncronos.
4. **Cloudflare isolada:** D1 e R2 novos, sem usar Worker, banco, dados ou licenças do PDV original.
5. **Core obrigatório R$ 0, open source e self-hosted** (Node.js + SQLite). Cloudflare/D1 e integrações pagas só como alternativas explícitas, sem dependências ocultas.
6. **Reestruturação incremental comprovada:** scripts `npm run test:core`, `npm run test:api` e dry-run Wrangler passam antes de cada merge.

## Execução self-hosted gratuita

**Desenvolvimento local:** com Node 22+ e SQLite, execute `npm run build` e, depois, `cd apps/api && npm run dev`; abra http://127.0.0.1:4175/. Não exponha HTTP local à rede.

**Operação da loja na LAN, sem Internet e sem Cloudflare:** provisione o SQLite, configure certificados TLS confiáveis, DNS local, firewall e autenticação, depois use `npm run serve:lan`. Os terminais autorizados acessam a mesma PWA em HTTPS e dependem da API local ativa para concluir vendas. Leia [o manual HTTPS LAN](docs/SELFHOST-LAN-HTTPS.md) e [o guia de periféricos locais](tools/local-hardware-bridge/README.md). Não há dependência paga no núcleo.

## Documentação

- [Roadmap vigente de paridade](docs/ROADMAP-PARIDADE-56.md)
- [Setup e deploy Cloudflare](docs/DEPLOY-CLOUDFLARE.md)
- [Proveniência do código original (histórica)](docs/IMPORT-MANIFEST.md)
- [Contrato de fluxo e experiência](docs/ux/P1-P2-CONTRATO-EXPERIENCIA.md)

## Entrega SaaS e auditoria histórica

A **fila principal de implementação** é a versão **web/SaaS hospedada**, e não os modos LAN/desktop. Na fotografia atual das 56 capacidades herdadas do desktop: **53 referências aplicáveis ao escopo web (53 `covered`, 0 `partial`, 0 `gap`)** e **3 itens opcionais/deferidos** de instalação/local-LAN (`cap-001`, `cap-047`, `cap-056`). Esses 53 são um filtro de referências herdadas — **não constituem o checklist completo de lançamento do SaaS**, que também exige autenticação, segurança, QA mobile, serviços e deploy operacional.

Os **56 IDs originais** continuam intactos para comparação/auditoria do desktop. Os **68 contratos de sete telas** são verificações internas, não outra lista de funcionalidades. `npm run report:saas` mostra **somente as pendências relevantes ao SaaS**; `npm run report:parity` mantém os 56 para auditoria, com a separação de escopo. Use `npm run report:parity` para visualizar os quatro estados: copiado integralmente, copiado parcialmente, não copiado/não demonstrado e implementado aguardando auditoria de código. **Atenção:** ausência de prova (`gap`) não significa necessariamente ausência de código.

- [Roadmap operacional vigente — SaaS prioritário, 56 referências auditáveis e opções LAN separadas](docs/ROADMAP-PARIDADE-56.md)
- [Auditoria R0 e execução R1 — diagnóstico dos 21 itens e testes de suspensão/retomada](docs/parity/R0-R1-EXECUTION-20261018.md)
- [R1 concluído no escopo de software — 21/21 capacidades com aceites executáveis](docs/parity/R1-SOFTWARE-ACCEPTANCE-20261018.md)
- Auditoria atualizada: `npm run audit:r0-r1` (56 capacidades e detalhamento dos 21 do R1, sem promoção automática de paridade).
- [Roadmap original de arquitetura/Cloudflare (histórico)](docs/ROADMAP-SAAS-CLOUDFLARE.md)

## Auditoria de paridade desktop/web

A matriz operacional em `docs/parity/desktop-web-matrix.json` verifica 68 contratos de sete telas e o inventário em `docs/parity/desktop-capability-inventory.json` cobre **todas as 56 capacidades publicadas** no manifesto `release/capabilities.json` do desktop original, fixado em `7efea9c`. A cópia verificável por SHA Git fica em `docs/parity/desktop-capabilities-baseline.json`. O escopo estendido não é prova de que todos os subfluxos já estejam catalogados ou equivalentes.

A paridade permanece **incompleta**. `npm run test:parity` executa testes de regressão do gate e valida links para as asserções dos testes Node/Chromium, a integridade de IDs, responsáveis, pré-requisitos e reivindicações; a CI executa os testes de domínio e E2E correspondentes. **Não** equiparar a existência de um arquivo a funcionalidade comprovada; testes automatizados de periféricos com simuladores e revisão independente de código demonstram conclusão de software; inspeção física é opcional e não bloqueia `covered`. Os estados `complete` só são aceitos com cobertura 100% do escopo e atestado rastreável de revisão/CI. Ver `docs/parity/P0-AUDIT-PLAN.md`.

## Auditoria de paridade do desktop

A paridade não é declarada automaticamente com build verde. A matriz de 68 contratos das telas e o inventário de 56 capacidades são independentes. O P0 gera cenários de comparação e artefatos auditáveis, preservando o código desktop fixado somente como referência. Use `npm run test:parity` para executar as verificações ou `npm run audit:parity` para gerar os relatórios em `qa-artifacts/parity/`. Cenários sem evidência permanecem pendentes, inclusive os que possuem testes parciais de API. Consulte `docs/parity/P0-AUDIT-PLAN.md`.

### HTTPS na rede local (P6, alternativa self-hosted gratuita e opcional)

A interface web pode usar a mesma API autoritativa em **Node.js + SQLite local** sem Cloudflare e sem mensalidade. A implantação LAN exige TLS com certificado confiável nos terminais, autenticação habilitada explicitamente, firewall de rede interna e banco novo com migrações rastreadas. Início: `npm run serve:lan` após configurar as variáveis da documentação.

- [Manual de instalação HTTPS LAN, provisionamento e recuperação](docs/SELFHOST-LAN-HTTPS.md)
- `apps/api/src/local-migrations.mjs`: migrações transacionais com checksum; banco antigo sem histórico exige migração assistida (sem replay perigoso).
- `apps/api/src/https-lan-server.mjs`: PWA e API na mesma origem HTTPS, cookies Secure, validação de Host e CSRF na API.
- `apps/api/test/https-lan-server.test.mjs`: teste real com TLS temporário e 3 contas em 2 empresas; é prova automatizada de integração, não ensaio presencial (que é opcional).
- A aplicação precisa da API local acessível para confirmar transações: PWA offline mantém apenas a casca pública, não vendas.


**Atualização da matriz (19/10/2026):** 53/53 capacidades da referência desktop aplicáveis ao SaaS web cobertas por aceites de software; R3: 8/8 e R4: 13/13. Restam três itens de instalação/LAN opcionais da referência histórica desktop e os gates de lançamento (segurança, ambiente hospedado, backup, QA e publicação). A divisão deve anteceder recebimentos vinculados a pagadores; estornos antes do checkout são imutáveis, e após o checkout seguem a reversão da venda canônica. **Não houve aplicação de migration em D1 remoto nem homologação de equipamento físico**, e nenhuma integração paga é obrigatória. Ver [aceite das sete frentes](docs/parity/R3-R4-SEVEN-SOFTWARE-ACCEPTANCE-20261019.md).

## SaaS multiempresa e segurança (P0 / 19-10-2026)

- Segurança de tenant, filiais e usuários verificada no backend, com testes de acesso por IDs alterados, perfis e sessões revogadas.
- Onboarding autenticado de novas empresas, filiais, convites de 48 horas com token único, usuário por convite e alterações de perfis com auditoria.
- Assinaturas e suspensão verificadas no Worker antes de mutações quando SAAS_ENTITLEMENTS_ENABLED=true, não por sinais da interface. Leitura ainda disponível para empresa suspensa.
- Plataforma possui bootstrap inicial único e concessões auditadas somente com PLATFORM_ADMIN_TOKEN privado, não enviado à PWA.
- Defesa adicional contra tentativas de login por IP verificado na borda Cloudflare. Nenhum X-Forwarded-For enviado pelo cliente é aceito.
- A Cloudflare inicializa também o schema 0031 antes do deploy. AUTH_ENABLED=false permanece até existir proprietário provisionado e testes em produção.
- Não há integração de cobrança online; os planos são inicialmente administrados pela ArtiSys.

Consulte docs/SAAS-SECURITY-OPERATIONS.md.
