# Contrato operacional — PDV Total Web

**Idioma:** pt-BR. **Moeda:** BRL em centavos inteiros. **Quantidade:** até 3 casas decimais. **Persistência:** D1 no Worker, Node/SQLite isolado em desenvolvimento. **Fonte da verdade:** `packages/core/` e projeções do ledger D1, nunca o DOM.

## Mapa canônico de propriedade

| Capacidade | Dono único | Evidência |
| --- | --- | --- |
| Acesso, sessão, empresas e filiais | `apps/api/src/worker.mjs` e `apps/web/api-client.js` | `apps/api/test/identity.test.mjs` |
| Permissões | `packages/core/js/core/auth/*` | `packages/core/test/authorization-service.test.js` |
| Cálculos de preço/pagamento/quantidade | `packages/core/js/domains/{sales,payments,inventory}` | `packages/core/test/` e `apps/api/test/commerce.test.mjs` |
| Venda/baixa de estoque/caixa | `apps/api/src/commerce.mjs` (persistência D1, transação única) | `apps/api/test/commerce.test.mjs` |
| Navegação e renderer | `apps/web/app.js` e `route-registry.js` | smoke web no Workerd, validação JS |
| Modal | `PdvModal` em `app.js` | foco/restauração da tela |
| Toast | `PdvToast` em `toast-ui.js` | aria-live e feedback de ações |
| Tabela/lista | `app.js` (telas operacionais existentes) | filtro sem recarregar a aplicação |
| Formulários | HTML semântico do renderer, erros junto ao formulário | input preservado após erro |

## Fluxos e consequências

- **Entrar:** e-mail/senha → pending (botão travado) → cookie `HttpOnly` e tenant/filial ativos → Balcão. Erro mantém e-mail, formulário e cursor; login desabilitado por produção `AUTH_ENABLED=false` mostra bloqueio, nunca contorna a proteção.
- **Produto:** nome, SKU e preço → salvar na mesma API → lista atualizada → feedback; nenhum produto aparece sem ser persistido.
- **Entrada de estoque:** produto e quantidade → registro imutável no ledger → projeção do saldo → feedback. Falha preserva quantidade digitada; nunca inventar saldo.
- **Venda:** buscar e escolher produto → abrir venda canônica se necessário → adicionar item, total do backend → pagamentos declarados → concluir apenas uma vez usando `x-mutation-id` → atualização única de venda, pagamentos, caixa, estoque e evento.
- **Estoque esgotado:** o D1 aborta lote inteiro, venda permanece aberta e carrinho visível. Atualizar saldo e tentar novamente, com nova operação; sem dar baixa parcial.
- **Suspender/cancelar:** mudança de status no servidor. Vendas concluídas permanecem imutáveis. O sistema não autoriza devoluções automaticamente até fluxo canônico implementado.
- **Filial:** cada operação exige membership do tenant validada no servidor e branch ativa desse tenant; IDs fornecidos pelo browser nunca bastam para autorizar.
- **Sem conexão:** preservar informação de tela, não declarar falha definitiva da venda se a confirmação for incerta; utilizar mesma chave de idempotência ao repetir conclusão.

## Regras de UX guardadas

- Rotas sem backend comprovado não aparecem no menu; não criar dados fictícios nem modais de função inexistente.
- Balcão, estoque e produto compartilham o transporte `ApiClient`; `app.js` continua único renderer.
- Busca do balcão atualiza apenas o grid; mudanças no carrinho preservam foco, termo de busca e scroll.
- Não impor recarga/relogin entre as etapas.
- Botões de pagamento exibem método *registrado no PDV*, não executam captura via Pix/cartão.
- Página pública não permite operações enquanto o onboarding, proteção de abuso, schema remoto e autorização de produção não estiverem liberados.
- `AUTH_ENABLED` somente pode mudar após provisionamento confiável, teste real D1 remoto, segurança e aceite expresso.
