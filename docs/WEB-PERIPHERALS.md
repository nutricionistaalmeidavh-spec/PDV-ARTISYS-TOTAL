# Periféricos na versão web — contrato e homologação

Esta implementação opera **no navegador do terminal**: a API Cloudflare/D1 mantém a venda, produtos, estoque e caixa canônicos. O acesso físico ao hardware não pertence ao Worker e não tem API remota capaz de abrir gavetas ou portas seriais da loja.

## Operação gratuita

1. Abra **Balcão → Dispositivos locais** no Chrome/Edge desktop servido por HTTPS. As opções são locais ao navegador (sem segredos, sem venda offline).
2. **Impressão:** escolha o diálogo nativo (Windows/macOS/Linux). Clique em **Imprimir comprovante** depois da venda. Use a impressora instalada no SO, escolhendo papel 58/80 mm conforme o driver. Para PDF, use **Salvar como PDF** no diálogo.
3. **Leitor de código de barras:** leitor HID que funciona como teclado, foco em **Buscar produto** (F2). Não requer driver de integração na nuvem.
4. **Balança serial genérica:** selecione perfil, velocidade e **Conectar balança** (permissão explícita Web Serial). Use **Ler balança** ao adicionar item por peso. Peso inválido, resposta incompleta e desconexão não fabricam leitura; informe peso manualmente onde a regra de negócio permitir.
5. **Gaveta serial:** **Conectar gaveta → Abrir gaveta**, com ESC/POS apenas em modelo explicitamente compatível. Não abre automaticamente por venda sem consentimento.
6. **Impressora serial:** modo ESC/POS opcional e experimental, com **Conectar impressora serial**. Comandos de corte só são enviados na opção local correspondente.

Nenhum comando de periférico é emitido por alteração de banco ou job em background; impressão local requer ação humana e escolha do navegador. O navegador não fornece retorno confiável de sucesso físico do spooler. Não registrar como "impresso" com base apenas na abertura do diálogo.

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
| Impressão silenciosa, filas de jobs com retry persistente, seleção programática de impressora | Exigem **agente local opcional**, nunca simular por Cloudflare |
| Fiscal NFC-e/NF-e e TEF | Não implementados neste adaptador de periféricos |

## Próxima etapa de paridade total

- Criar agente local open source/self-hosted **opcional**, pareado por terminal com lista restrita de comandos e autenticação, sem porta pública na LAN, compatível com adaptadores existentes; eliminar duplicação e reportar resultado real do spooler.
- Validar leitura em equipamento Urano físico; o parser foi portado com reconhecimento de frames e testes automatizados, mas compatibilidade física permanece não homologada.
- Projetar job canônico tenant/filial/terminal com idempotência e tentativas auditáveis no D1; impedir impressão duplicada ao repetir a venda, sem inventar impressão enviada.
- Homologar equipamento físico com fabricante/modelo/firmware, 58/80 mm, corte, gaveta, desconexão, replug, falha de driver, retomada e impressão concorrente.
- Só usar status FIELD_VERIFIED depois de teste real registrado. Os testes em CI provam somente o caminho de software.

## Verificação

Rodar a suíte existente \`npm run test\`, build \`npm run build\`, testes Workerd/D1 e QA Chromium da pipeline. O arquivo \`apps/api/test/peripherals-web.test.mjs\` cobre parsing, escaping do comprovante, isolamento local, diálogo e ausência de acesso serial sem autorização. Testar hardware físico em estação real separadamente. O Worker não pode testar automaticamente impressoras e balanças conectadas à loja.

O repositório PDV-ARTISYS antigo permanece intocado. Nenhum fornecedor pago é necessário no núcleo; Windows/driver são opções locais do cliente e não SaaS contratado.
