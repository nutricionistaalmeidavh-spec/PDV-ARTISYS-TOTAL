# Operação local, pedidos e equipamentos

## Dados e reinstalação

O desktop usa `%APPDATA%\pdv-artisys` (Electron userData). Banco, backups e configurações são preservados pelo desinstalador. Atualizar mantém a loja e os usuários; a senha permanece como hash e salt no banco SQLite.

Após detectar dados existentes e uma mudança de versão ou do executável, o aplicativo oferece continuar ou revisar o papel do computador depois do login. Configurações → Unidades e dispositivos permite trabalhar sozinho ou atender terminais como PC principal. Uma máquina com dados não troca silenciosamente para um servidor externo.

Iniciar outra loja exige administrador autorizado, confirmação NOVA LOJA e backup íntegro. O servidor é encerrado, o banco é fechado e os arquivos da implantação são arquivados em `installations/` dentro do userData. O backup fica em `backups/`. Hardware permanece configurado. Nenhum registro operacional é apagado pelo procedimento.

## Recuperação sem internet

No primeiro acesso, copie ou salve a chave entregue antes de continuar. Em Equipe e permissões, qualquer usuário autenticado pode gerar outra chave para sua própria conta, confirmando sua senha atual. A nova chave invalida a anterior. Somente o hash é guardado no banco.

Em Esqueci minha senha, informe usuário, chave e nova senha. A chave é consumida uma vez e as sessões anteriores são revogadas. Sem uma chave previamente guardada, outro administrador autorizado precisa redefinir o acesso; não existe senha mestra. A recuperação comercial por e-mail continua opcional quando configurada.

## Pedidos e produção

Alimentação → Pedidos reúne balcão, retirada e entrega. Todos geram a venda canônica e seguem as estações de produção. A senha diária é opcional; `store.timeZone` define o fuso e o padrão é America/Sao_Paulo. Entregues, retirados e cancelados ficam em Histórico. Registros antigos de senhas continuam acessíveis e não são recriados como vendas automaticamente.

## Pareamento de terminais

Ao escolher **Conectar a uma instalação existente**, o terminal procura automaticamente PCs principais ArtiSys publicados na rede local. O operador seleciona a instalação encontrada e informa o código temporário de pareamento; não precisa descobrir IP ou porta. Endereço manual permanece em **Configuração avançada** para ambientes que bloqueiam mDNS/multicast.

## QR do cardápio

Configure o computador que guarda os dados como PC principal. A interface detecta o endereço e a porta reais; em máquinas com várias redes, selecione a rede da loja. Testar acesso verifica uma resposta de saúde do servidor a partir do PC. Confira também em um celular no Wi-Fi: esse teste local não comprova a regra de firewall do telefone ou isolamento dos clientes no roteador. Endereço e porta manuais ficam nas opções avançadas.

## Balança e gaveta

Em Impressão e periféricos, abra a configuração do equipamento, detecte portas, escolha porta/perfil e salve antes de testar. Sem configuração, a leitura e abertura ficam desabilitadas. Uma configuração salva não comprova que o aparelho está conectado.

A balança usa os perfis suportados pelo runtime. A gaveta usa conexão serial ESC/POS compatível. Gavetas ligadas à impressora precisam de um driver/adaptador que ofereça o pulso de abertura; uma impressora disponível no Windows não garante isso. Não há simulação de hardware no aplicativo em produção.

## Preparação da loja

Diagnóstico e backup contém um card fechado de preparação. Clique para abrir as verificações. Fatos disponíveis no banco podem ser detectados; teste de impressora, balança, gaveta e recuperação exige confirmação real. Use Não se aplica somente nas verificações opcionais. Após conclusão o card se recolhe, mantendo observações e histórico.

## Identidade LAN e mudanças de endereço

O PC principal publica um nome mDNS único `artisys-<identidade>.local`, baseado na identidade persistida do terminal. O nome é publicado para descoberta de terminais, mas **não é escolhido automaticamente no QR público**, porque a resolução mDNS no Windows não garante que iPhone ou Android consiga abri-lo. O QR público prioriza o IPv4 da interface selecionada. A descoberta descarta loopback, APIPA, interfaces explicitamente inativas e nomes conhecidos de VPN/adaptadores virtuais. O sistema operacional não lista interfaces sem endereço; nomes de adaptadores desconhecidos podem exigir seleção da rede.

A cada cinco segundos, mudanças dos endereços provocam nova publicação mDNS. O painel e QR aberto acompanham o endereço atual; gerar QR também consulta a rede novamente. O IP não é armazenado como configuração do cardápio. O QR público utiliza IPv4 por padrão. O nome `.local` pode ser informado manualmente em Configuração avançada, somente após confirmação em um celular. Nesse caso, um QR já impresso contendo IP precisa ser reimpresso após mudança DHCP, ou o administrador deve reservar o IP no roteador. Não existe forma de alterar um QR físico já impresso. Confirme o nome estável no celular antes de imprimir. Não há DNS pago nem serviço externo obrigatório.

## Confirmação de acesso pelo celular e redes restritas

No módulo Alimentação → Cardápio público e QR, clique em **Ver QR** e depois em **Verificar pelo celular**. O ArtiSys exibe um QR de diagnóstico temporário (2 minutos). Com o celular conectado ao Wi-Fi da loja, leia o QR e toque em **Confirmar acesso pelo celular**. O computador só marcará o endereço como verificado depois de receber essa confirmação por HTTP a partir do aparelho. A validação feita pelo próprio PC é identificada como teste local, nunca como confirmação externa. A confirmação vale apenas para a sessão de uso e para o mesmo endereço/porta; a impressão ainda requer o QR definitivo da mesa.

Se o celular não abrir o teste, confirme se está no Wi-Fi da loja e não na rede de convidados, se o roteador tem isolamento AP/clientes ativo e se o Firewall do Windows permite a porta do PC principal na rede privada. O botão **Permissões do Windows** abre a tela de configuração; o aplicativo não executa alterações privilegiadas silenciosas, não desativa o firewall e não abre portas no roteador. Caso o IP mude, reimprima QR de mesas com IP antigo ou reserve o endereço DHCP no roteador. Não há acesso de fora da rede local por padrão, nem dependência de DNS, cloud ou serviço pago.

Esse fluxo de diagnóstico usa tokens aleatórios de curta duração mantidos somente na memória; não grava ou remove informações de estoque, vendas, comandas ou cadastros.
