# Correções ArtiSys 2.0.1

## Causa e comportamento corrigido

| Área | Antes / causa | Depois |
| --- | --- | --- |
| Alimentação | A navegação ainda registrava a tela Fast-food com criação de senha e fila separadas. Não era efeito do banco antigo. | Pedidos reúne balcão, retirada e entrega com venda e produção canônicas; senha opcional. A rota antiga encaminha à nova operação. Histórico legado preservado sem duplicar vendas. |
| Preparação | Verificações persistidas começavam pendentes e não refletiam automaticamente configuração já existente. O painel completo ocupava a página. | Card fechado abre ao clicar; configuração verificável é detectada; testes físicos permanecem manuais; itens opcionais aceitam Não se aplica. Não se presume que uma configuração salva prove hardware funcionando. |
| Reinstalação | O desinstalador mantém AppData; o papel já selecionado pulava a seleção inicial. | Aviso de instalação existente permite continuar ou revisar o papel após login. Nova loja exige autorização, confirmação e backup, preservando o banco anterior em arquivo. |
| Rede | Entrada manual de IP; descoberta inicial sem identidade estável; transição local→principal mantinha listener loopback. | Listener LAN correto; IP/porta automáticos; identidade mDNS persistente quando resolução confiável; atualização periódica e ao gerar QR; entrada manual nas opções avançadas. |
| Balança/gaveta | Ações disponíveis sem configuração; erro interno de IPC exposto. A configuração de balança só aparecia no painel antigo e gaveta dependia de variável de ambiente. | Portas e perfil configuráveis no painel atual, persistência local e mensagens claras; ações desabilitadas sem configuração. |
| Acesso | Ativação comercial interferia no primeiro acesso; recuperação dependia de serviço comercial. | Core local sem ativação comercial obrigatória, chave pessoal de recuperação offline, armazenada somente como hash e consumida uma vez. |

## Persistência Windows

O desktop resolve `app.getPath('userData')`, normalmente `%APPDATA%\pdv-artisys`:

- `pdv-artisys.sqlite`: usuários (`users.password_hash`/`password_salt`), dados da loja e configurações (`app_settings`), estado das verificações (`pilot_checks`) e operações.
- `data-server.json`: modo local/PC principal/terminal/servidor próprio, porta e seleção inicial; não armazena credencial do terminal em texto.
- `deployment.json`: parâmetros de inicialização, loja e terminal.
- `terminal-identity.json`: identidade persistente utilizada também no hostname mDNS.
- `terminal-credential.bin`: credencial de pareamento protegida pelo armazenamento seguro do Windows.
- `installation-review.json`: versão e assinatura do executável reconhecidas pelo usuário.
- `hardware.json`: configuração dos equipamentos; `backups/` e `installations/`: cópias e instalações anteriores.

O instalador tem `deleteAppDataOnUninstall:false`. Assim, desinstalar remove a aplicação e mantém os dados: o usuário e a senha anteriores continuam válidos. O desktop não usa ProgramData como caminho padrão deste banco/configuração. Uma execução de servidor independente pode usar paths explicitamente fornecidos ao seu runtime; isso não altera o padrão do desktop.

## Arquivos principais

- `desktop/renderer/vertical-modules.js`, `js/domains/delivery/delivery-service.js`, `js/core/database/food-order-migrations.js`: pedidos unificados e migração aditiva.
- `desktop/renderer/admin-ops.js`, `js/core/pilot/pilot-service.js`: card e diagnóstico contextual.
- `desktop/installation-lifecycle.cjs`, `desktop/main.cjs`, `desktop/renderer/app.js`, `desktop/renderer/settings-hub-ui.js`: instalação, revisão e arquivo seguro de dados.
- `desktop/public-network.cjs`, `desktop/lan-discovery.cjs`, `desktop/renderer/restaurant-public-ordering-ui.js`: descoberta, mDNS, DHCP e QR.
- `desktop/hardware-runtime.cjs`, `desktop/hardware-config-store.cjs`, `desktop/renderer/operational-pages.js`: equipamentos.
- `js/core/auth/local-recovery-service.js`, `server/password-recovery-router.js`, `desktop/renderer/first-access-ui.js`: recuperação offline e primeiro acesso.

## Validação

Suíte completa: 948 testes aprovados; release: 19 testes aprovados. Verificações adicionais incluem descoberta/filtragem, identidade mDNS e mudança DHCP, onboarding/reinstalação, backup real de SQLite, acesso e recuperação, layout da checklist, sintaxe e paridade de capacidades.

QA em Electron com dados isolados confirmou configuração de hardware, erro serial traduzido, recuperação até novo login, card fechado/aberto, revisão de instalação, mudança de modo pela interface e acesso HTTP pelo IP real da LAN. Equipamentos físicos não estavam conectados. Nenhum dado da instalação de uso foi alterado.

O nome `.local` é preferido somente quando publicado e resolvido para a LAN correta. Multicast bloqueado ou clientes sem mDNS exigem fallback por IP; QR físico com IP não pode ser atualizado remotamente. Para imprimir nesse cenário, reserve o IP no roteador. A validação no PC não substitui verificar o QR em um celular na rede da loja.

Core R$0, self-hosted, open source e sem serviço externo obrigatório.
