param(
  [string]$UtilidadesPath = $env:ARTISYS_UTILIDADES_PATH
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $UtilidadesPath) { throw 'ARTISYS_UTILIDADES_PATH ausente.' }
$scanner = Join-Path $UtilidadesPath 'modules\artisys-security\security.py'
if (-not (Test-Path $scanner)) { throw "artisys-security nao encontrado em $scanner" }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI nao encontrado.' }

$shallow = (& git -C $repoRoot rev-parse --is-shallow-repository 2>$null).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel validar o checkout Git.' }
if ($shallow -eq 'true') {
  Write-Host '[ArtiSys Security] Convertendo checkout shallow em historico completo...'
  $old = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & git -C $repoRoot fetch --unshallow --tags
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $old }
  if ($code -ne 0) { throw "git fetch --unshallow falhou com codigo $code." }
}

$pythonExe = $null
$pythonArgs = @()
if (Get-Command py -ErrorAction SilentlyContinue) {
  $pythonExe = 'py'
  $pythonArgs = @('-3')
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  $pythonExe = 'python'
} else {
  throw 'Python 3 nao encontrado no PATH.'
}

New-Item -ItemType Directory -Force -Path (Join-Path $repoRoot 'artifacts') | Out-Null
$report = Join-Path $repoRoot 'artifacts\security-report.json'
Write-Host '[ArtiSys Security] Gitleaks + Trivy + Semgrep em modo release...'
$oldPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = 'Continue'
  $output = & $pythonExe @pythonArgs $scanner $repoRoot --engine docker --mode release 2>&1
  $code = $LASTEXITCODE
} finally { $ErrorActionPreference = $oldPreference }
$outputText = ($output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
Set-Content -Path $report -Value $outputText -Encoding UTF8
Write-Host $outputText
if ($code -ne 0) { throw "Gate de seguranca bloqueou a release (codigo $code)." }
Write-Host "[ArtiSys Security] Aprovado. Relatorio: $report"
