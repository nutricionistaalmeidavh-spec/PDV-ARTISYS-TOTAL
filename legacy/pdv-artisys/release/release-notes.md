# ArtiSys PDV — operação e configuração local

> **Regra comercial atual:** a distribuição oficial exige ativação por e-mail + código antes do primeiro uso ou do login de uma instalação ainda não ativada. Depois da liberação, a operação diária permanece local/LAN e pode continuar offline conforme o último status conhecido da licença.

- Pedidos de balcão, retirada e entrega usam a mesma venda e produção. Senha diária é opcional e considera o fuso da loja.
- A fila mostra pedidos ativos; concluídos e senhas legadas permanecem no histórico com data.
- A preparação da loja fica em um card recolhido de Diagnóstico e backup; confirmações físicas continuam manuais.
- Balança e gaveta serial têm configuração visível e persistida; operações sem configuração são desabilitadas e mensagens orientam a correção.
- QR detecta o endereço do PC principal, usa a porta configurada e testa a resposta do servidor. O celular ainda precisa estar na mesma rede e ter acesso permitido pelo firewall.
- Atualização/reinstalação informa a presença de dados anteriores. Uma nova loja exige confirmação e backup íntegro; dados anteriores são arquivados.
- Recuperação de senha local usa chave de uso único. A distribuição oficial exige ativação comercial por e-mail + código antes do uso; depois de ativado, o core e os dados operacionais continuam locais.

Equipamentos físicos precisam ser testados na loja. A gaveta suportada usa adaptador serial ESC/POS; seleção de impressora Windows sozinha não comprova suporte ao pulso de gaveta.

Instalador oficial: `ArtiSys-PDV-${RELEASE_VERSION}-x64-Setup.exe`. O workflow de release publica o instalador e os metadados do updater automaticamente após todos os gates.

---

# ArtiSys PDV 1.4.1 — Estabilidade de navegação e instalador corrigido

Patch da linha 1.4 que corrige corridas assíncronas de renderização capazes de redesenhar uma rota antiga sobre a tela atual, apagar campos já preenchidos ou desfazer submódulos válidos de Configurações.

## Correções de estabilidade

- callbacks assíncronos de Produtos só redesenham a tela quando Produtos continua sendo a rota ativa;
- rotas operacionais usam um marcador compartilhado para impedir commits tardios depois que o operador navegou para outro módulo;
- Relatórios descarta resultados assíncronos obsoletos antes de substituir a interface;
- o estabilizador de rota preserva subpáginas válidas de Configurações, incluindo Pizzaria e outros módulos verticais;
- fechamento de modais permanece centralizado para evitar handlers duplicados e cliques inconsistentes.

## Validação

- suíte `release` validada com **19/19 flows** aprovados e zero falhas;
- E2E compacto de checkout e exceções UX aprovados;
- V1 consolidada sem emissão fiscal integrada; comprovantes e fluxos de impressão permanecem explicitamente NÃO FISCAIS;
- builds Legacy para Windows 7/8 validadas em x64 e ia32;
- instalador Windows x64 moderno continua sujeito ao smoke test do workflow de release antes da publicação.

## Empacotamento

O instalador moderno desta release é:

`ArtiSys-PDV-1.4.1-x64-Setup.exe`

Os instaladores Legacy desta release histórica usam os nomes `ArtiSys-PDV-1.4.1-Legacy-x64-Setup.exe` e `ArtiSys-PDV-1.4.1-Legacy-ia32-Setup.exe`.

> **Encerramento da linha Legacy:** os builds Legacy acima pertencem à versão 1.4.1. A partir das versões seguintes, o pipeline e os instaladores Windows 7/8 Legacy foram retirados. Somente o instalador Windows x64 moderno permanece no fluxo oficial de release.

## Regras preservadas

O sistema continua **local-first**: SQLite autoritativo no servidor local, terminais/dispositivos pela API LAN, EventBus/outbox para efeitos derivados e `SaleService` como motor canônico de vendas. Não há SaaS, nuvem ou assinatura obrigatória para a operação diária.

---

# ArtiSys PDV 1.3.2 — Observação de venda e cupom não fiscal

Patch local-first sobre a 1.3.1 que adiciona observação vinculada à venda e ao cliente sem alterar o motor canônico de venda, estoque, caixa ou EventBus.

## Observação da venda

- o Balcão passa a aceitar uma observação por venda;
- a observação interna aceita até **500 caracteres** e fica persistida junto da venda no SQLite;
- quando a venda possui cliente, a observação permanece consultável no mesmo histórico vinculado à venda/cliente;
- a impressão no cupom não fiscal é **opcional** e fica desmarcada por padrão;
- ao habilitar a impressão, o texto é limitado a **120 caracteres** e no máximo **4 linhas**;
- o renderer respeita as larguras térmicas de **32, 42 e 48 colunas**;
- reimpressões usam a observação persistida da venda, sem depender de cache do renderer;
- a falha de impressão continua não desfazendo a conclusão da venda.

## Empacotamento

O produto permanece `ArtiSys PDV`, Windows x64, com instalador NSIS. O artefato desta release é:

`ArtiSys-PDV-1.3.2-x64-Setup.exe`

A versão 1.3.1 permanece como release anterior e não deve ser sobrescrita no histórico de distribuição.

## Regras comerciais preservadas

O sistema continua **local-first**: SQLite autoritativo no servidor local, terminais/dispositivos pela API LAN, EventBus/outbox para efeitos derivados e `SaleService` como motor canônico de vendas.

Os fluxos comerciais usam **pagamentos manuais** e documentos explicitamente **NÃO FISCAL**. Não há TEF, gateway bancário, confirmação automática de PIX, SaaS ou internet obrigatória para a operação diária.

A interface mobile continua self-hosted em `http://IP-DO-SERVIDOR:4174/mobile`, destinada somente à LAN confiável; a versão 1.3.2 não declara HTTPS nem PWA instalável.

---

# ArtiSys PDV 1.3.1 — Hardware Simulation QA

Patch local-first que reforça a E54 sem exigir compra prévia de periféricos. A versão 1.3.1 adiciona uma suíte automatizada de simulação para elevar a confiança em impressoras, balanças, gavetas e leitores antes do primeiro teste físico em cliente.

## E54.1 — Hardware Simulation QA

- transporte serial entra em estado de erro em falha de escrita/dreno e consegue reconstruir a porta em tentativa posterior;
- porta COM ocupada ou inexistente falha de forma controlada e pode ser reaberta quando o ambiente volta ao normal;
- respostas de balança fragmentadas aguardam uma pequena janela de silêncio antes de serem interpretadas;
- balança cobre ponto/vírgula decimal, resposta inválida, timeout e nova tentativa;
- drivers térmicos Epson/Star são simulados com acentos, corte, pulso de gaveta e larguras 32/42/48;
- impressão Electron/Windows cobre spooler offline seguido de recuperação;
- leitor de código no modo `keyboard-wedge` passa por leituras repetidas e entradas inválidas;
- transporte serial passa por ciclos repetidos de abrir/escrever/fechar para detectar porta presa;
- a matriz de compatibilidade passa a separar `PROTOCOL_VERIFIED`, `FIELD_VERIFIED` e `UNTESTED_MODEL`.

## Significado comercial da compatibilidade

`PROTOCOL_VERIFIED` significa que a família de integração foi validada automaticamente pelo software. Não significa que todos os modelos físicos que usam esse protocolo foram testados.

`FIELD_VERIFIED` é reservado para fabricante/modelo realmente testado em equipamento físico, com evidência registrada. Um modelo ainda não testado usa `UNTESTED_MODEL`, mesmo quando o protocolo correspondente já está `PROTOCOL_VERIFIED`.

Isso permite vender com uma afirmação tecnicamente correta, por exemplo: **compatível por protocolo com impressão Epson/Star/Windows e periféricos seriais suportados; modelos específicos podem exigir configuração de driver, porta, baud rate ou comando.**

## Arquitetura e regras preservadas

O sistema continua **local-first**: SQLite autoritativo no servidor local, terminais/dispositivos pela API LAN, EventBus/outbox para efeitos derivados e `SaleService` como único motor canônico de vendas.

Os fluxos comerciais usam **pagamentos manuais** e documentos explicitamente **NÃO FISCAL**. Não há TEF, gateway bancário, confirmação automática de PIX, SaaS ou internet obrigatória para a operação diária.

A interface mobile continua self-hosted em `http://IP-DO-SERVIDOR:4174/mobile`, destinada somente à LAN confiável; a versão 1.3.1 não declara HTTPS nem PWA instalável.

O schema avança de **v8 para v9** apenas para migrar a classificação de evidências de hardware. A migração é aditiva/preservadora: `VERIFIED` legado vira `FIELD_VERIFIED` e `BLOCKED_EXTERNAL` legado vira `UNTESTED_MODEL`, mantendo os demais dados e evidências.
