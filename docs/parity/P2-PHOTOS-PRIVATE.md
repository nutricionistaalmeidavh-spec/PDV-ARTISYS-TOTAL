# P2.3 — Foto privada de produto em R2/SQLite local

## Contrato

- Uma foto ativa por produto canônico, vinculada a `tenant_id + product_id` em `product_media`, migração aditiva **0011**.
- `PUT/GET/DELETE /api/v1/tenants/:tenant/products/:product/photo?branchId=:branch` requer **sessão autenticada**, associação ativa à empresa e filial, e capacidade `products.manage` para criar/substituir/remover; `products.view` para consultar.
- Upload aceita **PNG, JPEG ou WebP até 2 MB**, compara MIME informado com assinatura do arquivo e rejeita outros tipos (incluindo SVG/HTML). As respostas de imagem usam `Cache-Control: private, no-store` e `X-Content-Type-Options: nosniff`. Não existe URL de bucket pública.
- No Cloudflare Worker, arquivos usam binding **R2 `FILES`**, com chaves privadas sob `tenants/{tenant}/products/{product}`. O D1 guarda apenas a referência, MIME, hash SHA-256 e metadados. Se o binding não estiver ativo, o upload retorna 503; **nunca** grava silenciosamente BLOBs no D1 remoto.
- Na instalação self-hosted Node+SQLite, `LOCAL_MEDIA_ENABLED=true` pode armazenar a imagem em BLOB no banco local. A instalação não depende de R2, cartão, licença ou assinatura. Os backups SQLite locais precisam proteger também as fotos.
- Substituição grava uma nova chave e só altera o ponteiro ativo após persistência; cópias antigas são removidas de R2 quando possível. Caso a exclusão de objeto falhe, ele não fica publicamente acessível, mas uma limpeza privada posterior pode ser necessária.
- `commerce_mutations` registra operação/ID para idempotência de upload e exclusão. Os produtos e preços continuam exclusivamente no cadastro `products`.

## Interface

**Produtos e estoque → Adicionar foto / Trocar foto / Remover foto**. A lista exibe miniatura somente depois que o cadastro canônico confirma a presença da imagem.

## Qualidade e condições de publicação

1. Executar `npm test`, testes binários `p2-photos.test.mjs` e migrações SQLite 0001–0011.
2. Executar migração 0011 no D1 **local de teste** e gates Workerd, Chrome desktop/mobile.
3. Antes do uso remoto: confirmar criação do bucket privado `FILES`, políticas de retenção/custo, upload/troca/remoção reais, falhas de conexão, permissões read-only e logout; migrar banco remoto somente após backup e autorização.
4. Sem autenticação liberada no Worker (`AUTH_ENABLED=false`), os endpoints comerciais continuam bloqueados. Não fazer deploy remoto nem habilitar serviços pagos nesta entrega.

**Estado da paridade:** parcial até validação real do R2, formatos/fotos legados, redimensionamento e gestão de imagens em lote. Homologação de impressoras, balanças e gavetas depende de equipamento físico e permanece separada.
