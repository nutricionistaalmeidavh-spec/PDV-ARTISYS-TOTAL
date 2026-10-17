param(
  [string]$UtilidadesPath = $env:ARTISYS_UTILIDADES_PATH
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $UtilidadesPath) { throw 'ARTISYS_UTILIDADES_PATH ausente.' }
$publisher = Join-Path $UtilidadesPath 'modules\artisys-release\bin\artisys-github-release.mjs'
if (-not (Test-Path $publisher)) { throw "Publisher compartilhado nao encontrado em $publisher" }
if ([string]::IsNullOrWhiteSpace($env:GITHUB_RELEASE_TOKEN) -and [string]::IsNullOrWhiteSpace($env:GITHUB_REPORT_TOKEN)) {
  throw 'Token GitHub de release ausente no Agent.'
}
if ($env:CI_PIPELINE_EVENT -and $env:CI_PIPELINE_EVENT -ne 'tag') {
  throw "Publicacao bloqueada fora de evento tag. Evento atual: $env:CI_PIPELINE_EVENT"
}

$env:ARTISYS_RELEASE_REPO = $(if ($env:CI_REPO) { $env:CI_REPO } else { 'nutricionistaalmeidavh-spec/PDV-ARTISYS' })
$env:ARTISYS_RELEASE_ASSET_DIR = 'dist'
$env:ARTISYS_RELEASE_ASSET_PATTERN = '^(ArtiSys-PDV-.*-Setup\.exe|latest\.yml|.*\.blockmap)$'
$env:ARTISYS_RELEASE_REQUIRED_ASSETS = '^ArtiSys-PDV-.*-Setup\.exe$;^latest\.yml$;\.blockmap$'
$env:ARTISYS_RELEASE_EVIDENCE = 'artifacts/release-evidence.json'
$env:ARTISYS_RELEASE_NAME = "ArtiSys PDV $env:ARTISYS_RELEASE_VERSION"

Push-Location $repoRoot
try {
  & node $publisher
  if ($LASTEXITCODE -ne 0) { throw "Publicacao do GitHub Release falhou com codigo $LASTEXITCODE." }
} finally { Pop-Location }
