param([Parameter(Mandatory=$true)][string]$Origin)
$ErrorActionPreference = 'Stop'
$uri = [Uri]$Origin
if ($uri.Scheme -ne 'https' -or $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment -or
    $uri.UserInfo -or $uri.OriginalString.TrimEnd('/') -ne $uri.GetLeftPart([System.UriPartial]::Authority)) {
  throw 'Informe a origem HTTPS exata do PDV, sem caminho ou parametros.'
}
$folder = Join-Path $env:USERPROFILE '.pdv-total-bridge'
[void](New-Item -ItemType Directory -Path $folder -Force)
$file = Join-Path $folder 'bridge.json'
$data = @{}
if (Test-Path -LiteralPath $file) {
  try {
    $previous = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    if ($previous.token -match '^[a-f0-9]{64}$') {$data.token = [string]$previous.token}
    if ($previous.printer) {$data.printer = [string]$previous.printer}
  } catch {}
}
$data.origin = $Origin
$json = $data | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText($file,$json,[System.Text.UTF8Encoding]::new($false))
& icacls.exe $folder /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" /grant:r "SYSTEM:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel proteger as credenciais locais.' }
Write-Output 'Conector configurado. Nenhum servico pago necessario.'
