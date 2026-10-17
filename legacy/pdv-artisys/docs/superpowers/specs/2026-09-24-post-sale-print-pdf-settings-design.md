# Pós-venda, impressão, PDF e configuração de impressora

**Data:** 2026-09-24

## Objetivo

Evoluir o fluxo de finalização do ArtiSys PDV para que, após a venda ser concluída com sucesso, o operador veja uma etapa explícita de pós-venda com as ações **Imprimir** e **Salvar PDF** lado a lado. A exportação para PDF deve funcionar sem depender de impressora PDF instalada no Windows, sem SaaS, sem internet e sem serviço pago. A configuração de impressão deve ser persistente e editável dentro do próprio ArtiSys.

Esta entrega preserva a regra central já existente: a venda concluída é canônica e não pode ser revertida por falha de impressão, falha de PDF ou ausência de hardware.

## Estado atual

- O checkout finaliza via `completeCurrentSale()` e, após `api.completeSale(...)`, fecha o modal, limpa o estado local, mostra um toast e renderiza novamente o balcão.
- `sale.completed` já é persistido e utilizado por efeitos pós-commit, incluindo a fila de impressão.
- `print_jobs` já representa a fila persistente/auditável de comprovantes.
- O driver Electron atual usa `webContents.print(...)`.
- A configuração de impressão ainda depende fortemente de variáveis de ambiente (`PDV_PRINTER_NAME`, `PDV_RECEIPT_WIDTH`, `PDV_PRINT_SILENT`, etc.).
- O core de configurações já possui `app_settings` persistente e auditado, com escrita global autorizada para `admin`, `manager` e `system`.
- O runner E2E já possui ações de UI e validações visuais/textuais, mas não possui uma asserção específica para arquivo gerado em disco.

## Escopo funcional

### 1. Pós-venda explícito

Ao concluir o pagamento com sucesso, o checkout não volta silenciosamente ao estado vazio. Em vez disso, apresenta um modal ou painel de sucesso vinculado à venda concluída.

Conteúdo mínimo:

- número da venda;
- total;
- troco, quando houver;
- estado de conclusão;
- botão **Imprimir**;
- botão **Salvar PDF** imediatamente ao lado de **Imprimir**;
- ação **Iniciar nova venda** ou **Fechar**.

A ação de pós-venda opera sobre um snapshot da venda concluída, não sobre o estado mutável da próxima venda.

### 2. Botões Imprimir e Salvar PDF

Os dois botões devem ter a mesma hierarquia visual e permanecer visíveis na mesma superfície de pós-venda.

Requisitos:

- `Imprimir` usa o comprovante canônico da venda concluída;
- `Salvar PDF` usa o mesmo conteúdo canônico;
- salvar PDF não depende de impressora física nem virtual;
- ausência/falha de impressora não desabilita `Salvar PDF`;
- falha/cancelamento do PDF não altera a venda;
- clique posterior em `Imprimir` continua permitido após salvar PDF;
- ações repetidas não duplicam efeitos de estoque, caixa ou venda.

### 3. Geração nativa de PDF

Implementar geração de PDF no processo principal Electron usando `webContents.printToPDF()` sobre uma janela oculta e conteúdo HTML derivado do mesmo comprovante usado para impressão.

Fluxo:

```text
renderer
  -> preload API estreita
  -> IPC main
  -> resolve venda/comprovante canônico
  -> render HTML seguro
  -> webContents.printToPDF()
  -> dialog.showSaveDialog()
  -> fs.writeFile()
```

Regras:

- nome sugerido: `Venda-<numero>-<AAAA-MM-DD>.pdf`;
- sanitizar nome do arquivo;
- diretório é escolhido pelo usuário via `showSaveDialog()`;
- cancelar o diálogo retorna estado `cancelled`, sem toast de erro;
- falha ao renderizar/escrever retorna erro operacional claro;
- nunca escrever em caminho arbitrário recebido diretamente do renderer;
- renderer não recebe acesso genérico a filesystem;
- nenhuma dependência paga ou serviço externo.

### 4. Conteúdo canônico do comprovante

Impressão e PDF devem derivar da mesma representação de domínio. O objetivo é impedir divergência entre o que foi impresso e o que foi salvo.

Conteúdo mínimo quando disponível:

- identificação da loja;
- logo/branding;
- número da venda;
- data/hora;
- operador e vendedor;
- cliente;
- itens;
- quantidade;
- valor unitário;
- descontos;
- subtotal;
- total;
- formas de pagamento;
- troco;
- observação da venda quando marcada para impressão;
- indicação de documento não fiscal quando aplicável.

A implementação deve reutilizar `receipt-renderer`, `receipt-branding` e/ou a camada equivalente existente, evitando um segundo template comercial independente.

## Configuração de impressão

### 5. Configurações persistentes

Adicionar configuração persistente no `SettingsService`, usando `app_settings`, preferencialmente em chaves com prefixo `printing.`.

Chaves propostas:

- `printing.deviceName`
- `printing.paperMm`
- `printing.columns`
- `printing.columnsMode`
- `printing.autoPrint`
- `printing.showSystemDialog`
- `printing.cut`
- `printing.openDrawerAfterPrint`

Valores iniciais devem preservar compatibilidade com a configuração existente via ambiente. Regra de precedência:

1. configuração persistida em `app_settings`;
2. variáveis de ambiente legadas como fallback;
3. defaults atuais.

Isso evita quebrar instalações existentes.

### 6. Papel e largura lógica

Opções de papel expostas na UI:

- 58 mm
- 80 mm

Modo automático:

- 58 mm -> 32 colunas
- 80 mm -> 48 colunas

Modo avançado/manual:

- 32
- 42
- 48 colunas

A largura física deve ser propagada para a renderização/impressão do Electron quando tecnicamente suportado, sem depender exclusivamente da preferência do driver do Windows.

### 7. Impressoras instaladas

Adicionar bridge estreita para listar impressoras via `webContents.getPrintersAsync()` no processo Electron.

Retorno sanitizado ao renderer:

```js
[
  {
    name,
    displayName,
    isDefault,
    status
  }
]
```

Não expor objetos nativos completos ou campos desnecessários.

Se nenhuma impressora estiver instalada:

- UI mostra estado claro de indisponibilidade;
- `Testar impressão` e `Imprimir` ficam indisponíveis ou retornam erro operacional controlado;
- `Salvar PDF` continua disponível.

### 8. UI Configurações > Impressão

Adicionar uma seção própria em Configurações com:

- seletor de impressora;
- papel 58/80 mm;
- largura automática/manual;
- seletor 32/42/48 quando manual;
- impressão automática;
- mostrar diálogo do Windows;
- corte automático;
- abrir gaveta após impressão;
- botão `Salvar configurações`;
- botão `Testar impressão`;
- estado/diagnóstico da impressora selecionada.

Permissões:

- somente `admin` e `manager` alteram configuração global;
- caixa pode visualizar estado, mas não alterar configuração global.

## Integração com a fila de impressão

### 9. Preservar `print_jobs`

A fila persistente continua sendo a fonte auditável para tentativas de impressão.

Regras:

- concluir venda não pode depender do sucesso da impressora;
- `sale.completed` continua gerando o comprovante/job de forma idempotente;
- `Imprimir` no pós-venda deve disparar a tentativa ligada ao comprovante da venda concluída, sem criar nova venda nem reaplicar efeitos;
- reimpressão histórica continua auditável;
- configuração de impressão deve ser resolvida no momento da tentativa, exceto branding/conteúdo que já possua snapshot histórico quando aplicável.

### 10. Impressão automática

`printing.autoPrint=false` será o comportamento padrão para novas instalações desta funcionalidade, evitando impressão silenciosa inesperada.

Quando `true`:

- a venda continua sendo concluída primeiro;
- a impressão ocorre como efeito pós-venda;
- o modal de pós-venda ainda mostra `Imprimir` e `Salvar PDF`;
- falha automática aparece como estado operacional, sem bloquear a conclusão;
- não repetir automaticamente em loop sem controle da fila.

## IPC e segurança

### 11. APIs estreitas propostas

Preload:

```js
window.pdv.hardware.listPrinters()
window.pdv.hardware.getPrinterSettings()
window.pdv.hardware.savePrinterSettings(input)
window.pdv.hardware.testPrinter()
window.pdv.receipts.printSale(saleId)
window.pdv.receipts.saveSalePdf(saleId)
```

Nomes finais podem seguir os namespaces já existentes, mas devem permanecer estreitos.

Restrições:

- renderer nunca recebe `fs`;
- renderer nunca escolhe caminho bruto para escrita;
- `saleId` é validado no processo/serviço responsável;
- só vendas concluídas podem ser exportadas pelo fluxo de pós-venda;
- HTML usado no PDF passa pelas mesmas regras de sanitização do driver Electron atual ou por sanitização equivalente;
- nenhuma URL remota, script remoto ou recurso externo é necessário.

## Compatibilidade

### 12. Windows e linha Legacy

A feature deve ser implementada sem dependências nativas novas além das já existentes no Electron/Node do produto.

Critérios:

- funcionar no instalador principal suportado;
- manter possibilidade de backport para a linha Legacy;
- não depender de `Microsoft Print to PDF`;
- não depender de APIs exclusivas do Windows moderno quando já houver equivalente em Electron;
- testes de compatibilidade de código devem evitar sintaxe/API que a runtime da linha Legacy não suporte sem fallback.

A homologação física da impressora continua separada da prova automatizada de software.

## Estratégia de testes

### 13. Unitários

Adicionar cobertura para:

- resolução de configuração persistida > ambiente > default;
- 58 mm -> 32 colunas;
- 80 mm -> 48 colunas;
- manual 32/42/48;
- rejeição de papel/largura inválidos;
- sanitização de nome do PDF;
- geração de nome `Venda-...pdf`;
- cancelamento de `showSaveDialog`;
- erro de `printToPDF`;
- erro de escrita;
- listagem sanitizada de impressoras;
- ausência de impressoras;
- permissões de escrita das configurações;
- impressão/PDF não alteram venda, estoque ou caixa.

### 14. Integração

Cobrir com fakes de Electron:

- `BrowserWindow` oculto;
- `webContents.print`;
- `webContents.printToPDF`;
- `webContents.getPrintersAsync`;
- `dialog.showSaveDialog`;
- `fs.writeFile` injetável/mocado;
- persistência real em SQLite para `app_settings`;
- reinicialização do serviço e releitura das configurações.

### 15. E2E principal pós-venda

Fluxo completo:

```text
criar/usar produto
-> abrir caixa
-> iniciar venda
-> adicionar produto
-> finalizar
-> configurar pagamento
-> confirmar pagamento
-> aguardar painel/modal de venda concluída
-> validar número/total
-> validar Imprimir visível
-> validar Salvar PDF visível
-> validar ambos lado a lado
-> salvar PDF em diretório temporário controlado pelo QA
-> validar arquivo existente
-> validar tamanho > 0
-> validar header %PDF-
-> iniciar nova venda
-> validar que a venda anterior permanece concluída
```

### 16. E2E sem impressora

Executar com adapter/fake retornando lista de impressoras vazia:

- concluir venda;
- mostrar venda finalizada;
- `Salvar PDF` disponível;
- `Imprimir` indisponível ou erro controlado;
- salvar PDF real;
- venda permanece concluída.

### 17. E2E configurações

Fluxo:

```text
Configurações
-> Impressão
-> selecionar impressora simulada POS80
-> selecionar 80 mm
-> salvar
-> sair e voltar
-> validar valores
-> reiniciar app/contexto QA
-> validar persistência
-> testar impressão
```

Variante adicional:

```text
58 mm -> automático -> 32 colunas
80 mm -> automático -> 48 colunas
manual -> 42 colunas
```

### 18. E2E falhas

Cenários obrigatórios:

- impressora falha após venda concluída;
- `printToPDF` falha;
- escrita de arquivo falha;
- usuário cancela Save As;
- impressora indisponível e PDF disponível;
- salvar PDF e depois imprimir;
- imprimir e depois salvar PDF;
- múltiplos cliques não duplicam efeitos comerciais.

### 19. Extensão do ArtiSys QA

Adicionar ação `expectFile` ao runner, ou capability equivalente, com suporte a:

```json
{
  "action": "expectFile",
  "path": "...",
  "minBytes": 100,
  "startsWith": "%PDF-"
}
```

Para evitar permitir leitura arbitrária em flows, o caminho deve ficar restrito ao diretório temporário/output controlado pelo runner ou ser validado por capability do adapter.

Adicionar, se necessário, capability para controlar `SaveDialog` em E2E Electron e devolver um caminho temporário determinístico.

## Observabilidade e UX de erro

### 20. Mensagens

Exemplos:

- `Comprovante enviado para POS80 Printer.`
- `PDF salvo com sucesso.`
- `Salvamento cancelado.`
- `Nenhuma impressora configurada.`
- `Falha ao imprimir. A venda continua concluída.`
- `Falha ao salvar PDF. A venda continua concluída.`

Nunca comunicar falha de venda quando somente impressão/PDF falhar.

### 21. Estados concorrentes

Durante a ação:

- desabilitar temporariamente o botão correspondente;
- evitar duplo clique simultâneo;
- permitir que `Imprimir` e `Salvar PDF` sejam usados independentemente após a conclusão de uma ação;
- manter referência ao `completedSaleId` até o operador iniciar nova venda ou fechar a superfície.

## Não objetivos

Fora deste escopo:

- editar PDF após geração;
- enviar PDF por WhatsApp/email;
- armazenamento em nuvem;
- assinatura digital de PDF;
- converter documento não fiscal em documento fiscal;
- alterar regra fiscal de NFC-e/NF-e;
- homologação física automática de modelos específicos de impressora;
- substituir o driver do fabricante da impressora.

## Arquivos/áreas esperadas

Áreas prováveis de alteração:

- `desktop/renderer/app.js`
- estilos do checkout/modal de pós-venda
- `desktop/preload.cjs`
- `desktop/main.cjs` e/ou bridge dedicado para receipt/PDF
- `desktop/hardware-runtime.cjs`
- `vendor/artisys-printing/src/drivers/electron-printer.js`
- `vendor/artisys-printing/src/printer-profile.js`
- `js/core/settings/settings-service.js` somente se forem necessários validadores/helpers específicos; preferir reutilizar o serviço atual
- `js/domains/printing/*`
- rotas/API de settings já existentes
- UI de Configurações/Hardware
- `qa/runtime/src/steps.js`
- novos flows em `qa/flows/`
- testes em `test/`
- `docs/operations/hardware-printing.md`
- documentação de arquitetura/release correspondente

O desenho final de arquivos deve ser refinado no plano de implementação após inspeção completa de rotas e módulos existentes.

## Ordem de implementação

1. caracterização e testes RED do comportamento atual;
2. serviço/resolução persistente das configurações;
3. listagem de impressoras;
4. UI de configurações;
5. geração nativa de PDF;
6. pós-venda explícito com Imprimir + Salvar PDF lado a lado;
7. integração com fila/reimpressão;
8. extensão do QA para validar arquivo;
9. E2E de sucesso;
10. E2E sem impressora e falhas;
11. regressão completa;
12. documentação e release gates.

## Critérios de aceite

A entrega só é considerada pronta quando todos forem verdadeiros:

1. venda concluída mostra superfície explícita de pós-venda;
2. `Imprimir` e `Salvar PDF` aparecem lado a lado;
3. PDF é gerado localmente sem impressora PDF instalada;
4. PDF começa por `%PDF-` e possui conteúdo não vazio no E2E;
5. ausência/falha da impressora não impede PDF;
6. falha/cancelamento do PDF não altera a venda;
7. configuração de impressora e papel é editável no ArtiSys;
8. configuração persiste após reinício;
9. 58 mm automático resolve 32 colunas;
10. 80 mm automático resolve 48 colunas;
11. reimpressão/fila permanecem auditáveis;
12. nenhuma ação de impressão/PDF duplica venda, estoque ou caixa;
13. `npm test` passa;
14. `npm run verify` passa;
15. `npm run qa:full` passa;
16. `npm run qa:release` passa;
17. documentação operacional e release notes estão sincronizadas.

## Decisões explícitas

- Core 100% local/self-hosted/open source; nenhum serviço pago obrigatório.
- PDF será nativo do Electron, não via impressora virtual.
- `Salvar PDF` usa `Salvar como...` e não grava silenciosamente em uma pasta.
- `Salvar PDF` fica ao lado de `Imprimir` na conclusão da compra.
- Impressão e PDF são efeitos pós-venda e nunca condição para concluir a venda.
- A mudança de impressão/PDF permanece em branch separada da correção do scanner de código de barras.