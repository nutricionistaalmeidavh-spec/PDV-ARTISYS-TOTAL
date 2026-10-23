# PDV TOTAL — Funcionamento offline integrado ao SaaS

## Objetivo
PDV TOTAL continua SaaS Cloudflare Worker + D1. Um PC autorizado na loja mantém dados locais sincronizados com a **mesma empresa e filial**. Ao cair apenas a internet externa, as PWAs no Wi-Fi da loja continuam acessando o HTTPS local e operações são gravadas em SQLite, com reconciliação segura quando a internet retornar. Queda do Wi-Fi ou do PC local não é coberta.

**Status desta branch:** QR temporário com link seguro, login e pareamento do aparelho local, nomenclatura revisada e indicação explícita de sincronização não configurada. Não existe ainda replicação D1 ↔ SQLite; contas SaaS não são automaticamente copiadas para o PC. Não habilitar para operação híbrida em produção antes dos gates seguintes.

## Jornada do garçom

1. Admin cria conta WAITER e define filial/permissões na Cloudflare.
2. Configura o PC offline, certificado HTTPS confiável e sincronização tenant-scoped (etapas pendentes).
3. Abre "Funcionamento offline" no servidor local, seleciona filial e "Salão / garçom", e gera o QR de cinco minutos.
4. Garçom no Wi-Fi escaneia QR que abre a **PWA local** no endereço HTTPS. O QR leva só um código de autorização do aparelho no fragmento da URL, removido do histórico no carregamento. Após login, o campo de pareamento vem preenchido.
5. Login deve ser o **mesmo e-mail e senha da conta SaaS**, após provisionamento da replicação de identidade e política; autenticação do funcionário e autorização do aparelho são obrigatórias separadamente.
6. Instala a PWA da origem local na tela inicial. Com internet funciona; sem internet externa continua alcançando o PC. Nunca depender de redirect da origem Cloudflare para um IP local.

## Limites técnicos para sincronização

- Um dump integral do D1 é inseguro num ambiente SaaS multitenant. Worker deve fornecer **snapshot lógico e deltas da filial**, paginados, autenticados, versionados e com checksum; nunca fornecer tokens de plataforma, dados de outros clientes ou segredos globais.
- Aplicar snapshot em **banco temporário validado**, com integridade referencial e esquema compatível, sem substituir um SQLite com movimentações locais pendentes. Sincronizar separadamente anexos R2.
- PC inicia conexão HTTPS autenticada com Cloudflare (não há porta externa aberta na loja). Registrar identidade do dispositivo, filial, lease e cursores pull/push, lastSuccessfulSyncAt, quantidade pendente, conflitos e falhas; aplicar retry exponencial.
- Para sair do PC: outbox transacional das mutações locais, mutationId global estável, sequência monotônica por filial, hash e ACK do D1 somente depois da gravação; idempotência em replay, nenhum evento perdido/dobrado.
- Caixa/estoque/mesa/venda não aceitam "última escrita ganha". Definir single-writer por filial, lease com fencing, versões de entidades e conflitos com revisão explícita. Se operadores online fora da loja escreverem simultaneamente durante a falha de WAN, **não presumir convergência automática**.
- Replicar também usuários e permissões sem compartilhar segredos de autenticação brutos. Credencial de contingência local deve ser registrada/validada antes de uma falha, expirar, respeitar perfil e filial. Revogação em nuvem durante desconexão só chega quando a internet retornar; controlar janela máxima offline e informar este limite.
- Não usar localStorage/Service Worker como banco de vendas. A PWA offline depende de Wi-Fi, PC e TLS local confiável. Uma PWA aberta na origem Cloudflare não muda automaticamente para a origem HTTPS local: são origens diferentes.
- Interface deve distinguir "Nuvem sincronizada", "Internet indisponível / PC local disponível", "Sincronização pendente", "Conflito", "PC indisponível" sem falsos sucessos.

## Etapas de implementação e aceite

1. **Nesta branch**: nomenclatura Funcionamento offline; QR com código temporário protegido no fragmento, entrega após login; status explicitamente NOT_CONFIGURED no servidor LAN; testes de autorização.
2. **Pendente**: vínculo seguro PC↔Cloudflare, autorização tenant/filial, exportação lógica D1 e réplica de usuário, autorização, catálogo e histórico.
3. **Pendente**: sincronização incremental D1→SQLite + health, cursores, checksums, recuperação de transferência interrompida, esquema e fotos.
4. **Pendente**: fila de operações local→D1 com eventos idempotentes, transações de negócio atômicas, leases/fencing e reconciliação.
5. **Pendente**: PWA pelo HTTPS local, troca automática do backend por estado WAN sem trocar origem, banners e fila pendente, autenticação idêntica criada pelo admin.
6. **Pendente**: CI com rede cortada e restaurada; 2 caixas, 2 garçons, KDS, estornos, concorrência na nuvem, reenvio duplicado, consistência SQL, soak/carga, Safari físico, impressora, restore e rollback.

**Não rotular o modo como operacional/sincronizado antes de 2–6 passarem.** O servidor HTTPS local independente que já existia continua tecnicamente separado do modo híbrido de contingência.
