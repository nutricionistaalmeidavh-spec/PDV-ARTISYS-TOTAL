# Hardware e impressão

O PDV usa os módulos locais e reutilizáveis `@artisys/serialport` e `@artisys/printing`, fixados no repositório em `vendor/` com origem registrada em `vendor/artisys-modules.lock.json`. O núcleo não depende de SaaS, nuvem ou serviço pago.

## Leitor de código de barras

O modo padrão é **keyboard-wedge**: mantenha o foco no campo de busca do Balcão e configure o leitor para enviar Enter ao final do código quando possível. A E54.1 executa repetidamente buscas por código de barras e entradas inválidas para validar o caminho de leitura sem depender de SDK proprietário.

## Balança

Configure pela tela **Configurações > Periféricos > Balança** sempre que possível. A seleção é persistida localmente em `hardware.json` dentro do `userData` do Electron e reaplicada no próximo início do PDV. Também continuam disponíveis, para implantação/diagnóstico avançado, `PDV_SCALE_PORT`, `PDV_SCALE_PROFILE`, `PDV_SCALE_BAUD`, `PDV_SCALE_COMMAND`, `PDV_SCALE_TIMEOUT_MS` e `PDV_SCALE_SETTLE_MS`.

`PDV_SCALE_SETTLE_MS` define uma pequena janela de silêncio, padrão de 30 ms, antes de interpretar a resposta acumulada. Isso evita aceitar prematuramente um fragmento como `1.` quando a continuação `250 kg` chega logo depois. O timeout total continua sendo controlado separadamente por `PDV_SCALE_TIMEOUT_MS`.

A leitura passa pelo transporte e adapter do `@artisys/serialport`; a UI recebe somente peso normalizado em kg, nunca uma porta serial genérica.

### Urano US 31/2 POP-S

Selecione o perfil **Urano US 31/2 POP-S** e a porta COM. O perfil fixa a comunicação serial em **9600 bps, 8 bits, sem paridade, 2 stop bits (8N2)** e usa o parser dedicado aos frames Urano POP-S. O comando de leitura padrão é `0x04`; `0x05` pode ser selecionado explicitamente quando necessário. O usuário não precisa configurar baud rate, paridade ou stop bits manualmente.

O parser dedicado reconhece o peso líquido nos layouts USE-P2/USE-CB2 cobertos pelos testes e rejeita payloads genéricos/incompletos em vez de adivinhar um número. O runtime pode aplicar ou trocar a configuração sem reiniciar o Electron, e **Salvar e testar** executa uma leitura imediatamente após a configuração.

Até existir evidência de teste com uma unidade física, a implementação comprova o caminho de software/protocolo e o modelo deve continuar marcado como `UNTESTED_MODEL`, não `FIELD_VERIFIED`.

## Gaveta

Para gaveta serial, use **Configurações > Impressão e periféricos > Gaveta**: detecte as portas, selecione a porta serial e a velocidade do equipamento, salve e use **Salvar e testar** para enviar o pulso de abertura. A seleção é persistida em `hardware.json` e reaplicada no próximo início. `PDV_DRAWER_PORT` e `PDV_DRAWER_BAUD` permanecem disponíveis apenas para implantação/diagnóstico avançado. O comando padrão usa o pulso ESC/POS do módulo compartilhado. Abertura por impressora térmica pode ser habilitada com `PDV_PRINTER_OPEN_DRAWER=true` quando o driver suportar.

A E54.1 simula desconexão durante o pulso, garante o fechamento controlado da porta e valida que uma tentativa posterior consegue abrir a gaveta sem reiniciar o PDV.

## Impressão

`PDV_PRINTER_MODE` aceita somente:

- `electron` — padrão, usa a impressão nativa do Electron/Windows;
- `thermal` — usa o driver térmico local; exige `PDV_PRINTER_TYPE=epson|star` e `PDV_PRINTER_INTERFACE`;
- `serial` — usa o transporte serial local; exige `PDV_PRINTER_PORT` e aceita `PDV_PRINTER_BAUD`.

Opções comuns: `PDV_PRINTER_NAME`, `PDV_PRINT_SILENT`, `PDV_RECEIPT_WIDTH=32|42|48`, `PDV_PRINTER_CUT` e `PDV_PRINTER_TIMEOUT_MS`. Um modo inválido ou incompleto falha explicitamente no startup; não existe fallback silencioso entre drivers, evitando impressão duplicada.

A impressão continua usando a fila persistente do PDV. Vendas geram jobs de comprovante; falhas ficam como `FAILED` e podem voltar à fila por **Tentar novamente**. Reimpressão cria uma nova tentativa auditável sem alterar a venda original.

### Dados da loja no cupom não fiscal

Em **Configurações > Dados da loja e cupom não fiscal**, o estabelecimento pode definir nome da empresa, endereço, telefone e logo. Os dados são persistidos localmente nas configurações globais do PDV; campos vazios são omitidos do comprovante.

A logo aceita PNG, JPG/JPEG ou WebP na seleção da interface e é convertida localmente para PNG antes de ser salva. O arquivo é redimensionado para uso no comprovante e não depende de CDN, upload externo ou serviço pago.

No momento em que a venda gera o job de impressão, o texto e a logo configurados são copiados para o payload persistente desse job. Por isso, uma reimpressão mantém a identidade visual registrada naquele comprovante, mesmo que a configuração da loja seja alterada depois.

O caminho Electron renderiza a logo acima do texto do comprovante. O caminho térmico envia a imagem quando o driver da impressora oferece suporte; sem suporte a imagem, o conteúdo textual do cupom continua preservado.

## E54.1 — validação automatizada sem equipamento físico

A suíte obrigatória de CI valida, por simulação:

- falha de escrita serial e reconexão sem reiniciar o PDV;
- porta COM ocupada ou inexistente e recuperação em tentativa posterior;
- respostas de balança com ponto/vírgula, fragmentação, lixo, timeout e nova tentativa;
- protocolo Urano POP-S com perfil 9600/8N2, comandos binários e frames USE-P2/USE-CB2;
- Epson/Star com texto acentuado, corte, pulso de gaveta e larguras 32/42/48;
- spooler Windows/Electron retornando offline e impressão posterior bem-sucedida;
- leitor `keyboard-wedge` sob leituras repetidas e códigos inválidos;
- ciclos repetidos de abertura/escrita/fechamento de serial para detectar porta presa;
- comando binário da gaveta e recuperação após falha.

Esses testes comprovam o **comportamento do protocolo e do software**, não a eletrônica, o firmware ou o driver de um modelo físico específico.

## Estados de compatibilidade

- `PROTOCOL_VERIFIED` — protocolo/caminho de integração coberto por teste automatizado reproduzível;
- `FIELD_VERIFIED` — fabricante/modelo físico realmente testado, com evidência registrada;
- `UNTESTED_MODEL` — modelo físico específico ainda não testado, mesmo que use um protocolo já validado;
- `PARTIAL` — funcionamento conhecido com limitações documentadas;
- `UNSUPPORTED` — não suportado pela versão atual.

Nunca promova um equipamento para `FIELD_VERIFIED` apenas porque o protocolo passou na CI.

## Validação e suporte no estabelecimento

Quando surgir o primeiro equipamento real de um cliente, use **Configurações > Hardware/Diagnóstico** para identificar porta, driver e status e executar teste de impressão, balança ou gaveta. Registre fabricante, modelo, conexão, SO/configuração, resultado e evidência.

Se um equipamento falhar, o pacote de diagnóstico deve orientar o suporte a coletar pelo menos: fabricante/modelo, tipo de conexão, driver instalado, porta/interface, baud rate quando serial, erro retornado e resultado do teste. Com isso, a correção tende a ser um perfil/comando/driver específico, sem alterar o núcleo de vendas.

Um modelo só deve ser anunciado como fisicamente homologado depois desse teste real documentado. Sem teste físico, use `UNTESTED_MODEL`; quando o protocolo correspondente está coberto pela E54.1, ele pode simultaneamente ter uma família de integração `PROTOCOL_VERIFIED` na matriz de release.