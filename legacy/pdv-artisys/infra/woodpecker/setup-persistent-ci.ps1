param(
  [string]$Hostname = 'ci.artisys.dev',
  [string]$TunnelName = 'artisys-woodpecker',
  [string]$UtilidadesPath = 'C:\VICTOR\Artisys\AgroFrota\utilidades'
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principalCheck = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principalCheck.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Abra o PowerShell como Administrador e rode novamente.'
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$serverDir = Join-Path $repoRoot 'infra\woodpecker\server'
$agentDir = Join-Path $repoRoot 'infra\woodpecker\agent-windows'
$envPath = Join-Path $serverDir '.env'
$serverScript = Join-Path $serverDir 'start-server.ps1'
$agentScript = Join-Path $agentDir 'start-agent.ps1'

if (-not (Test-Path $envPath)) { throw "Woodpecker .env nao encontrado em $envPath." }
if (-not (Test-Path $agentScript)) { throw "Agent launcher nao encontrado em $agentScript." }
if (-not (Test-Path $UtilidadesPath)) { throw "utilidades nao encontrado em $UtilidadesPath." }

function Set-DotEnvValue {
  param([string]$Path, [string]$Name, [string]$Value)
  $lines = @(Get-Content $Path)
  $pattern = '^' + [regex]::Escape($Name) + '='
  $found = $false
  $out = foreach ($line in $lines) {
    if ($line -match $pattern) {
      $found = $true
      "$Name=$Value"
    } else {
      $line
    }
  }
  if (-not $found) { $out += "$Name=$Value" }
  Set-Content -Path $Path -Value $out -Encoding UTF8
}

function Find-Cloudflared {
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machinePath;$userPath;$env:Path"

  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -and (Test-Path $cmd.Source)) { return $cmd.Source }

  $candidates = @(
    'C:\Program Files (x86)\cloudflared\cloudflared.exe',
    'C:\Program Files\cloudflared\cloudflared.exe',
    'C:\Program Files (x86)\cloudflared\cloudflared-windows-amd64.exe',
    'C:\Program Files\cloudflared\cloudflared-windows-amd64.exe',
    (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\cloudflared.exe')
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }

  $roots = @(
    (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'),
    'C:\Program Files (x86)\cloudflared',
    'C:\Program Files\cloudflared'
  )
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    $found = Get-ChildItem $root -File -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -in @('cloudflared.exe', 'cloudflared-windows-amd64.exe') } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($found) { return $found.FullName }
  }

  return $null
}

Write-Host '[1/8] Preparando cloudflared...'
$cfSource = Find-Cloudflared
if (-not $cfSource) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'winget nao encontrado.' }
  & winget install -e --id Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar cloudflared pelo winget.' }
  Start-Sleep -Seconds 2
  $cfSource = Find-Cloudflared
}
if (-not $cfSource) {
  throw 'cloudflared foi instalado, mas o executavel nao foi localizado nos caminhos padrao do MSI/WinGet.'
}
Write-Host "[Woodpecker] cloudflared localizado em: $cfSource"

$stateRoot = 'C:\ProgramData\ArtiSys'
$cfState = Join-Path $stateRoot 'cloudflared'
New-Item -ItemType Directory -Force -Path $cfState | Out-Null
$cfExe = Join-Path $cfState 'cloudflared.exe'
if ((Resolve-Path $cfSource).Path -ne $cfExe) { Copy-Item $cfSource $cfExe -Force }

Write-Host '[2/8] Autenticando Cloudflare...'
$userCfDir = Join-Path $env:USERPROFILE '.cloudflared'
$certPath = Join-Path $userCfDir 'cert.pem'
if (-not (Test-Path $certPath)) {
  Write-Host 'O navegador vai abrir uma vez. Autorize a zona artisys.dev e volte ao terminal.'
  & $cfExe tunnel login
  if ($LASTEXITCODE -ne 0) { throw 'Falha no login da Cloudflare.' }
}

Write-Host '[3/8] Criando/reutilizando Tunnel...'
$tunnelJson = & $cfExe tunnel list -o json
if ($LASTEXITCODE -ne 0) { throw 'Falha ao listar Cloudflare Tunnels.' }
$tunnels = @($tunnelJson | ConvertFrom-Json)
$tunnel = $tunnels | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1

if (-not $tunnel) {
  & $cfExe tunnel create $TunnelName
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar Cloudflare Tunnel.' }
  $tunnelJson = & $cfExe tunnel list -o json
  $tunnels = @($tunnelJson | ConvertFrom-Json)
  $tunnel = $tunnels | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
}

if (-not $tunnel) { throw 'Tunnel criado, mas nao foi possivel localizar o UUID.' }
$tunnelId = [string]$tunnel.id
$credSrc = Join-Path $userCfDir "$tunnelId.json"

if (-not (Test-Path $credSrc)) {
  $altName = "$TunnelName-$env:COMPUTERNAME"
  $alt = $tunnels | Where-Object { $_.name -eq $altName } | Select-Object -First 1
  if (-not $alt) {
    & $cfExe tunnel create $altName
    if ($LASTEXITCODE -ne 0) { throw 'Tunnel existente sem credencial local e falha ao criar replica dedicada.' }
    $tunnelJson = & $cfExe tunnel list -o json
    $tunnels = @($tunnelJson | ConvertFrom-Json)
    $alt = $tunnels | Where-Object { $_.name -eq $altName } | Select-Object -First 1
  }
  $tunnel = $alt
  $tunnelId = [string]$tunnel.id
  $credSrc = Join-Path $userCfDir "$tunnelId.json"
}
if (-not (Test-Path $credSrc)) { throw "Credencial do Tunnel nao encontrada: $credSrc" }

Write-Host "[4/8] Publicando https://$Hostname ..."
& $cfExe tunnel route dns --overwrite-dns $tunnelId $Hostname
if ($LASTEXITCODE -ne 0) { throw "Falha ao criar DNS para $Hostname." }

$credDst = Join-Path $cfState "$tunnelId.json"
Copy-Item $credSrc $credDst -Force
$configPath = Join-Path $cfState 'config.yml'
$logPath = Join-Path $cfState 'cloudflared.log'
@"
tunnel: $tunnelId
credentials-file: '$credDst'
ingress:
  - hostname: $Hostname
    service: http://localhost:8000
  - service: http_status:404
logfile: '$logPath'
"@ | Set-Content $configPath -Encoding UTF8

& $cfExe tunnel --config $configPath ingress validate
if ($LASTEXITCODE -ne 0) { throw 'Configuracao de ingress Cloudflare invalida.' }

Write-Host '[5/8] Colocando Cloudflare Tunnel em segundo plano no boot...'
$cfAction = New-ScheduledTaskAction -Execute $cfExe -Argument "tunnel --config `"$configPath`" run `"$tunnelId`""
$cfTrigger = New-ScheduledTaskTrigger -AtStartup
$cfPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$longSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'ArtiSys Cloudflare Tunnel' -Action $cfAction -Trigger $cfTrigger -Principal $cfPrincipal -Settings $longSettings -Force | Out-Null
Start-ScheduledTask -TaskName 'ArtiSys Cloudflare Tunnel'

Write-Host '[6/8] Configurando webhook publico no Woodpecker...'
Set-DotEnvValue -Path $envPath -Name 'WOODPECKER_EXPERT_WEBHOOK_HOST' -Value "https://$Hostname"
& $serverScript

Write-Host '[7/8] Colocando Docker e Woodpecker Agent em segundo plano...'
$currentUser = "$env:USERDOMAIN\$env:USERNAME"
$userPrincipal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$userTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser

$dockerExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
if (Test-Path $dockerExe) {
  $dockerAction = New-ScheduledTaskAction -Execute $dockerExe
  Register-ScheduledTask -TaskName 'ArtiSys Docker Desktop' -Action $dockerAction -Trigger $userTrigger -Principal $userPrincipal -Settings $longSettings -Force | Out-Null
}

$agentLog = Join-Path $stateRoot 'woodpecker-agent.log'
$agentRunner = Join-Path $stateRoot 'run-woodpecker-agent.ps1'
@"
`$ErrorActionPreference='Continue'
& '$agentScript' -UtilidadesPath '$UtilidadesPath' *>> '$agentLog'
"@ | Set-Content $agentRunner -Encoding UTF8

Get-Process 'woodpecker-agent' -ErrorAction SilentlyContinue | Stop-Process -Force
$agentAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$agentRunner`""
Register-ScheduledTask -TaskName 'ArtiSys Woodpecker Agent' -Action $agentAction -Trigger $userTrigger -Principal $userPrincipal -Settings $longSettings -Force | Out-Null
Start-ScheduledTask -TaskName 'ArtiSys Woodpecker Agent'

Write-Host '[8/8] Validando...'
Start-Sleep -Seconds 4
$localOk = $false
try {
  $r = Invoke-WebRequest 'http://localhost:8000/healthz' -UseBasicParsing -TimeoutSec 5
  $localOk = ($r.StatusCode -eq 204)
} catch {}

$publicOk = $false
for ($i=0; $i -lt 20 -and -not $publicOk; $i++) {
  try {
    $r = Invoke-WebRequest "https://$Hostname/healthz" -UseBasicParsing -TimeoutSec 5
    $publicOk = ($r.StatusCode -eq 204)
  } catch {
    Start-Sleep -Seconds 3
  }
}

Write-Host ''
Write-Host '=== ArtiSys CI persistente ==='
Write-Host "Woodpecker local:  http://localhost:8000   health=$localOk"
Write-Host "Webhook publico:   https://$Hostname       health=$publicOk"
Write-Host "Tunnel UUID:       $tunnelId"
Write-Host 'Background:        Cloudflare Tunnel + Docker Desktop + Woodpecker Agent'
Write-Host "Agent log:         $agentLog"
Write-Host ''
Write-Host 'Agora pode fechar os terminais. Volte ao Woodpecker e habilite PDV-ARTISYS.'
