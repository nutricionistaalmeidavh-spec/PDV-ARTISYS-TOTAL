$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$server=Join-Path $root 'infra\woodpecker\server'
$agent=Join-Path $root 'infra\woodpecker\agent-windows'
$workspace='C:\VICTOR'
$util=Join-Path $workspace 'Artisys\AgroFrota\utilidades'

if(-not (Test-Path (Join-Path $util '.git'))){throw "utilidades nao encontrado no workspace esperado: $util"}

$hostUrl=Read-Host 'Host [http://localhost:8000]'
if([string]::IsNullOrWhiteSpace($hostUrl)){$hostUrl='http://localhost:8000'}
$client=Read-Host 'GitHub OAuth Client ID'
$sec=Read-Host 'GitHub OAuth Client Secret' -AsSecureString
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try{$secret=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
if([string]::IsNullOrWhiteSpace($client) -or [string]::IsNullOrWhiteSpace($secret)){throw 'Client ID/Secret obrigatorios.'}

@"
WOODPECKER_HOST=$hostUrl
WOODPECKER_GITHUB_CLIENT=$client
WOODPECKER_GITHUB_SECRET=$secret
WOODPECKER_AGENT_SECRET=
WOODPECKER_ADMIN=nutricionistaalmeidavh-spec
WOODPECKER_REPO_OWNERS=nutricionistaalmeidavh-spec
"@ | Set-Content (Join-Path $server '.env') -Encoding UTF8
Remove-Variable secret -ErrorAction SilentlyContinue

& (Join-Path $server 'start-server.ps1')
& (Join-Path $agent 'install-agent.ps1') -UtilidadesPath $util
Start-Process powershell.exe -ArgumentList '-NoExit','-ExecutionPolicy','Bypass','-File',("`"{0}`"" -f (Join-Path $agent 'start-agent.ps1')),'-UtilidadesPath',("`"{0}`"" -f $util)
Start-Process $hostUrl
