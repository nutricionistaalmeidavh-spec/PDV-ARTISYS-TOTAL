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
- PWA canônica: tela de rede, pareamento, QR offline gerado pelo código
  compartilhado, revogação, checklist de homologação e diagnóstico ZIP.
- Pacote ZIP sanitizado inclui somente estatísticas, nomes de migrações
  e ações administrativas sem IP, atores, cookies, senhas ou credenciais.
- Checklist por estabelecimento; READY exige nota e referência de prova.
- Backup existente por SQLite nativo: snapshot coerente em WAL, SHA-256,
  verificação de integridade, restore de ensaio para NOVO destino, sem
  sobrescrever o banco em uso.

## Rastreabilidade dos 14 IDs

| ID | Escopo e prova atualmente disponível | Bloqueio restante |
| --- | --- | --- |
| cap-001 | Servidor local Node/SQLite | Instalação/serviço e falha física no Windows |
| cap-002 | HTTPS LAN, autenticação, isolamento | Certificado confiável e dois PCs reais |
| cap-003 | Pareamento, troca de operador e revogação efetiva | Concorrência e reinício em máquinas reais |
| cap-010 | Registro FOOD/WHOLESALE preexistente no core | Equivalência web de habilitar/desabilitar módulos |
| cap-042 | QR HTTPS offline, gerador compartilhado | Ensaio em smartphone real |
| cap-044 | Pareamento WAITER e RBAC | Jornada do salão em tablet real |
| cap-045 | Pareamento KITCHEN e RBAC | Fluxo KDS e reconexão em hardware |
| cap-046 | Token 256 bits, hash, escopo, revogação | Homologação de troca de operador e recuperação |
| cap-047 | Mesma PWA HTTPS adaptável | Instalação e operação em aparelhos reais |
| cap-051 | Backup nativo e restauração não destrutiva | Ensaio de recuperação completo supervisionado |
| cap-053 | Saúde, auditoria e isolamento LAN | Paridade integral dos logs sanitizados |
| cap-054 | ZIP de suporte sanitizado | Validação de artefato Windows/Linux e baseline |
| cap-055 | Checklist por tenant com referência persistente | Evidência física independente |
| cap-056 | Servidor, PWA de terminais, pareamento | Troca de host e instalação completa real |

**Nenhum status do inventário canônico é promovido por mera existência de
arquivo ou testes em CI.** A certificação completa exige paridade desktop,
dependências dos contratos, testes de campo e revisão no SHA exato.

## Operação

Use docs/SELFHOST-LAN-HTTPS.md para provisionar banco, configurar DNS LAN
e CA privada confiável, compilar PWA e iniciar HTTPS. Não ignore alertas
de TLS nem exponha SQLite ou a porta de acesso diretamente à Internet.

Acesso: administrador faz login em Configurações > Rede local, gera código
para a filial e função. O operador consome em seu navegador. Teste acesso
com dois dispositivos físicos; registre venda concorrente e revogação.

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

Homologação física manual: preencher
docs/parity/field-qa/R2-LAN-2-DEVICES-TEMPLATE.md com modelos, SO,
CA/TLS, cenários de LAN sem internet, transação, reconexão e restore,
revisor independente e evidências reais. CI não prova essas condições.
