# Fiscal Bloco 1 — P0–P2

## Escopo

Este bloco prepara o núcleo fiscal local sem declarar emissão fiscal real pronta para uso comercial.

### P0 — invariantes

A suíte `test/fiscal-block1-invariants.test.js` caracteriza e protege:

- venda concluída não é revertida por falha fiscal;
- estoque não é movimentado novamente em retry fiscal;
- caixa não é movimentado novamente em retry fiscal;
- documento fiscal persistido sobrevive a reinício do runtime;
- instalação sem autoemissão fiscal continua vendendo normalmente.

### P1 — provider registry

O contrato fiscal deixa de depender diretamente do Focus.

Providers registrados:

- `acbr-local`: core local, sem token de provedor pago;
- `focus`: compatibilidade opcional existente.

`FiscalService`, EventBus, outbox e estados persistidos permanecem inalterados.

### P2 — fiscal sidecar

O processo principal Electron inicia um processo filho fiscal local:

```text
Electron main
  -> FiscalSidecarRuntime
  -> 127.0.0.1
  -> server/fiscal-sidecar
  -> adapter fiscal
```

Restrições:

- bind somente em loopback;
- nenhuma porta fiscal é exposta à LAN;
- queda do sidecar não encerra o PDV;
- após uma queda inesperada, o lifecycle tenta reiniciar o processo de forma limitada;
- o provider `acbr-local` só conversa com endpoint HTTP loopback;
- o adapter padrão deste bloco é `unconfigured`, portanto não produz autorização fiscal falsa.

O modo `mock-success` existe exclusivamente para testes determinísticos e validação do contrato. Integração real com ACBr/certificado/SEFAZ pertence aos blocos seguintes.

## Evidência

Testes específicos:

- `test/fiscal-provider-registry.test.js`;
- `test/fiscal-sidecar-contract.test.js`;
- `test/fiscal-sidecar-runtime.test.js`;
- `test/fiscal-block1-invariants.test.js`.

Todos também são coletados pelo `npm test` existente e, portanto, pelo `npm run verify`/`verify:release`.

## Fora de escopo

- certificado A1/A3;
- CSC;
- montagem de XML;
- schemas XSD;
- tributação;
- emissão real SEFAZ;
- contingência;
- DANFE fiscal;
- ativação comercial de NFC-e/NF-e.
