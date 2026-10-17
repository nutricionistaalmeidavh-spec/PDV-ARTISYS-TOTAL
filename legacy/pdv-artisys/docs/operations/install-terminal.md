# Instalação — Terminal de rede

O terminal executa a interface e os adaptadores locais de hardware, mas usa o PC principal como fonte autoritativa dos dados. O usuário não configura credenciais técnicas nem ativa uma segunda licença comercial.

## Procedimento

1. No **PC principal**, entre com um usuário autorizado e abra **Configurações > Unidades e dispositivos**.
2. Em **Computador principal e terminais**, escolha **Adicionar terminal**.
3. O ArtiSys mostra um código temporário de 6 dígitos, válido por poucos minutos e utilizável uma única vez.
4. No computador novo, instale o mesmo pacote Windows x64 e abra o ArtiSys.
5. Escolha **Conectar a uma instalação existente**.
6. O ArtiSys procura automaticamente PCs principais disponíveis na mesma rede. Selecione a loja encontrada, informe o código temporário e um nome amigável para o computador. Endereço manual fica em **Configuração avançada** apenas para redes que bloqueiam descoberta local.
7. O Electron gera uma identidade local estável, envia o código ao PC principal selecionado e recebe uma credencial exclusiva do terminal.
8. A credencial permanente é guardada pelo `safeStorage` do sistema operacional e não aparece na interface nem no `data-server.json`.
9. Depois do pareamento, o terminal reinicia e mostra somente o login dos usuários locais já cadastrados no PC principal.

O terminal não pede novamente e-mail de contratação, código de ativação comercial ou criação do administrador principal.

Se o PC principal ficar indisponível, o terminal não confirma vendas, caixa ou outras mutações compartilhadas. Não existe fallback silencioso para um banco local.

## Bloqueio e reativação

No PC principal, um usuário com permissão de dispositivos pode bloquear ou reativar um terminal já pareado. O bloqueio interrompe novos acessos daquele terminal sem apagar histórico operacional.
