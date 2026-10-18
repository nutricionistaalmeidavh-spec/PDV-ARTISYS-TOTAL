# P5 — rodada de fechamento dos parciais: evidência por contrato

Baseline desktop: `nutricionistaalmeidavh-spec/PDV-ARTISYS@7efea9c61f75be1536a1e516e917218f2b8bf2bf`.

## Mudanças comprováveis nesta rodada

- **reports-062:** os detalhes de vendas e a exportação CSV resolvem nome de vendedor, operador e cliente na API canônica. Apenas usuários com vínculo de empresa ativo e clientes pertencentes à mesma empresa são consultados. IDs são preservados para trilha histórica, sem criar tabela de cópia. A regressão usa vendedor, cliente, produto e método de pagamento na mesma venda e confirma nomes no JSON e no CSV.
- **home-003:** novas métricas de vendas líquidas do mês, meta mensal e percentual atingido. O percentual só agrega vendas e devoluções **dos vendedores com metas configuradas e vínculos ativos**, até a data comercial consultada. Quando não há meta, o percentual fica `null` e a UI exibe “Não cadastrada”, em vez de inventar 0% de uma meta inexistente. Regressão mede duas vendas (uma sem meta, outra com), acesso permitido e isolamentos de filial e perfil.
- **home-004:** preserva posição de rolagem quando o usuário retorna à rota de relatórios. Mantém o comportamento anterior de rotas não relacionadas e os controles já existentes de aba, datas e foco por teclado. E2E real no Chromium mobile percorre relatórios → checkout → relatórios e verifica scroll, aba, datas e foco.

## Estado e bloqueios reais

Estes cenários são **cobertura incremental**, não prova de que os contratos completos possam ser classificados como `covered`. A matriz ainda exige igualdade ao desktop original para dados, layout, escopos, filtros, erros e comportamentos não testados. Os demais parciais de relatórios: `reports-060`, `reports-063`, `reports-064`, `reports-065`, `reports-066` e `reports-068`; no início: `home-002` e os complementos dos IDs `home-003`/ `home-004`. Também se exige comparação independente, cenários de recuperação e autorização no desktop, e homologação de dispositivos nos fluxos aplicáveis.

A CI executa as regressões no SHA exato. Não modificar `scenario-evidence.json` nem afirmar 11/11 ou 4/4 até existir comparação de origem reproduzível em todas as dimensões exigidas.

## Arquitetura e custos

A API e SQLite/D1 continuam a autoridade; HTML recebe somente dados autorizados da filial. Não há cache paralelo de finanças, pagamento externo obrigatório ou nova dependência paga. O núcleo Node + SQLite permanece grátis e self-hosted.
