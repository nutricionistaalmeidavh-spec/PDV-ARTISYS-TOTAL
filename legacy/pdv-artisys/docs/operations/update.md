# Atualização do ArtiSys PDV

A atualização do executável é separada dos dados do cliente. Banco, backups e configuração ficam no diretório de dados do usuário e não são substituídos pelo instalador.

## Atualização automática — Windows moderno

A partir da linha 1.4, o instalador moderno usa `electron-updater`. Ao iniciar, o ArtiSys PDV verifica automaticamente se existe uma versão estável mais nova publicada.

Quando houver atualização:

1. o sistema exibe a nova versão disponível;
2. o operador escolhe **Baixar agora**;
3. o download ocorre sem exigir reinstalação manual;
4. ao concluir, o operador escolhe **Atualizar e reiniciar**;
5. o aplicativo reinicia já na nova versão.

O download não é automático: a decisão continua com o operador. O banco de dados e os arquivos persistentes do cliente não são apagados pela atualização.

Cada merge relevante na `main` dispara o pipeline Windows. O pipeline resolve uma versão de patch superior à última release publicada, executa `verify:release`, gera e testa o instalador, valida `latest.yml` e o blockmap e só então publica a GitHub Release consumida pelo updater. Alterações apenas em documentação/testes que não afetam o pacote não geram uma release nova.

## Procedimento manual / recuperação

Use instalação manual quando o updater não estiver disponível ou quando for necessário recuperar uma instalação:

1. Encerre vendas e feche o caixa quando operacionalmente possível.
2. Crie e valide um backup manual.
3. Feche o ArtiSys PDV em servidor e terminais.
4. Instale a nova versão Windows sobre a instalação existente.
5. Inicie primeiro a máquina **Servidor + Terminal**. As migrations incrementais e não destrutivas são aplicadas automaticamente.
6. Confira health/schema, abra o sistema e execute um smoke de login, consulta de produtos e venda controlada.
7. Atualize os terminais clientes para versão compatível e valide o handshake LAN.

## Windows 7/8 Legacy — descontinuado

A linha de instaladores Windows 7/8 Legacy foi encerrada após a versão 1.4.1. Versões posteriores não geram, validam nem publicam instaladores Legacy x64 ou ia32.

Os artefatos Legacy já publicados permanecem apenas como histórico e não fazem parte do fluxo de release atual. O instalador oficial das novas versões é o Windows x64 moderno, produzido por `npm run dist:win`.

Referências internas a “legacy” usadas para migração, compatibilidade de dados, estados históricos ou exportação não significam manutenção de um instalador Windows Legacy.

## Rollback

Se a nova versão não puder operar, preserve os arquivos atuais, reinstale a versão anterior compatível e restaure o último backup validado somente quando necessário. Nunca apague/reset o banco apenas porque a versão do aplicativo mudou.
