# Woodpecker CI — PDV ArtiSys

O Woodpecker permanece disponível como **fallback self-hosted manual**, sem serviço pago obrigatório. Enquanto o repositório `PDV-ARTISYS` estiver público, o CI automático oficial é o **GitHub Actions**.

## Política atual

```text
Push / Pull Request
  -> GitHub Actions
     -> capability parity
     -> lint / testes / release gates
     -> E2E ArtiSys QA
     -> artefatos de evidência

Execução manual opcional
  -> Woodpecker Server local
  -> Windows Agent
  -> artisys-release
```

Os arquivos `.woodpecker/pdv-release.yaml` e `.woodpecker/pdv-publish.yaml` aceitam somente evento `manual`. Push em `main`, pull request e tag **não devem iniciar o Agent Windows automaticamente**.

Essa decisão evita CI duplicado e uso desnecessário do computador local enquanto Actions pode executar os gates do repositório público sem dependência paga.

## GitHub Actions — fluxo autoritativo

`.github/workflows/verify.yml` executa automaticamente:

1. instalação reproduzível com Node 22;
2. `npm run verify:release`;
3. gate de paridade Backend → API → Client → UI → E2E para as fases já concluídas;
4. validação do ArtiSys QA;
5. perfil E2E `release` em Xvfb/Electron;
6. upload de screenshots, relatórios, traces e demais evidências disponíveis.

`.github/workflows/qa-capture.yml` continua disponível para captura técnica ou demonstrações específicas.

## Woodpecker manual

O host homologado usa Node 22+, Electron Builder/NSIS e o repositório compartilhado `utilidades` em `C:\VICTOR\Artisys\AgroFrota\utilidades`.

O pipeline manual `pdv-release` mantém:

- `artisys-release` compartilhado;
- Woodpecker Server em Docker;
- Agent Windows persistente com backend local;
- validação do ArtiSys QA vendorizado;
- build/installer/QA local;
- reporter de falhas quando a execução manual for solicitada.

O pipeline `pdv-publish` também é somente manual. Publicação automática por tag no Woodpecker foi removida; releases automáticos devem ser tratados pelos workflows GitHub definidos para o produto.

## Atualização desktop

O desktop usa `electron-updater` com:

- checagem automática após a inicialização;
- `autoDownload = false`;
- download iniciado pelo usuário;
- progresso na UI;
- `autoInstallOnAppQuit = true`;
- instalação/reinício após o download;
- estados e erros expostos por IPC seguro;
- suporte a `ARTISYS_UPDATE_URL` para feed genérico.

Nenhum PAT/token GitHub deve ser embutido no aplicativo. Qualquer canal de atualização para clientes precisa permanecer público/seguro ou usar mecanismo que não distribua segredo no executável.

## Health check do host manual

`infra/woodpecker/health-check.ps1` verifica, quando o fallback local for usado:

- Docker;
- Woodpecker Server;
- Agent Windows;
- Cloudflare Tunnel;
- `artisys-release`;
- `artisys-ci-reporter`;
- limpeza de workspaces e rotação de logs.

O token do reporter permanece somente no Agent Windows em:

```text
C:\ProgramData\ArtiSys\github-report-token.txt
```

Configuração local:

```powershell
.\infra\woodpecker\configure-github-reporter.ps1
```

Nenhum token é versionado nem distribuído com o PDV.
