# R2 — Self-hosted, rede local, terminais e backups (18/10/2026)

## Fonte de verdade

R2 contém exatamente 14 IDs das 56 capacidades. Desktop congelado:
PDV-ARTISYS @ 7efea9c61f75be1536a1e516e917218f2b8bf2bf.
As 68 operações de tela são contratos subordinados, não tarefas adicionais.

**Core obrigatório:** Node 22 + SQLite + PWA + HTTPS LAN, R$ 0,
open source, self-hosted. Cloudflare e serviços pagos são opcionais;
a API de pareamento está indisponível fora de LAN_MODE=true.

## Incrementos desta branch

- Servidor HTTPS LAN existente: origem exata, TLS e login obrigatórios.
- Credenciais de dispositivos: token de 256 bits, hash SHA-256 em SQLite,
  código de uso único válido por 5 minutos, filial/perfil/tenant,
  troca de operador e revogação efetiva no comércio.
- Toda operação comercial em LAN exige sessão válida, credencial de
  dispositivo ativa e filial correspondente. Revogar o dispositivo
  bloqueia a próxima venda, ajuste de estoque, caixa e comando de cozinha.
- PWA canônica: tela de rede, módulos opcionais, pareamento, QR offline gerado pelo código
  compartilhado, revogação, checklist de homologação e diagnóstico ZIP.
- Pacote ZIP sanitizado inclui somente estatísticas, nomes de migrações
  e ações administrativas sem IP, atores, cookies, senhas ou credenciais.
- Checklist por estabelecimento; READY exige nota e referência de prova.
- Backup existente por SQLite nativo: snapshot coerente em WAL, SHA-256,
  verificação de integridade, restore de ensaio para NOVO destino, sem
  sobrescrever o banco em uso.

## Critério de fechamento — 14 capacidades da R2

A matriz canônica `docs/parity/desktop-capability-inventory.json` marca os **14 IDs R2 como `covered`**, com implementação e asserção executável associadas a cada ID.
Isto expressa **cobertura de software**; não é declaração de implantação física em cliente, nem certifica as 56 capacidades do produto. `fullSystemClaim` permanece `incomplete`.

| ID | Fluxo de código comprovado | Teste canônico |
| --- | --- | --- |
| cap-001 | Perfil Windows SERVER local com TLS/SQLite separados da interface, launcher e verificação | `r2-deployment-profiles.test.mjs` no Windows |
| cap-002 | Servidor HTTPS real, sessões independentes, CSRF, Host e tenant | `https-lan-server.test.mjs` |
| cap-003 | Dois dispositivos pareados, operando em paralelo; revogação isolada | `r2-lan-operations.test.mjs` |
| cap-010 | Alternância de FOOD/WHOLESALE por empresa e bloqueio no servidor | `r2-lan-operations.test.mjs` |
| cap-042 | QR local sem CDN com payload HTTPS e verificação de limite | `r2-lan-qr.test.js` |
| cap-044 | Garçom pareado com RBAC; mesa e comanda chegam ao KDS | `r2-lan-operations.test.mjs` |
| cap-045 | Cozinha pareada, acesso limitado e transição do ticket PREPARING/READY | `r2-lan-operations.test.mjs` |
| cap-046 | Código único expirável, hash das credenciais, autorização e revogação | `r2-lan-operations.test.mjs` |
| cap-047 | PWA Chromium móvel no servidor LAN HTTPS Node/SQLite; primeiro acesso, pareamento, revogação, offline e recuperação | `r2-lan-browser-e2e.mjs` |
| cap-051 | Snapshot SQLite consistente, hash, verificação e restauração em outro arquivo | `selfhost-backup.test.mjs` |
| cap-053 | Logs, auditoria e saúde sanitizados com isolamento de empresa | `r2-lan-operations.test.mjs` |
| cap-054 | ZIP de diagnóstico sem dados pessoais, segredos e cookies | `r2-lan-operations.test.mjs` |
| cap-055 | Checklist persistente por estabelecimento, opcional e segregado do aceite de software | `r2-lan-operations.test.mjs` |
| cap-056 | Perfis locais SERVER e TERMINAL com atalhos seguros, sem SQLite ou segredos no terminal | `r2-deployment-profiles.test.mjs` no Windows |

O contrato interno `cash-046` está `covered` porque sessões de caixa com identificadores distintos são exercitadas por vendas, fechamento, restituição e consulta isolada em `commerce.test.mjs`. Isso libera as dependências da R2 sem remover controles.

**Limites:** O núcleo requer servidor LAN acessível, DNS/certificado HTTPS válido e backup externo. Não existe venda independente do servidor, nem backup criptografado automaticamente; não inventar esses recursos. Homologação em máquinas, balanças ou impressoras reais é opcional e **não bloqueia código `covered`, revisão ou merge**. A habilitação de um ambiente de produção é decisão separada.

## Operação

Use docs/SELFHOST-LAN-HTTPS.md para provisionar banco, configurar DNS LAN
e CA privada confiável, compilar PWA e iniciar HTTPS. Não ignore alertas
de TLS nem exponha SQLite ou a porta de acesso diretamente à Internet.

Acesso: administrador faz login em Configurações > Rede local, gera código
para a filial e função. O operador consome em seu navegador. Teste acesso
com duas sessões/instâncias de navegador no ambiente de testes; registre venda concorrente e revogação em suíte automatizada.

Backup: execute scripts/selfhost-backup.mjs nos modos create, verify e
restore com Node 22 --experimental-sqlite. Use novo destino de restore;
verifique login e consultas em instância isolada. Banco ativo só poderá
ser trocado com serviço parado e responsável humano supervisionando.
O arquivo de backup não é criptografado: use volume cifrado fora da web.

## Regressões

- npm run build
- npm run test:api
- npm run test:core
- npm run test:selfhost
- npm run test:parity

Inspeção presencial **opcional após código pronto**: caso desejada, preencher
docs/parity/field-qa/R2-LAN-2-DEVICES-TEMPLATE.md com modelos, SO,
CA/TLS, cenários de LAN sem internet, transação, reconexão e restore,
registros do operador. Esse formulário não é critério de aceite nem bloqueia classificação ou merge.
