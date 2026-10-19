# Periféricos na versão web — contrato e homologação

A implementação opera no navegador do terminal e, quando selecionado, em um **conector local open source** restrito ao `127.0.0.1`. A venda, produtos, estoque e caixa continuam canônicos na API Node.js + SQLite self-hosted **ou** Workers/D1 opcional. Nenhum Worker remoto pode controlar diretamente portas seriais da loja. O conector local não cria um segundo backend comercial.

## Operação gratuita

1. Abra **Balcão → Dispositivos locais** no Chrome/Edge desktop servido por HTTPS. As opções são locais ao navegador (sem segredos, sem venda offline).
2. **Impressão:** escolha o diálogo nativo (Windows/macOS/Linux). Clique em **Imprimir comprovante** depois da venda. Use a impressora instalada no SO, escolhendo papel 58/80 mm conforme o driver. Para PDF, use **Salvar como PDF** no diálogo.
3. **Leitor de código de barras:** leitor HID que funciona como teclado, foco em **Buscar produto** (F2). Não requer driver de integração na nuvem.
4. **Balança serial genérica:** selecione perfil, velocidade e **Conectar balança** (permissão explícita Web Serial). Use **Ler balança** ao adicionar item por peso. Peso inválido, resposta incompleta e desconexão não fabricam leitura; informe peso manualmente onde a regra de negócio permitir.
5. **Gaveta serial:** **Conectar gaveta → Abrir gaveta**, com ESC/POS apenas em modelo explicitamente compatível. Não abre automaticamente por venda sem consentimento.
6. **Impressora serial:** modo ESC/POS opcional e experimental, com **Conectar impressora serial**. Comandos de corte só são enviados na opção local correspondente.

Nenhum comando de periférico é emitido por alteração de banco ou job em background; impressão local requer ação humana e escolha do navegador. O navegador não fornece retorno confiável de sucesso físico do spooler. Não registrar como "impresso" com base apenas na abertura do diálogo.

## Personalização de comprovante (cap-030)

Em **Balcão → Dispositivos locais** há campos de nome da loja, endereço e telefone e importação de **PNG de até 512 KB**, com assinatura de arquivo validada. A identidade é persistida na **API autoritativa por empresa/filial** com `settings.manage`. A migração `0027_r3_receipt_branding.sql` congela a marca no mesmo commit da conclusão da venda; a reimpressão recebe a identidade original mesmo após editar o cadastro. O HTML/PDF inclui logo PNG. O caminho WebSerial **ESC/POS GS v 0** rasteriza PNG limitado a 384px (papel 58mm) ou 576px (80mm), com altura de até 192px, e usa CP850 para acentos. O conector local/driver de texto do spooler continua sem rasterização e deve ser tratado explicitamente como limitação específica de transporte, sem exigir instalação no SaaS. O checkout web também oferece **Pré-conta não fiscal**, sem concluir a venda. A migração deve ser aplicada no D1 remoto antes de habilitar esse fluxo no ambiente.

## Compatibilidade

| Caminho | Estado |
|---|---|
| Chrome/Edge desktop HTTPS: diálogo de impressão e PDF | Implementado; teste de spooler depende do equipamento |
| Chrome/Edge desktop HTTPS: Web Serial genérico | Implementado; requer permissão e quadro de peso válido |
| USB teclado/HID scanner | Compatível pelo campo de busca já existente |
| ESC/POS serial (impressora/gaveta) | Adaptador genérico, modelos físicos não homologados |
| Urano US31/2 POP-S com protocolo 9600/8N2 e 0x04/0x05 | Parser de quadros USE-P2/USE-CB2 migrado e coberto por testes; sem homologação com equipamento físico |
| Safari/iOS/Firefox sem Web Serial | Entrada manual; sem acesso direto serial |
| Térmica USB driver do SO | Pelo diálogo de impressão; impressão silenciosa fora do escopo |
| Conector local de impressão com fila persistente, reenvio controlado e spooler do SO | **Implementado parcialmente** em `tools/local-hardware-bridge/`; não garante saída física nem paridade universal de drivers |
| Fiscal NFC-e/NF-e e TEF | Não implementados neste adaptador de periféricos |

A fonte versionada de status, ambientes e provas automatizadas é [`docs/parity/hardware-compatibility.json`](parity/hardware-compatibility.json). `PROTOCOL_VERIFIED` significa somente contrato emulado; `FIELD_VERIFIED` exigiria evidência real por modelo/firmware e atualmente **nenhum modelo foi declarado testado fisicamente**.

## Próxima etapa de paridade total

- **Aprimorar e certificar** o conector local open source/self-hosted já existente em `tools/local-hardware-bridge/`: autenticação por terminal, bind loopback, fila SQLite e estados `PENDING`, `SUBMITTING`, `SUBMITTED`, `FAILED` e `UNCERTAIN` já estão documentados. A identidade canônica, snapshot imutável e rasterização ESC/POS WebSerial foram implementados e testados. Avaliar futuramente rasterização do PNG no driver de texto do spooler do sistema operacional, somente com uma interface que a suporte e sem falsificar confirmação de impressão física. Não assumir impressão física ao obter aceitação do spooler.
- Validar leitura em equipamento Urano físico; o parser foi portado com reconhecimento de frames e testes automatizados, mas compatibilidade física permanece não homologada.
- Projetar job canônico tenant/filial/terminal com idempotência e tentativas auditáveis no D1; impedir impressão duplicada ao repetir a venda, sem inventar impressão enviada.
- Homologar equipamento físico com fabricante/modelo/firmware, 58/80 mm, corte, gaveta, desconexão, replug, falha de driver, retomada e impressão concorrente.
- Só usar status FIELD_VERIFIED depois de teste real registrado. Os testes em CI provam somente o caminho de software.

## Verificação

Rodar a suíte existente \`npm run test\`, build \`npm run build\`, testes Workerd/D1 e QA Chromium da pipeline. O arquivo \`apps/api/test/peripherals-web.test.mjs\` cobre parsing, escaping do comprovante, isolamento local, diálogo e ausência de acesso serial sem autorização. Testar hardware físico em estação real separadamente. O Worker não pode testar automaticamente impressoras e balanças conectadas à loja.

O repositório PDV-ARTISYS antigo permanece intocado. Nenhum fornecedor pago é necessário no núcleo; Windows/driver são opções locais do cliente e não SaaS contratado.
