# Manifesto da importação

Data: 17/10/2026 (Brasil).

| Propriedade | Valor |
|---|---|
| Origem | `nutricionistaalmeidavh-spec/PDV-ARTISYS` |
| Branch de origem | `main` |
| Commit da origem (fixado) | `7efea9c61f75be1536a1e516e917218f2b8bf2bf` |
| Destino | `nutricionistaalmeidavh-spec/PDV-ARTISYS-TOTAL` |
| Caminho no destino | `legacy/pdv-artisys/` |
| Arquivos rastreados copiados | **900** |
| Total dos tamanhos Git | **5.104.950 bytes** |
| Commit com importação | `7466adcb978204fb77dc8e20c941d3c9853342a4` |
| GitHub Actions | [Execução #39034297514](https://github.com/nutricionistaalmeidavh-spec/PDV-ARTISYS-TOTAL/actions/runs/39034297514) — **success** |

## Garantias verificadas

- O workflow fez `git fetch --depth=1` do commit original exato, sem sincronizar atualizações futuras automaticamente.
- `rsync` copiou os arquivos de trabalho, excluindo somente a pasta administrativa `.git/` (não é conteúdo do produto).
- O teste comparou **lista de caminhos** e **SHA-256 de cada um dos 900 arquivos**. Resultado: todos iguais.
- O snapshot foi escrito apenas na branch do repositório de destino.
- Os workflows, módulos Cloudflare e artefatos operacionais do produto original estão preservados **dentro de `legacy/`**; não foram ativados na raiz do destino.
- Nenhum Worker de produção, licença, banco ou instalador original foi alterado.

**Observação:** essa validação comprova uma cópia fiel; **não** significa que o código desktop já rode em Cloudflare ou que o SaaS esteja pronto. O plano de conversão está em [ROADMAP-SAAS-CLOUDFLARE.md](ROADMAP-SAAS-CLOUDFLARE.md).
