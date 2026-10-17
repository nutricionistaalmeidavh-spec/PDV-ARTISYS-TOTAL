$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$envPath = Join-Path $scriptRoot '.env'
$examplePath = Join-Path $scriptRoot '.env.example'
$composePath = Join-Path $scriptRoot 'docker-compose.yml'

function Get-DotEnvValue {
  param([string]$Path, [string]$Name)
  $line = Get-Content $Path | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -Last 1
  if (-not $line) { return '' }
  return ($line -split '=', 2)[1].Trim()
}

function Set-DotEnvValue {
  param([string]$Path, [string]$Name, [string]$Value)
  $lines = @(Get-Content $Path)
  $pattern = "^$([regex]::Escape($Name))="
  $found = $false
  $updated = foreach ($line in $lines) {
    if ($line -match $pattern) {
      $found = $true
      "$Name=$Value"
    } else {
      $line
    }
  }
  if (-not $found) { $updated += "$Name=$Value" }
  Set-Content -Path $Path -Value $updated -Encoding UTF8
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker nao encontrado no PATH. Instale/inicie o Docker Desktop antes de subir o Woodpecker Server.'
}

& docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
  throw 'Docker Compose nao esta disponivel. O piloto usa docker compose para o Woodpecker Server.'
}

if (-not (Test-Path $envPath)) {
  Copy-Item $examplePath $envPath
  Write-Host "[Woodpecker] .env criado em $envPath"
}

$agentSecret = Get-DotEnvValue $envPath 'WOODPECKER_AGENT_SECRET'
if ([string]::IsNullOrWhiteSpace($agentSecret)) {
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $agentSecret = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
  } finally {
    $rng.Dispose()
  }
  Set-DotEnvValue $envPath 'WOODPECKER_AGENT_SECRET' $agentSecret
  Write-Host '[Woodpecker] Segredo do agent gerado e salvo somente no .env local.'
}

$hostUrl = Get-DotEnvValue $envPath 'WOODPECKER_HOST'
$client = Get-DotEnvValue $envPath 'WOODPECKER_GITHUB_CLIENT'
$clientSecret = Get-DotEnvValue $envPath 'WOODPECKER_GITHUB_SECRET'

$missing = @()
if ([string]::IsNullOrWhiteSpace($hostUrl) -or $hostUrl -match 'seu-dominio') { $missing += 'WOODPECKER_HOST' }
if ([string]::IsNullOrWhiteSpace($client)) { $missing += 'WOODPECKER_GITHUB_CLIENT' }
if ([string]::IsNullOrWhiteSpace($clientSecret)) { $missing += 'WOODPECKER_GITHUB_SECRET' }

if ($missing.Count -gt 0) {
  throw "Preencha no arquivo ${envPath}: $($missing -join ', '). O GitHub exige uma OAuth App com callback <WOODPECKER_HOST>/authorize."
}

Push-Location $scriptRoot
try {
  Write-Host '[Woodpecker] Subindo server + SQLite...'
  & docker compose --env-file $envPath -f $composePath up -d
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao subir o Woodpecker Server.' }

  & docker compose --env-file $envPath -f $composePath ps
  if ($LASTEXITCODE -ne 0) { throw 'Woodpecker subiu, mas falhou ao consultar o status do compose.' }
} finally {
  Pop-Location
}

Write-Host "[Woodpecker] UI: $hostUrl"
Write-Host '[Woodpecker] gRPC do Agent local: localhost:9000'
Write-Host "[Woodpecker] Segredo do Agent permanece em: $envPath"
