# P1 — Categorias de produtos e filtros (products-024)

O catálogo único agora gerencia categorias: cria, lista e **renomeia** pelo mesmo `id` via `PATCH /api/v1/products/categories/:id`. Esta rota exige `products.manage`, empresa/filial da sessão e `x-mutation-id` para idempotência. Produto vinculado permanece com o mesmo `category_id`, sem reescrever vendas, custo ou estoque.

No navegador, **Gerenciar categorias** lista as categorias existentes, permite mudar o nome e atualizar as etiquetas. **Filtrar por categoria** na listagem de produtos mantém uma opção para os produtos sem categoria, separada do filtro de checkout.

Regressões reais com SQLite verificam mudança sem duplicação de entidades, retry com a mesma mutation key, vínculo histórico de produtos, conflito de nomes case-insensitive, validação de nomes e isolamento entre empresas. O modo autohospedado continua grátis, sem novo esquema nem serviço externo.

`products-024` continua `partial` até confrontar todos os fluxos e filtros com o desktop congelado, executar cenários E2E de comparação e certificar as variantes do módulo.
