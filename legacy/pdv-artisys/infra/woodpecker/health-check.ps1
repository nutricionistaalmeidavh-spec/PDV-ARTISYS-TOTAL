param(
  [switch]$Repair,
  [string]$UtilidadesPath = 'C:\VICTOR\Artisys\AgroFrota\utilidades',
  [string]$WorkDir = (Join-Path $env:USERPROFILE 'ArtiSys\woodpecker-work'),
  [string]$PublicHealth = 'https://ci.artisys.dev/healthz',
  [string]$PipelineLogPath = ''
)

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$stateRoot = 'C:\ProgramData\ArtiSys'
$healthLog = Join-Path $stateRoot 'woodpecker-health.log'
$agentLog = Join-Path $stateRoot 'woodpecker-agent.log'
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null

function Test-Http204([string]$Url) {
  try { return (Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 5).StatusCode -eq 204 } catch { return $false }
}

function Test-Docker {
  try { & docker info *> $null; return $LASTEXITCODE -eq 0 } catch { return $false }
}

function Rotate-Log([string]$Path, [long]$MaxBytes = 20971520) {
  if (-not (Test-Path $Path)) { return }
  $file = Get-Item $Path -ErrorAction SilentlyContinue
  if ($file -and $file.Length -gt $MaxBytes) {
    $tail = @(Get-Content $Path -Tail 5000 -ErrorAction SilentlyContinue)
    Set-Content -Path $Path -Value $tail -Encoding UTF8
  }
}

function Remove-StaleWorkspaces([string]$Root, [int]$OlderThanHours = 48) {
  if (-not (Test-Path $Root)) { return 0 }
  $cutoff = (Get-Date).AddHours(-$OlderThanHours)
  $removed = 0
  Get-ChildItem $Root -Directory -Filter 'woodpecker-local-*' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    ForEach-Object {
      try { Remove-Item $_.FullName -Recurse -Force -ErrorAction Stop; $removed++ } catch {}
    }
  return $removed
}

$docker = Test-Docker
$server = Test-Http204 'http://localhost:8000/healthz'
$public = Test-Http204 $PublicHealth
$agent = [bool](Get-Process 'woodpecker-agent' -ErrorAction SilentlyContinue)
$tunnel = [bool](Get-Process 'cloudflared' -ErrorAction SilentlyContinue)
$releaseEngine = Test-Path (Join-Path $UtilidadesPath 'modules\artisys-release\bin\artisys-release.mjs')
$reporter = Test-Path (Join-Path $UtilidadesPath 'modules\artisys-ci-reporter\bin\artisys-ci-reporter.mjs')

if ($Repair) {
  if (-not $docker) {
    $dockerExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
    if (Test-Path $dockerExe) { Start-Process $dockerExe -ErrorAction SilentlyContinue | Out-Null; Start-Sleep 5; $docker = Test-Docker }
  }
  if ($docker -and -not $server) {
    $serverScript = Join-Path $repoRoot 'infra\woodpecker\server\start-server.ps1'
    if (Test-Path $serverScript) { & $serverScript *> $null; Start-Sleep 3; $server = Test-Http204 'http://localhost:8000/healthz' }
  }
  if (-not $agent) {
    Start-ScheduledTask -TaskName 'ArtiSys Woodpecker Agent' -ErrorAction SilentlyContinue
    Start-Sleep 3
    $agent = [bool](Get-Process 'woodpecker-agent' -ErrorAction SilentlyContinue)
  }
  if (-not $tunnel) {
    Start-ScheduledTask -TaskName 'ArtiSys Cloudflare Tunnel' -ErrorAction SilentlyContinue
    Start-Sleep 3
    $tunnel = [bool](Get-Process 'cloudflared' -ErrorAction SilentlyContinue)
  }
  if (-not $releaseEngine -or -not $reporter) {
    $old = $ErrorActionPreference
    try { $ErrorActionPreference='Continue'; & git -C $UtilidadesPath pull --ff-only *> $null } finally { $ErrorActionPreference=$old }
    $releaseEngine = Test-Path (Join-Path $UtilidadesPath 'modules\artisys-release\bin\artisys-release.mjs')
    $reporter = Test-Path (Join-Path $UtilidadesPath 'modules\artisys-ci-reporter\bin\artisys-ci-reporter.mjs')
  }
}

Rotate-Log $agentLog
$removed = Remove-StaleWorkspaces $WorkDir
$public = Test-Http204 $PublicHealth

$state = [ordered]@{
  timestamp = (Get-Date).ToString('o')
  docker = $docker
  server = $server
  public = $public
  agent = $agent
  tunnel = $tunnel
  releaseEngine = $releaseEngine
  reporter = $reporter
  staleWorkspacesRemoved = $removed
}
$line = ($state | ConvertTo-Json -Compress)
Add-Content -Path $healthLog -Value $line -Encoding UTF8
Write-Host $line
if ($PipelineLogPath) {
  '=== health-ci ===' | Add-Content -Path $PipelineLogPath -Encoding UTF8
  $line | Add-Content -Path $PipelineLogPath -Encoding UTF8
}

$healthy = ($docker -and $server -and $public -and $agent -and $tunnel -and $releaseEngine -and $reporter)
if (-not $healthy) {
  $message = "Health check falhou: docker=$docker server=$server public=$public agent=$agent tunnel=$tunnel releaseEngine=$releaseEngine reporter=$reporter"
  if ($PipelineLogPath) { $message | Add-Content -Path $PipelineLogPath -Encoding UTF8 }
  throw $message
}
