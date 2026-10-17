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
