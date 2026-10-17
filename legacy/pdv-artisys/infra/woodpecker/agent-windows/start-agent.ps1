param(
  [string]$Server = $(if ($env:WOODPECKER_SERVER) { $env:WOODPECKER_SERVER } else { 'localhost:9000' }),
  [string]$AgentSecret = $(if ($env:WOODPECKER_AGENT_SECRET) { $env:WOODPECKER_AGENT_SECRET } else { $env:ARTISYS_WOODPECKER_AGENT_SECRET }),
  [string]$InstallDir = (Join-Path $env:USERPROFILE 'ArtiSys\woodpecker-agent'),
  [string]$UtilidadesPath = $(if ($env:ARTISYS_UTILIDADES_PATH) { $env:ARTISYS_UTILIDADES_PATH } else { Join-Path $env:USERPROFILE 'utilidades' }),
  [string]$WorkDir = (Join-Path $env:USERPROFILE 'ArtiSys\woodpecker-work'),
  [string]$GitHubReportTokenFile = 'C:\ProgramData\ArtiSys\github-report-token.txt'
)

$ErrorActionPreference = 'Stop'
$agentExe = Join-Path $InstallDir 'woodpecker-agent.exe'
$pluginGit = Join-Path $InstallDir 'plugin-git.exe'
$agentConfig = Join-Path $InstallDir 'agent.conf'
$engine = Join-Path $UtilidadesPath 'modules\artisys-release\bin\artisys-release.mjs'

if ([string]::IsNullOrWhiteSpace($AgentSecret)) {
  $woodpeckerRoot = Split-Path -Parent $PSScriptRoot
  $serverEnv = Join-Path $woodpeckerRoot 'server\.env'
  if (Test-Path $serverEnv) {
    $secretLine = Get-Content $serverEnv | Where-Object { $_ -match '^WOODPECKER_AGENT_SECRET=' } | Select-Object -Last 1
    if ($secretLine) { $AgentSecret = ($secretLine -split '=', 2)[1].Trim() }
  }
}

if ([string]::IsNullOrWhiteSpace($AgentSecret)) {
  throw 'WOODPECKER_AGENT_SECRET ausente. Execute o server primeiro ou informe -AgentSecret.'
}

if (-not (Test-Path $agentExe)) { throw "Agent nao instalado em $agentExe. Rode install-agent.ps1 primeiro." }
if (-not (Test-Path $pluginGit)) { throw "plugin-git nao instalado em $pluginGit. Rode install-agent.ps1 primeiro." }
if (-not (Test-Path $engine)) { throw "artisys-release nao encontrado em $engine." }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git nao encontrado no PATH.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js nao encontrado no PATH.' }

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

$env:PATH = "$InstallDir;$env:PATH"
$env:WOODPECKER_SERVER = $Server
$env:WOODPECKER_AGENT_SECRET = $AgentSecret
$env:WOODPECKER_AGENT_CONFIG_FILE = $agentConfig
$env:WOODPECKER_BACKEND = 'local'
$env:WOODPECKER_BACKEND_LOCAL_TEMP_DIR = $WorkDir
$env:WOODPECKER_MAX_WORKFLOWS = '1'
$env:WOODPECKER_AGENT_LABELS = 'pilot=pdv-artisys'
$env:WOODPECKER_HOSTNAME = "$env:COMPUTERNAME-pdv-artisys"
$env:ARTISYS_UTILIDADES_PATH = $UtilidadesPath

if (Test-Path $GitHubReportTokenFile) {
  $reportToken = (Get-Content $GitHubReportTokenFile -Raw).Trim()
  if (-not [string]::IsNullOrWhiteSpace($reportToken)) {
    $env:GITHUB_REPORT_TOKEN = $reportToken
  }
}

Write-Host '[Woodpecker Agent] Iniciando Agent Windows local...'
Write-Host "[Woodpecker Agent] Server: $Server"
Write-Host '[Woodpecker Agent] Backend: local'
Write-Host "[Woodpecker Agent] Workspace: $WorkDir"
Write-Host "[Woodpecker Agent] Config: $agentConfig"
Write-Host "[Woodpecker Agent] utilidades: $UtilidadesPath"
Write-Host "[Woodpecker Agent] Reporter GitHub: $(if ($env:GITHUB_REPORT_TOKEN) { 'configurado' } else { 'nao configurado' })"
Write-Host '[Woodpecker Agent] Max workflows: 1'
Write-Host '[Woodpecker Agent] ATENCAO: backend local executa comandos diretamente neste Windows; use apenas repositorios confiaveis.'

# O Woodpecker escreve logs informativos no stderr. No Windows PowerShell 5,
# ErrorActionPreference=Stop converte esse stderr em NativeCommandError e encerra o launcher.
# Para executaveis nativos, use o codigo de saida como fonte de verdade.
$previousErrorActionPreference = $ErrorActionPreference
$nativeExitCode = $null
try {
  $ErrorActionPreference = 'Continue'
  & $agentExe
  $nativeExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
}

if ($nativeExitCode -ne 0) {
  throw "Woodpecker Agent encerrou com codigo $nativeExitCode."
}
