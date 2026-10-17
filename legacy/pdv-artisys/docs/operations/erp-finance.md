# Operação — ERP Financeiro P0–P3

## Princípios operacionais

O ERP Financeiro roda no mesmo desktop/servidor local do ArtiSys. A operação padrão é **self-hosted**, local-first e **sem dependência paga obrigatória**. Serviço externo pago nunca é pressuposto silenciosamente; qualquer integração futura deve ser opcional, identificada e desativável sem remover o core financeiro.

Este módulo é de gestão. Ele **não implementa contabilidade por partidas dobradas** e não substitui escrituração contábil ou fiscal.

## Gestão, DRE e Fluxo de caixa

Abra **Gestão** para acompanhar indicadores, DRE, Fluxo de caixa e comparação de períodos. Selecione caixa para analisar liquidações realizadas ou competência para analisar os lançamentos pela data de competência. Estornos removem a baixa da visão realizada e não apagam o lançamento original.

## Categorias e centros de custo

No Financeiro, o lançamento pode receber categoria gerencial, centro de custo e competência. Esses dados persistem no lançamento e podem ser usados para análise. Alterar ou recarregar a tela não deve duplicar categorias ou centros.

## Importação OFX

1. Cadastre/tenha uma conta financeira do tipo banco ou cartão.
2. Em Gestão, selecione a conta e escolha um arquivo `.ofx` local.
3. O sistema executa o **preview** sem liquidar nada.
4. Confirme a importação para executar o **commit** do lote.
5. A mesma ocorrência de origem é idempotente; reimportá-la não cria outra transação.

O arquivo é lido localmente. O core não exige Open Finance, agregador bancário ou assinatura externa.

## Conciliação

A sugestão é somente uma sugestão. **A confirmação manual de conciliação é obrigatória** para liquidar um contas a pagar ou contas a receber. Antes de aceitar, confira conta, data, descrição e valor. Rejeitar uma sugestão mantém o lançamento aberto. Transferência entre duas contas próprias deve ser confirmada como transferência e não como receita/despesa.

## Recorrências

Cadastre tipo, descrição, valor, início e dia do vencimento. A geração usa uma chave de ocorrência: executar novamente, recarregar a rota ou reabrir o aplicativo não cria a mesma competência duas vezes. Regras podem ser pausadas/retomadas pelos endpoints administrativos.

## Alertas e projeções

Alertas incluem contas vencidas/a vencer, baixo saldo configurado e projeção negativa. Marcar como lido ou ocultar altera somente o estado visual; saldo, lançamentos e baixas permanecem iguais. A Gestão calcula horizontes de 7, 30 e 90 dias.

## Recuperação e diagnóstico

Se uma tela for recarregada durante uma operação, consulte novamente a lista antes de repetir uma mutação. Importações e recorrências possuem mecanismos de idempotência específicos. Para investigação, preserve logs sanitizados e o backup local existente antes de intervenção em produção.

## Gate de release

Antes de distribuir uma versão com P0–P3:

```bash
npm run qa:validate
npm run verify
npm run verify:release
```

Os fluxos E2E legados de UI continuam aposentados. O smoke atual `npm run qa:e2e:p0` executa `all-pages-audit` no Electron em 1366×768 e valida superfícies críticas/overflow com screenshots e trace; `qa:validate` continua verificando somente a configuração do harness.
