# Backup e restauração

O servidor é o único processo que manipula o banco SQLite e também é responsável pelos backups.

## Backup

Em **Configurações > Backup**, crie um snapshot manual antes de mudanças importantes. Cada backup possui manifesto, versão do app/schema, tamanho e SHA-256. Use **Validar** para executar checksum e verificação SQLite antes de considerar o arquivo recuperável.

A retenção remove apenas snapshots antigos conforme a política configurada e preserva os mais recentes válidos.

## Restore

1. Selecione e valide o backup.
2. Solicite **Preparar restore** como administrador.
3. O sistema registra a intenção; a troca não acontece durante uma operação de caixa.
4. Feche/reinicie o servidor de forma controlada.
5. No próximo início, o sistema cria uma cópia de segurança do banco atual, valida o candidato e substitui o banco de forma atômica.
6. Após abrir, confira `system/health`, schema e uma venda/consulta de teste.

Backup corrompido ou incompatível é rejeitado sem sobrescrever o banco ativo. Atualizações nunca devem resetar o banco por mudança de versão.
