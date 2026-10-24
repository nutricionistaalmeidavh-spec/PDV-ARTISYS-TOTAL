# Funcionamento offline — sincronização do PDV TOTAL

## Escopo de implementação em validação

A contingência opera via servidor HTTPS no PC da loja e banco SQLite da
mesma empresa/filial, com Wi-Fi local mantido quando a WAN cair.

- Mesas, abertura de comandas, pedidos para cozinha, preparo, entrega,
  cancelamento e fechamento permitido de mesa usam operações canônicas com
  IDs estáveis entre SQLite e Cloudflare D1.
- Entradas e ajustes de estoque usam outbox transacional persistente, ACK
  idempotente e conciliação antes de liberar novamente os escritores online.
- Um piloto separado de venda simples e **caixa em dinheiro físico** usa
  abertura de caixa, itens de venda, conclusão e fechamento no mesmo protocolo.
  Exige simultaneamente `OFFLINE_CASH_ENABLED=true` no Worker e
  `PDV_OFFLINE_CASH_ENABLED=true` no servidor local. Desligado por padrão.
- PIX, cartão, transações com adquirente, crediário, devoluções e
  liquidação de venda originada de comanda/mesa NÃO podem ser confirmados
  offline antes de paridade financeira específica e verificação externa.
- A autorização de operação local permanece restrita a uma filial e uma
  geração por vez. Nenhum evento local deve ser declarado sincronizado antes
  de ACK no D1. Toda operação é verificada contra assinatura de gateway,
  usuário e papel ativos, empresa, filial, epoch e hash do conteúdo.

**Estado:** branch em QA, não representa liberação comercial automática.
A documentação abaixo descreve princípios, limitações e gates de segurança.
Nenhuma promessa de certificação física de iOS, impressora ou POS de cartão.

## Escrita local e sincronização

1. Antes da perda da internet, o proprietário gera o token do PC, reserva
   a filial e a nova cópia lógica D1 -> SQLite recebe epoch/mode LOCAL.
2. No PC, um usuário autorizado realiza uma entrada ou ajuste de estoque
   com o header x-mutation-id estável, por dispositivo autorizado.
3. Antes da ação, o gateway salva a intenção em offline_pending_requests.
   O núcleo existente grava o movimento de estoque e a auditoria
   commerce_mutations na mesma transação. Trigger da 0047 grava
   offline_outbox de forma atômica. A transação falha se outbox falhar.
4. O PC transmite cada item em ordem ao endpoint de máquina autenticado
   /api/v1/offline/gateway/replay. O D1 verifica tenant, filial, epoch,
   conta ativa, perfil atual, assinatura e hash do payload. Nunca usa
   bearer da sessão do garçom para a comunicação máquina/nuvem.
5. O D1 aplica a mesma rota canônica com o mesmo x-mutation-id. O recibo
   durável offline_replay_receipts só libera ACK após a mutação.
   Se a WAN cair depois do commit e antes de chegar ACK, o replay
   retorna o resultado idempotente — nunca baixa estoque duas vezes.
6. O gateway marca localmente ACKED e só depois atualiza o snapshot
   de saldo, evitando sobrescrever movimentações ainda pendentes.
7. Ao sair da contingência, o proprietário usa o PC local para finalizar.
   O PC bloqueia novas gravações, drena a outbox e solicita unlock;
   Cloudflare valida contagem e sequência contígua de ACKs.
   Não libera a filial se houver lacunas/conflitos.

## MFA e autorização

O segredo MFA TOTP de cada usuário autorizado é recriptografado
especificamente para o token do gateway usando AES-GCM. A chave mestra
MFA da Cloudflare nunca é enviada ao PC. O login local continua exigindo
TOTP. Alterações no segundo fator são feitas exclusivamente na nuvem.
Credenciais e permissões sincronizadas têm validade de contingência de
no máximo 24h entre sincronizações; mudanças remotas durante corte de WAN
não podem ser notificadas instantaneamente.

## Ainda bloqueado — NÃO usar como PDV offline completo

- **Vendas/comandas/caixa/pagamentos/devoluções/crediário**: exigem
  snapshot completo de entidades relacionadas, IDs canônicos e outbox
  por serviço. Não desabilitar os guards que impedem dados divergentes.
- **Estoque**: somente entrada e ajuste de estoque estão no replay; lote,
  transferências, contagem, compra e despesas seguem bloqueados no PC.
- **MFA**: TOTP suportado com chave do gateway; recovery codes continuam
  próprios do login Cloudflare. A janela de acesso offline tem limite.
- **Operação física**: testar HTTPS confiável em iOS/Safari, PWA instalada,
  leitura do QR, Wi-Fi isolado, PC reiniciado, WAN caída/retornada,
  impressora e escala física; os testes Linux/WebKit não equivalem a isso.
- **Carga/soak**: medir concorrência, fila longa, disco cheio, PC desligado,
  duplicação e estado após atualização de versão antes do lançamento.

## Gates de segurança

- Flags OFFLINE_SYNC_ENABLED e PDV_OFFLINE_REPLICA_ENABLED continuam
  desligadas por padrão.
- Não alterar manualmente D1 nem ligar a exclusividade em clientes sem
  o gateway configurado e a cópia inicial concluída.
- Nunca salvar token do gateway em formulário público, QR ou logs.
- Se um replay entrar em conflito, interromper a liberação da filial
  e preservar o SQLite e a outbox para auditoria.
