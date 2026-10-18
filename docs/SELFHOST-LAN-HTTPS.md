# PDV TOTAL — servidor LAN HTTPS gratuito e self-hosted (P6)

Este é o **mesmo PDV web e o mesmo núcleo canônico** usados no modo Cloudflare opcional.
Não há segundo renderer, segunda regra de venda nem licença SaaS obrigatória.
O servidor roda em Node.js + SQLite **dentro do estabelecimento**, sem nuvem,
cobrança recorrente ou conexão externa obrigatória para operar na LAN.

## 1. Requisitos

- Node.js 22+ com `node:sqlite` e repositório compilado com `npm run build`.
- Computador principal estável, endereço LAN/DNS local fixo, armazenamento
  persistente e volume de backup separado.
- Certificado **TLS válido para o nome usado pelos clientes**, com sua CA instalada
  e confiável **nos dispositivos de acesso** (PC/tablet/celular). Certificados
  autoassinados servem somente para teste controlado; não instruir o operador
  a ignorar alertas de certificado ou desativar segurança do navegador.
- Firewall permitindo a porta HTTPS apenas na **rede interna autorizada**.
  **Não abrir acesso da internet via port forwarding.** Para acesso remoto,
  implantar VPN self-hosted administrada separadamente; nunca publicar SQLite.

## 2. Provisionar o banco novo (somente uma vez)

Exemplo POSIX; em Windows/PowerShell use `$env:NOME="valor"` em cada variável:

```bash
export LOCAL_DB_PATH="/srv/pdv-total/data/pdv.sqlite"
export PDV_OWNER_EMAIL="administrador@exemplo.local"
export PDV_OWNER_NAME="Administrador"
export PDV_TENANT_SLUG="loja-matriz"
export PDV_TENANT_NAME="Loja Matriz"
export PDV_OWNER_PASSWORD="SENHA-REAL-FORTE-DE-PELO-MENOS-12-CARACTERES"
node --experimental-sqlite apps/api/src/provision.mjs --local
unset PDV_OWNER_PASSWORD
```

O provisionador cria o proprietário, estabelecimento e filial e instala as migrações
canônicas **uma só vez**, na ordem, registrando SHA-256 em `schema_migrations`.
Não execute provisionamento novamente em um banco já iniciado.

**Banco preexistente sem `schema_migrations`:** a API recusa inicializar, em vez
de repetir `ALTER TABLE`/mexer silenciosamente nos dados. Faça um backup e
homologue uma migração assistida com a origem antes de trocar a instalação.
Não aponte para o banco do PDV desktop original.

## 3. Certificados e execução

Obtenha certificado e chave PEM da sua CA privada local (software livre).
Se usar o nome `pdv.loja.local`, resolva-o **igualmente em todos os dispositivos**
e confira que ele está nos Subject Alternative Names (SAN) do certificado.
A chave privada deve ficar fora da pasta web, com permissões restritas.

```bash
export LOCAL_DB_PATH="/srv/pdv-total/data/pdv.sqlite"
export PDV_PUBLIC_ORIGIN="https://pdv.loja.local:8443"
export PDV_LAN_PORT="8443"
export PDV_BIND_HOST="0.0.0.0"
export PDV_TLS_KEY="/srv/pdv-total/certs/servidor.key"
export PDV_TLS_CERT="/srv/pdv-total/certs/servidor.crt"
export AUTH_ENABLED="true"
npm run serve:lan
```

- Por padrão o bind é `127.0.0.1`. **Só** use `0.0.0.0` após
  configurar certificados, firewall LAN e acesso dos terminais.
- A origem HTTPS é explícita; `Host` divergente é rejeitado. Requisições
  mutáveis precisam enviar `Origin` igual à URL da instalação.
- Cookies de sessão têm `Secure`, `HttpOnly`, `SameSite=Strict` e escopo
  `__Host-`; o servidor mantém isolamento por estabelecimento e autorização
  por perfil na API canônica.
- Os clientes usam a **mesma PWA responsiva**, sem plugins comerciais ou
  banco SQLite local no navegador. A API, não o navegador, decide o negócio.
- A PWA pode manter apenas os assets públicos em cache; **venda offline
  independente de servidor não está implementada**.
- Com o servidor indisponível não há novas operações comerciais confirmadas.
  Não presumir que a página em cache seja uma confirmação de venda.

### Autorizar os primeiros terminais (obrigatório em LAN)

Após provisionar e iniciar HTTPS, abra a PWA e faça login como proprietário.
Acesse **Configurações > Rede local**. Gere um código de uso único para a
filial e tipo **Terminal de caixa**. No dispositivo que vai operar, faça
login com operador autorizado e preencha **Parear este aparelho**.
O computador principal também deve ser pareado se operar vendas pela PWA.

Sem dispositivo ativo para aquela filial, rotas de vendas, caixa, estoque
e operações de módulos retornam erro de autorização: **não** há
funcionamento comercial anônimo nem fallback para burlar o pareamento.
O código expira em cinco minutos e só pode ser consumido uma vez.
A revogação do dispositivo bloqueia a próxima operação comercial,
mesmo se a sessão de operador ainda estiver válida.

As áreas opcionais **Alimentação** e **Atacado** podem ser habilitadas/
desabilitadas pelo administrador nessa mesma tela. Desabilitar não apaga
histórico. O endereço e QR são gerados localmente, sem serviço externo.

## 4. Backup e recuperação sem sobrescrita

```bash
node --experimental-sqlite scripts/selfhost-backup.mjs create \
  /srv/pdv-total/data/pdv.sqlite /backup/pdv-2026-10-17.sqlite
node --experimental-sqlite scripts/selfhost-backup.mjs verify /backup/pdv-2026-10-17.sqlite
node --experimental-sqlite scripts/selfhost-backup.mjs restore \
  /backup/pdv-2026-10-17.sqlite /srv/pdv-total/data/restore-test.sqlite
```

Verifique login e consultas em ambiente isolado com o arquivo restaurado.
A substituição do banco de produção exige janela de manutenção, serviço parado,
cópia do arquivo ativo e aceite de responsável humano. Os backups são
**sensíveis, não criptografados pela ferramenta**; usar disco/volume criptografado,
controle de acesso e política de retenção externa ao diretório público.

## 5. Verificações de QA (não equivalem a homologação física)

```bash
npm run test:api
npm run test:parity
npm run test:selfhost
npm run build
```

O teste `cap-002 LAN` sobe servidor HTTPS real com certificado temporário,
3 contas em 2 estabelecimentos, 2 sessões no mesmo estabelecimento,
permissões de leitura, origem hostil, Host inválido, revogação de sessão e PWA.
A CI usa TLS real mas **não** demonstra certificado confiável instalado
em dois dispositivos físicos nem concorrência multi-terminal comercial completa.
A capacidade `cap-002` permanece `gap` até provas físicas e de negócio;
o avanço técnico isolado não altera o inventário artificialmente.

Registrar também ensaios em Windows/Linux, desconexão de rede, reinício,
dois operadores concorrentes, transação idempotente, impressora/balança real,
recuperação e revisão independente. Consultar o gate em
`docs/parity/P6-56-CAPACIDADES.md`.
