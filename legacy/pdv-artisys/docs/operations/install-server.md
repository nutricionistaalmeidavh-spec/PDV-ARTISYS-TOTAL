# Instalação — Servidor + Terminal

O perfil **server-terminal** é a instalação principal do ArtiSys PDV 1.0. Essa máquina mantém o SQLite autoritativo no `userData` do Electron, executa a API local e pode atender outros terminais pela LAN.

## Procedimento

1. Instale o pacote Windows x64 e abra o ArtiSys PDV.
2. Mantenha `PDV_DEPLOYMENT_PROFILE=server-terminal` — é o perfil padrão.
3. No primeiro uso, crie o administrador inicial.
4. Configure loja, terminal, caixa, impressão e periféricos em **Configurações**.
5. Para aceitar terminais remotos, mantenha a LAN habilitada e libere a porta TCP 4174 somente na rede local confiável. `PDV_LAN_HOST` e `PDV_LAN_PORT` podem alterar bind/porta.
6. Gere um código temporário de pareamento para cada terminal cliente.
7. Execute um backup manual e valide-o antes de colocar o caixa em produção.
8. Conclua o checklist de implantação; dependências externas de hardware, rede ou periféricos ausentes devem ficar como `BLOCKED_EXTERNAL`.

## Dados e atualização

O banco, backups, diagnósticos e credenciais protegidas ficam fora do diretório de instalação. Desinstalar ou atualizar o executável não deve apagar esses dados. Nunca compartilhe o arquivo SQLite por SMB/rede; somente a API do servidor pode acessar o banco.
