# Comprovante pós-venda: impressão e PDF

## Objetivo

Após a conclusão de uma venda, o PDV mantém a venda concluída como fato comercial e apresenta duas ações independentes:

- **Imprimir**: envia o comprovante para a impressora configurada no terminal/Windows.
- **Salvar PDF**: gera um PDF local com Electron e grava o arquivo escolhido pelo operador. Não depende de impressora física, de `Microsoft Print to PDF`, de internet ou de serviço pago.

Falha ou cancelamento em qualquer uma dessas ações não reabre nem desfaz a venda.

## Configuração de impressão

Em **Configurações > Impressão do comprovante** é possível definir:

- impressora do Windows;
- papel térmico de **58 mm** ou **80 mm**;
- colunas em modo automático ou manual;
- impressão automática após concluir a venda;
- exibição do diálogo do Windows;
- corte do papel;
- abertura da gaveta após impressão.

No modo automático, o PDV usa **32 colunas para 58 mm** e **48 colunas para 80 mm**. O modo manual continua permitindo 32, 42 ou 48 colunas.

As preferências são persistidas em `app_settings` e prevalecem sobre as variáveis de ambiente legadas. Instalações existentes preservam os defaults legados quando ainda não possuem preferências persistidas.

Somente perfis **administrador** e **gerente** podem alterar preferências globais. Operadores podem consultá-las.

## PDF local

O PDF é construído a partir da mesma projeção canônica de comprovante usada pela impressão, incluindo dados da venda e identidade visual permitida. O processo usa uma `BrowserWindow` oculta e `webContents.printToPDF()`.

O arquivo sugerido segue o formato:

`Venda-<numero>-<AAAA-MM-DD>.pdf`

Em execução normal, o usuário escolhe o destino com o diálogo nativo de salvamento. Em QA, `ARTISYS_QA_PDF_DIR` direciona o arquivo para um diretório controlado de evidências.

## Diagnóstico

Se nenhuma impressora do Windows for encontrada, a tela de configurações informa esse estado. **Salvar PDF continua disponível** no pós-venda.

A fila persistente `print_jobs` continua sendo usada para impressão automática/auditável. A ação manual de impressão do modal pós-venda é independente da conclusão comercial e retorna erro controlado caso a impressora esteja indisponível.

## Compatibilidade legada

As variáveis existentes continuam como fallback, incluindo `PDV_PRINTER_NAME`, `PDV_RECEIPT_WIDTH`, `PDV_AUTO_PRINT`, `PDV_PRINT_SILENT`, `PDV_PRINTER_CUT` e `PDV_PRINTER_OPEN_DRAWER`.
