# Pareamento de terminais

O servidor autoriza cada terminal de rede individualmente. A credencial do usuário e a credencial do terminal são controles distintos.

## Fluxo canônico

1. Um usuário autorizado no PC principal gera um código temporário em **Configurações > Unidades e dispositivos**.
2. O código tem 6 dígitos, expira e só pode ser usado uma vez.
3. No computador novo, o usuário escolhe **Conectar a uma instalação existente**. O ArtiSys procura automaticamente PCs principais na mesma rede; o usuário seleciona a instalação encontrada e informa somente:
   - código temporário;
   - nome deste computador.
   Se a rede bloquear descoberta local, **Configuração avançada** permite informar o endereço manualmente.
4. O Electron gera automaticamente a identidade da instalação do terminal e envia código, identificação, nome, fingerprint local e versão do app.
5. O servidor registra o terminal e devolve uma credencial exclusiva.
6. A credencial permanente é guardada no `safeStorage` do sistema operacional. O renderer não recebe nem exibe essa credencial.
7. Nas conexões seguintes, o processo principal do Electron injeta a identidade/credencial do terminal; só então o usuário local faz login.
8. O servidor valida versão mínima, status `ACTIVE|BLOCKED` e sessão do usuário.

## Licença

O terminal herda a autorização da instalação principal. Parear um caixa, cozinha, balcão ou totem não cria uma nova ativação comercial e não pede novamente o e-mail do proprietário.

## Autoridade sobre a implantação

O primeiro pareamento por código é público somente enquanto o código temporário for válido. Depois que uma instalação está configurada, mudar o papel do computador, a origem dos dados ou o acesso LAN exige a capability `deployment.manage`.

## Bloqueio

Um usuário autorizado pode marcar um terminal como `BLOCKED`. O bloqueio invalida acessos daquele terminal sem apagar histórico de vendas, caixa ou auditoria. A reativação restaura o acesso com a mesma identidade.
