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

## Rastreabilidade dos 14 IDs

| ID | Escopo e prova atualmente disponível | Lacuna de código / evidência executável |
| --- | --- | --- |
| cap-001 | Servidor local Node/SQLite | Testes automatizados de inicialização Windows e falha/restart |
| cap-002 | HTTPS LAN, autenticação, isolamento | TLS e duas sessões simultâneas em integração automatizada, prova completa da operação |
| cap-003 | Pareamento, troca de operador e revogação efetiva | Concorrência, persistência e reinício automatizados |
| cap-010 | Registro FOOD/WHOLESALE habilitável por loja, API e UI com bloqueio servidor | Comparação automatizada dos subfluxos desktop e regressão |
| cap-042 | QR HTTPS offline, gerador compartilhado | Teste E2E do QR e navegador móvel emulado |
| cap-044 | Pareamento WAITER e RBAC | Jornada completa do salão em Chromium responsivo |
| cap-045 | Pareamento KITCHEN e RBAC | Fluxo KDS e reconexão emulada |
| cap-046 | Token 256 bits, hash, escopo, revogação | Teste integrado da troca de operador e recuperação |
| cap-047 | Mesma PWA HTTPS adaptável | PWA instalada e executada em navegação emulada com falhas injetadas |
| cap-051 | Backup nativo e restauração não destrutiva | Automação de recuperação completo em banco isolado |
| cap-053 | Saúde, auditoria e isolamento LAN | Paridade integral dos logs sanitizados |
| cap-054 | ZIP de suporte sanitizado | Validação automatizada do artefato Windows/Linux e baseline |
| cap-055 | Checklist por tenant com referência persistente | Asserções automatizadas por capacidade e revisão de código |
| cap-056 | Servidor, PWA de terminais, pareamento | Troca de host e instalação com teste de automação |

**Nenhum status do inventário canônico é promovido por mera existência de
arquivo ou testes em CI.** A certificação completa exige paridade desktop,
dependências dos contratos, testes automatizados e revisão de código no SHA exato; testes físicos são opcionais e não impedem `covered`.

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
