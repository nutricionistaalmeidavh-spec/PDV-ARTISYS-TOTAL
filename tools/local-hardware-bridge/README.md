# PDV Total — conector local gratuito de impressão

Componente **opcional** do terminal, não um segundo backend de vendas. 100% local e open source, sem assinatura, API paga ou serviços de terceiros. A venda permanece canônica no PDV Total/D1. O navegador apenas transmite o comprovante de uma venda autenticada/concluída a um serviço no próprio PC.

## Preparação da estação

Requisitos: Node.js 22 ou posterior e impressora instalada no sistema operacional. Em Linux/macOS a impressão usa CUPS e o comando nativo \`lp\`; no Windows usa PowerShell e \`Out-Printer\`. Impressoras térmicas podem exigir configuração do driver/papel 58 ou 80 mm no sistema operacional. Não existe impressão fiscal aqui.

No PowerShell (Windows), dentro do repositório:

\`\`\`powershell
$env:PDV_BRIDGE_ORIGIN="https://SEU-DOMINIO-DO-PDV"
$env:PDV_BRIDGE_PRINTER="NOME EXATO DA IMPRESSORA"
node --experimental-sqlite tools/local-hardware-bridge/main.mjs
\`\`\`

Em Linux/macOS:

\`\`\`bash
PDV_BRIDGE_ORIGIN=https://SEU-DOMINIO-DO-PDV PDV_BRIDGE_PRINTER="NOME_DA_FILA_CUPS" node --experimental-sqlite tools/local-hardware-bridge/main.mjs
\`\`\`

Sem \`PDV_BRIDGE_PRINTER\`, usa a impressora padrão do sistema. O terminal imprime um código aleatório de pareamento de 64 caracteres. Copie-o em **Balcão → Dispositivos locais**, selecione **Conector local (sem diálogo)**, clique **Conectar serviço local** e salve. A origem HTTPS deve corresponder exatamente ao domínio usado no navegador; não permita origens de terceiros.

Para gaveta serial opcional no Windows, configure também \`PDV_BRIDGE_DRAWER_PORT=COM3\` (substitua pela COM confirmada). Em Linux, configure um dispositivo local permitido como \`/dev/ttyUSB0\`. O pulso ESC/POS só deve ser enviado para gavetas comprovadamente compatíveis.

## Fila persistente SQLite

A fila e chave local ficam em \`~/.pdv-total-bridge/\` (ou na pasta definida por \`PDV_BRIDGE_HOME\`). A origem não precisa acessar nem guardar tokens de sessão do PDV. A chave do conector fica no sessionStorage do navegador, não no D1.

- \`PENDING\`: aceito, ainda sem submissão ao spooler.
- \`SUBMITTING\`: tentativa em andamento.
- \`SUBMITTED\`: o comando foi aceito pelo spooler do sistema. **Não** garante impressão física.
- \`FAILED\`: erro confirmado. Na tela **Consultar fila**, o operador pode usar **Tentar novamente**.
- \`UNCERTAIN\`: interrupção durante envio; nunca reenvia automaticamente, pois isso poderia duplicar uma impressão. Exige conferência humana e emissão intencional de nova via.

O identificador da impressão é derivado do ID da venda. Repetir uma chamada com mesmo ID/documento não manda uma segunda cópia. Não há fallback automático de driver nem reimpressão silenciosa por renovação de página.

## Segurança

Serviço escuta somente \`127.0.0.1:8765\`, exige origem HTTPS exata, cabeçalho Bearer com segredo aleatório local, rejeita comandos arbitrários e valida corpo e host para mitigar DNS rebinding. Nunca abra esse serviço no roteador, libere a porta para a LAN ou salve a chave de pareamento no Worker/Cloudflare.

O navegador em HTTPS pode solicitar permissão de acesso à rede local dependendo de sua versão. Se o navegador bloquear, configure o terminal com o Chrome/Edge atualizado e autorize explicitamente o acesso local, sem desabilitar as proteções gerais do navegador.

## Pesagem online

- Cadastrar o produto com unidade **KG** e preço em centavos por quilograma.
- Na venda, informar peso em **gramas inteiras**, manualmente ou via Web Serial (Chrome/Edge desktop HTTPS), com Urano POP-S e genericamente onde compatível.
- A API canônica converte \`grams/1000\` em quantidade KG usando cálculo do domínio original, estoca/precifica uma única vez e registra a origem da pesagem na mutação auditável.
- Tentativas duplicadas com mesmo identificador de mutação não somam peso duas vezes.
- A prova de origem \`SCALE\` indica apenas o fluxo utilizado; não é atestado criptográfico nem substitui teste físico.

## Matriz obrigatória de homologação física (a executar por estabelecimento)

Registrar modelo/fabricante, sistema operacional, driver, USB/COM e configuração do equipamento; testar impressão em 58/80 mm, acentos, corte, desligamento, replug, porta ocupada, falta de papel, reinício durante a impressão, fila FAILED, fila UNCERTAIN e reenvio manual. Para balanças, validar pesos conhecidos (incluindo 1,250 kg) e unidade em balança real; testar quadro incompleto e timeout. Para gaveta, medir abertura no pulso e reação a cabo desconectado. Somente então classificar como FIELD_VERIFIED.

**Limitação intencional:** a CI simula protocolo e spooler, não possui impressora, balança ou gaveta física. Nenhuma homologação física foi declarada. Impressão via driver do SO não significa garantia de suporte a todos os comandos de corte/ESC-POS.


## Fase 3 — Windows sem digitar chave

A versão Windows pode ser compilada gratuitamente com GitHub Actions, usando Node.js 22 e Inno Setup:
\`.github/workflows/bridge-windows-installer.yml\`.
O artefato \`PDVTotalBridgeSetup.exe\` inclui o runtime Node e todos os scripts locais. Na instalação por usuário, informe a **origem HTTPS exata** do PDV (somente esquema + domínio + porta, sem \`/app\`). A opção de iniciar com o Windows cria um atalho na pasta de inicialização do usuário. Não há assinatura paga nem serviços externos de impressão.

No navegador do **mesmo computador**: **Configurações → Impressão e periféricos → Impressora → Conector local → Autorizar neste computador**. Confirme **Sim** na janela de segurança exibida no Windows. A API local retorna a credencial apenas depois desse consentimento; o navegador a guarda na sessão. Se a aba for fechada e a sessão for perdida, confirme novamente. O campo de 64 caracteres permanece somente como opção técnica para instalações legadas.

A detecção de impressoras Windows permite selecionar uma fila instalada ou utilizar a padrão. A escolha é protegida por autorização e persistida no computador; o servidor rejeita nomes não presentes na enumeração do Windows. O conector continua ouvindo apenas em \`127.0.0.1:8765\` e validando origem, Host e Bearer. **Não exponha essa porta à rede.** No celular, utilize a impressão nativa; enviar a uma impressora de outro PC exige um recurso futuro específico de rede autorizada.

## Fase 4 — emissão, fila e recuperação

O modo **Imprimir automaticamente após a conclusão da venda** somente se aplica ao conector local pareado. O fluxo consulta o comprovante imutável da API e envia o documento da **venda concluída**; não substitui o registro canônico da venda nem o caixa.

A fila SQLite usa IDs idempotentes para a primeira via. Reabrir o pedido/recarregar a página não reenvia a mesma via silenciosamente. O botão **Reimprimir comprovante** é uma ação explícita com novo identificador. Em **Consultar fila**, estados são visíveis: pendente, enviando, aceito pelo spooler, falhou ou resultado incerto. Apenas \`FAILED\` permite **Tentar novamente**; \`UNCERTAIN\` exige inspeção humana antes de qualquer nova via. A indicação \`SUBMITTED\` confirma somente que o sistema operacional aceitou o trabalho — **não** que o papel saiu.

Pedidos de cozinha mantêm o contrato atual de ticket não fiscal, documento da API, claim/ack autorizado e ID fixo contra duplicações. A impressão em rede/serviço remoto não foi habilitada nesta etapa.

### Homologação e limites

Build e testes automatizados verificam código, fila, autorização, cenários simulados e renderização; não são homologação de impressora física. Antes de produção, conferir 58/80 mm, nome correto da fila, impressão após venda, pré-conta, ticket de cozinha, perda de rede, falta de papel, desligamento, religamento e tentativa manual após falha. O instalador Windows gerado via CI não é assinado digitalmente.


## Fase 5 — impressão de comprovante pelo celular em um PC autorizado

O celular continua podendo usar a **impressão nativa do navegador**, sem instalar conector. A alternativa **Enviar para o PC** aparece ao concluir uma venda somente se houver impressoras remotas cadastradas para a filial.

No computador Windows que possui a impressora e o conector gratuito: abra **Configurações → Impressora → Conector local**, autorize o conector local e escolha **Autorizar recebimento de outros terminais**. Um usuário com \`settings.manage\` registra o PC para **a filial selecionada**. O PDV entrega uma credencial forte diretamente ao conector via localhost; ela não aparece na tela nem é guardada no D1 em texto simples.

Em outro terminal (inclusive iPhone/Android), escolha o PC da lista em **Venda concluída → Enviar para o PC**. A API consulta a venda **concluída** e gera o comprovante com o snapshot original da marca. Não aceita texto arbitrário ou venda aberta. O computador consulta o servidor de 8 em 8 segundos por HTTPS **de saída**; nenhuma porta na LAN é exposta. Funciona com a mesma API autenticada em implantação SaaS ou servidor local HTTPS que suporte os endpoints.

**PC desligado:** pedido fica como \`PENDING\`. Quando o conector autenticado retorna, entrega uma vez à fila SQLite local. A resposta \`SUBMITTED\` diz apenas que o spooler recebeu o trabalho. **Desconexão durante envio:** a reserva expira para \`UNCERTAIN\`, sem repetição automática. O operador deve verificar a impressora antes de solicitar uma nova via explícita. \`FAILED\` igualmente não é reenviado automaticamente; o operador pode solicitar uma nova via após avaliar a falha.

**Administração:** cada PC é vinculado a uma empresa e filial, pode ser revogado, e não recebe tarefas de outras empresas/filiais. O histórico remoto da filial pode ser consultado; nenhum segredo de PC é incluído em listagens. Mantenha HTTPS e instale a migração aditiva \`0043_print_relay.sql\` antes de ativar o recurso em produção.

## Fase 6 — verificação e evidências

O fluxo CI executa testes SQLite reais de autorização por empresa/filial, permissões, idempotência de primeira via, reserva atômica, confirmação e revogação; testes do conector para job inválido e falha de spool; build Windows e testes Playwright desktop/mobile com prints em \`qa-artifacts/mobile-print-relay/\`. Nenhum teste de CI declara impressão física. Homologação de modelos USB/ESC-POS, papel, corte, Windows em máquinas reais e PWA iOS continua necessária antes de indicar suporte físico universal.
