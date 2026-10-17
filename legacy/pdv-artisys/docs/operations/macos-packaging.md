# PDV ArtiSys para macOS — empacotamento e checklist

O macOS usa o mesmo Electron, servidor Node.js, SQLite autoritativo e perfis LAN que o Windows.
Não é uma versão para iOS ou um novo frontend. O Windows NSIS continua inalterado.

## Checklist de implementação

- [x] Definir alvos nativos Intel (x64) e Apple Silicon (arm64) com DMG.
- [x] Manter ZIP e metadados do electron-builder preparados para futuras atualizações.
- [x] Gerar o .icns a partir do SVG ArtiSys já usado no Windows.
- [x] Manter dados em `app.getPath('userData')`, sem banco na pasta do .app.
- [x] Usar o servidor local existente para a operação sem SaaS obrigatório.
- [x] Configurar matriz de build, checks estáticos e smoke de inicialização do .app no CI.
- [x] Separar os artefatos macOS dos releases Windows e impedir publicação automática.
- [x] Criar promoção manual com conferência de commit/tag e aprovação explícita de QA físico.
- [ ] Confirmar ambos os builds DMG/ZIP verdes no GitHub Actions.
- [ ] Executar QA operacional completo em Macs reais: ativação, caixa, balcão, comandas, pizza/delivery, backup, restore, LAN, impressoras e dispositivos seriais.
- [ ] Publicar uma release comercial macOS somente depois dos testes físicos.

## Gerar instaladores em Mac

Usar macOS x64 para x64 e macOS arm64 para arm64. O build nativo evita
cross-compilation incorreta do serialport. Ferramentas gratuitas:

```bash
brew install librsvg
npm ci --no-audit --no-fund
npm run dist:mac
```

Saída: `dist/ArtiSys-PDV-<version>-<arch>.dmg` e ZIP correspondente.
O workflow `.github/workflows/build-macos.yml` roda os dois builds sem necessidade de
um Mac pessoal e disponibiliza os arquivos como artefatos do GitHub Actions.
Após QA físico, o workflow **publish-macos** recebe a tag já publicada pelo Windows e o
ID do build macOS com sucesso; valida o mesmo commit **e a mesma versão da tag**,
e somente então publica os dois DMGs na GitHub Release existente. Para isso, rode
`build-macos` manualmente selecionando a **tag** da release Windows, pois builds
de PR são apenas prévias e usam a versão do código-fonte. Não publica ZIP/metadata nem altera o updater Windows.
Sem confirmação manual `qa_approved`, a promoção não executa.
O núcleo é gratuito e self-hosted; nenhuma assinatura Apple é exigida no build padrão.

## Gatekeeper, assinatura e atualizações

**O DMG padrão é não assinado/não notarizado.** Em um Mac, o Gatekeeper pode impedir
a abertura inicial; o proprietário deve aprovar o aplicativo por meio das opções
de segurança oficiais do sistema. Não recomendamos desabilitar o Gatekeeper
globalmente. Assinatura com Developer ID e notarização Apple são melhorias
**opcionais e pagas**, nunca dependências silenciosas do core.

**Atualização manual no macOS:** baixar uma nova versão e substituir o .app.
Os dados no diretório de usuário sobrevivem à substituição do aplicativo.
O updater do código ainda suporta somente builds Windows empacotados;
não habilitar atualização automática para DMGs não assinados. Os ZIPs e
metadados de atualização são preparados para implementação futura **após**
validação de assinatura, notarização e compatibilidade de metadados das duas
arquiteturas. Nunca sobrescrever `latest.yml` do Windows com `latest-mac.yml`.

## Matriz de validação física (bloqueia release comercial)

| Grupo | Critério |
| --- | --- |
| Instalação/abertura | DMG monta, .app abre, reinicia e mantém dados, sem crash |
| Licença e rede | Ativação inicial online e operação local subsequente; LAN autorizada |
| Negócio | Checkout, comandas, delivery/pizza, estoque, caixa e relatórios |
| Persistência | SQLite, backup, recuperação e troca de versão sem perder dados |
| Impressão | PDF/A4, recibo não fiscal, térmica macOS e seleção de impressora |
| Hardware | Leitor HID, gaveta, balança/serial e permissões de USB/porta |
| Atualização | Por enquanto manual, sem acionamento do updater Windows |

Periféricos específicos não são considerados homologados até que o fabricante,
modelo, porta e driver sejam testados em um Mac real. A CI fornece evidência
de empacotamento e inicialização, não certificação física.
