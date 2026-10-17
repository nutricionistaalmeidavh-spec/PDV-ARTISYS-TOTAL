# Política de regressão para bugs de cliente

## Regra

Todo bug confirmado que chegou a um cliente deve deixar uma proteção permanente no repositório. A correção só é considerada completa quando existe um teste de regressão capaz de reproduzir o comportamento incorreto e impedir que ele volte.

## Fluxo obrigatório

1. Registrar o incidente com um identificador rastreável (`BUG-xxxx`, issue ou equivalente).
2. Reproduzir o problema no menor nível de teste que represente o defeito real.
3. Criar ou ajustar um teste que **falhe antes da correção** pelo motivo esperado.
4. Corrigir o código de produção.
5. Executar novamente o teste e a suíte relacionada; o teste novo deve passar após a correção.
6. Manter o teste no repositório enquanto a funcionalidade existir.
7. Para defeitos de UI, impressão ou artefatos, preservar evidências úteis de falha (screenshot, diff, trace, log, PDF ou arquivo gerado) quando aplicável.

## Escolha da camada

Use a camada mais barata que consiga detectar o defeito de verdade:

- regra pura ou cálculo: teste unitário;
- banco, evento, idempotência ou integração entre serviços: integração;
- comportamento percebido pelo operador: E2E;
- posição/orientação de saída legível por máquina: preferir round-trip semântico (gerar → renderizar → decodificar → comparar);
- PDF, QR, código de barras ou outro arquivo gerado: validar também o conteúdo/semântica do artefato, não apenas sua existência;
- aparência puramente visual sem semântica decodificável: manter asserções estruturais e evidência manual; não introduzir baseline/pixel diff no gate atual;
- hardware físico: manter primeiro a prova automatizada de software no Git e homologar hardware separadamente quando necessário.

Não crie um E2E se um teste menor captura o mesmo defeito com segurança. Não aceite um teste que apenas percorra o fluxo sem uma asserção capaz de perceber o erro original.

## Exemplo: código de barras

Além do teste de baixo nível do handler, o gate semântico executa o checkout com entrada keyboard-wedge, preserva zeros à esquerda, exige a localização do produto exato e confirma que o valor invertido não localiza o produto. Para saídas legíveis por máquina, a regra é gerar → renderizar → decodificar → comparar com o valor original. O QR local segue esse round-trip no CI. Não há gate de baseline visual/pixel.

## Critério para PR

Quando uma PR corrige bug de cliente, a descrição deve apontar:

- incidente/issue relacionado;
- teste de regressão adicionado ou fortalecido;
- evidência de que esse teste falhava no comportamento defeituoso;
- evidência de que passou após a correção;
- suíte/gate de CI que executa o teste.

Se não for um bug reportado por cliente, marque a seção correspondente do template como não aplicável.


## Gates semânticos permanentes

- `release/customer-operations.json`: operação customer/admin sem permissão conhecida ou evidência QA válida bloqueia o gate de paridade.
- `qa:e2e:semantic`: scanner, código invertido, duplo clique, PDF real e persistência após reload.
- `qa:artifact-semantic`: QR renderizado e decodificado por ferramentas open source.
- `qa:multi-device -- --profile full`: concorrência, idempotência, autorização, queda/reinício LAN e recuperação.
- testes de invariantes: centavos, descontos, troco, quantidade, estoque, códigos e datas.

Esses gates não dependem de SaaS nem de serviço pago.
