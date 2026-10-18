# R2 — inspeção presencial opcional, posterior à conclusão do código

**Status:** OPCIONAL / NÃO EXECUTADO. Esta ficha não faz parte da certificação de código, não bloqueia `covered`, merge ou fechamento da R2.
É proibido marcar como FIELD_VERIFIED antes de ter resultados reais,
assinatura do revisor independente e arquivos reproduzíveis.

## Ambiente

- SHA candidato:
- Data/horário (fuso):
- Técnico:
- Revisor independente:
- Empresa e filial de teste (sem identificadores pessoais):
- Computador principal (modelo, SO/build, Node, SQLite, armazenamento):
- Terminal 1 (modelo, navegador, SO):
- Terminal 2 (modelo, navegador, SO):
- Smartphone/tablet de salão (se aplicável):
- Dispositivo de cozinha/KDS (se aplicável):
- Nome DNS LAN e SAN do certificado:
- CA confiável instalada em quais equipamentos:
- Firewall isolado da internet, acesso somente LAN:

## Ensaios obrigatórios

| Caso | Procedimento | Esperado | Resultado | Evidência |
| --- | --- | --- | --- | --- |
| TLS-01 | Abrir URL pelo QR em ambos dispositivos | HTTPS confiável sem ignorar aviso | PENDENTE | |
| PAIR-01 | Gerar código de 5 min e parear | Uso único; segredo não aparece em lista/log | PENDENTE | |
| ROLE-01 | Operador fora de perfil tenta pareamento e venda | 403, sem escrita | PENDENTE | |
| SCOPE-01 | Credencial de filial A tenta venda filial B | 403, sem escrita | PENDENTE | |
| SALE-01 | Duas vendas simultâneas do mesmo SKU | Estoque/caixa canônicos, sem venda duplicada | PENDENTE | |
| IDEMP-01 | Reenviar mesma conclusão após timeout | Único lançamento | PENDENTE | |
| SHIFT-01 | Trocar operador em terminal autorizado | Acesso por papel, sem duplicar terminal | PENDENTE | |
| REVOKE-01 | Revogar durante sessão com venda na tela | Próxima chamada de comércio negada | PENDENTE | |
| NET-01 | Desligar conexão do servidor / restaurar LAN | Nenhuma venda falsamente confirmada | PENDENTE | |
| OFFLINE-01 | Desligar internet mantendo somente LAN | PWA e API continuam disponíveis | PENDENTE | |
| RESTART-01 | Reiniciar servidor com WAL e sessões | Dados íntegros, sem duplicação; reconectar | PENDENTE | |
| BACKUP-01 | Criar/validar snapshot sob escrita | SHA-256, integridade, FK e manifestos válidos | PENDENTE | |
| RESTORE-01 | Restore em novo caminho isolado | Login, saldos e históricos consistentes | PENDENTE | |
| DIAG-01 | Exportar e inspecionar ZIP | Nenhum segredo/PII, só allowlist | PENDENTE | |
| WAITER-01 | Abrir comanda real em tablet autorizado | Papel, filial, persistência e sincronização | PENDENTE | |
| KDS-01 | Produzir e reconectar em tela de cozinha | Pedidos corretos sem duplicação | PENDENTE | |

## Evidências

- IDs exatos das capturas/artefatos (não anexar credenciais, caixa real ou PII):
- Logs sanitizados:
- Backup de teste arquivado em volume protegido:
- Falhas encontradas e issues/PRs corretivos:
- Verificações reproduzidas por terceiro:

## Avaliação opcional de implantação

- [ ] Os casos aplicáveis foram executados em hardware físico real.
- [ ] Todos os casos obrigatórios passaram, com falhas remediadas e retestadas.
- [ ] As 14 capacidades foram confrontadas com o baseline desktop fixado.
- [ ] Dependências dos 68 contratos relevantes foram verificadas.
- [ ] Evidências pertencem ao SHA candidato, sem mudanças após homologação.
- [ ] Revisor independente aprovou explicitamente cada ID aplicável.

**Assinatura do revisor:** __________________

**Data:** __________________

A ausência deste formulário não altera o estado das capacidades. O código pode estar `covered` sem testes presenciais; apenas não se afirma validação do equipamento específico.
