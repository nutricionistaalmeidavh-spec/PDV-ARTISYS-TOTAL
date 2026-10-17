# Licenciamento comercial do ArtiSys PDV

Este documento é a fonte canônica para separar **arquitetura local-first** de **licenciamento comercial**.

## Regra do produto distribuído

A ativação comercial é **obrigatória** na distribuição oficial do ArtiSys PDV. O cliente compra a licença e a ArtiSys libera um e-mail + código de ativação de 6 dígitos.

Uma instalação sem registro de ativação:

- não conclui o primeiro acesso;
- não cria o administrador principal;
- não libera login local de usuários preexistentes;
- não pode usar a existência de banco ou usuário legado como bypass.

O endpoint comercial padrão é `https://pdv-artisys.sistema-artisys.workers.dev`.

## O que continua local

A ativação não transforma o PDV em SaaS. Depois de ativado, a operação diária continua local:

- SQLite e dados operacionais permanecem no estabelecimento;
- venda, estoque, caixa, impressão e módulos continuam locais/LAN;
- senhas do administrador não são enviadas ao serviço comercial;
- uma indisponibilidade temporária do Cloudflare não bloqueia uma instalação cujo último estado conhecido da licença seja ativo;
- uma licença já conhecida como suspensa, cancelada ou expirada continua bloqueada até regularização.

## Primeiro administrador

Em uma instalação nova, após validar o código:

1. o e-mail retornado pela licença é reutilizado como e-mail do administrador principal;
2. esse e-mail é obrigatório e não editável nessa etapa;
3. nome, usuário e senha são criados localmente;
4. a chave de recuperação local é exibida uma única vez.

## Uso interno e desenvolvimento

`PDV_REQUIRE_COMMERCIAL_ACTIVATION=false` é um override explícito para desenvolvimento e uso interno da ArtiSys. Ele não deve ser usado em instaladores destinados a clientes.

“Self-hosted” ou “local-first” nunca deve ser interpretado como “gratuito para o cliente”; esses termos descrevem a arquitetura de execução e armazenamento.
