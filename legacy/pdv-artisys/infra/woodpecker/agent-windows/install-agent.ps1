param(
  [string]$Version = '3.18.1',
  [string]$PluginGitVersion = '2.10.1',
  [string]$InstallDir = (Join-Path $env:USERPROFILE 'ArtiSys\woodpecker-agent'),
  [string]$UtilidadesPath = (Join-Path $env:USERPROFILE 'utilidades')
)

$ErrorActionPreference = 'Stop'

foreach ($command in @('git', 'node', 'npm')) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "$command nao encontrado no PATH. Instale-o antes de configurar o Agent Windows."
  }
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("artisys-woodpecker-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

try {
  $agentZip = Join-Path $tempRoot 'woodpecker-agent.zip'
  $agentExtract = Join-Path $tempRoot 'agent'
  $agentUrl = "https://github.com/woodpecker-ci/woodpecker/releases/download/v$Version/woodpecker-agent_windows_amd64.zip"
  $pluginUrl = "https://github.com/woodpecker-ci/plugin-git/releases/download/$PluginGitVersion/windows-amd64_plugin-git.exe"

  Write-Host "[Woodpecker Agent] Baixando agent v$Version..."
  Invoke-WebRequest -UseBasicParsing -Uri $agentUrl -OutFile $agentZip
  Expand-Archive -Path $agentZip -DestinationPath $agentExtract -Force

  $agentSource = Get-ChildItem $agentExtract -Recurse -Filter 'woodpecker-agent.exe' | Select-Object -First 1
  if (-not $agentSource) { throw 'woodpecker-agent.exe nao encontrado no pacote baixado.' }
  Copy-Item $agentSource.FullName (Join-Path $InstallDir 'woodpecker-agent.exe') -Force

  Write-Host "[Woodpecker Agent] Baixando plugin-git v$PluginGitVersion para o backend local..."
  Invoke-WebRequest -UseBasicParsing -Uri $pluginUrl -OutFile (Join-Path $InstallDir 'plugin-git.exe')
} finally {
  Remove-Item $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$utilidadesParent = Split-Path -Parent $UtilidadesPath
New-Item -ItemType Directory -Force -Path $utilidadesParent | Out-Null

if (Test-Path (Join-Path $UtilidadesPath '.git')) {
  Write-Host '[Woodpecker Agent] Reutilizando e atualizando o clone existente de utilidades...'
  & git -C $UtilidadesPath pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao atualizar o repositorio utilidades.' }
} else {
  if (Test-Path $UtilidadesPath) {
    $items = @(Get-ChildItem -Force $UtilidadesPath -ErrorAction SilentlyContinue)
    if ($items.Count -gt 0) {
      throw "O caminho $UtilidadesPath existe e nao e um clone Git vazio/valido. Informe -UtilidadesPath com o clone correto para evitar duplicacao."
    }
  }
  Write-Host '[Woodpecker Agent] Clonando utilidades (usa a autenticacao Git ja configurada neste PC)...'
  & git clone 'https://github.com/nutricionistaalmeidavh-spec/utilidades.git' $UtilidadesPath
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao clonar utilidades. Confirme a autenticacao GitHub deste PC.' }
}

$engine = Join-Path $UtilidadesPath 'modules\artisys-release\bin\artisys-release.mjs'
if (-not (Test-Path $engine)) {
  throw "Motor artisys-release nao encontrado em $engine."
}

Write-Host '[Woodpecker Agent] Instalacao preparada.'
Write-Host "[Woodpecker Agent] Agent: $(Join-Path $InstallDir 'woodpecker-agent.exe')"
Write-Host "[Woodpecker Agent] plugin-git: $(Join-Path $InstallDir 'plugin-git.exe')"
Write-Host "[Woodpecker Agent] utilidades: $UtilidadesPath"
Write-Host "[Woodpecker Agent] Node: $(& node --version)"
Write-Host "[Woodpecker Agent] Git: $(& git --version)"
