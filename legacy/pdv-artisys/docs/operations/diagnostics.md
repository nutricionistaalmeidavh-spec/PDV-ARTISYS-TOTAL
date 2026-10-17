# Diagnóstico e suporte

A tela **Configurações > Diagnóstico e suporte** reúne sinais operacionais sem expor segredos.

## Health

O health autenticado informa versão/schema, banco, outbox pendente, terminais, fila de impressão e último backup. Use-o primeiro quando houver falha de operação ou de rede.

## Logs e auditoria

Logs locais são estruturados por nível/subsistema/correlação/terminal. Senhas, tokens, authorization headers e outros campos sensíveis são sanitizados antes da persistência. A auditoria é somente leitura e registra ações privilegiadas e alterações operacionais relevantes.

## Pacote de diagnóstico

Administradores podem gerar um ZIP contendo manifesto do sistema, versões, health snapshot, migrations, configuração pública e logs sanitizados. Por padrão o pacote **não inclui** banco SQLite, senhas, credenciais LAN nem outros segredos operacionais.

Ao enviar o pacote ao suporte, confirme a data/hora do problema e o terminal afetado para facilitar a correlação.
